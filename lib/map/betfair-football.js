// lib/map/betfair-football.js // Map football legs to Betfair MATCH_ODDS markets.
//
// Changes (2025-09-02):
// • Context-aware youth/B/Reserves/Women filtering: block only when the *mapped team* is youth/B/Reserves/Women
//   (unless explicitly requested in the leg text, or whitelisted B/II). Allow when only the opponent is youth/B/etc.
// • Supports explicit acca legs like "Fulham U21" or "Barcelona B" (allowed).
// • Safer wordishContains without Unicode property escapes that can break older Node parses.
//
// Exports:
//   - mapAllToWinLegs(legs, { debug, horizonHours, bookie })
//   - mapMatchOdds(leg, { debug, horizonHours })
//
// NOTE: We intentionally use the legacy-safe signature of listMarketCatalogue:
// listMarketCatalogue(filter, { marketProjection, sort, maxResults })

import { listMarketCatalogue } from '../betfair/client.js';
import fs from 'fs';
import path from 'path';

const SOCCER_EVENT_TYPE_ID = '1'; // Betfair Soccer
const MO_CODE = 'MATCH_ODDS';

// ---------- Small utils ----------
function nowIso(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString();
}

// Collapses normal spaces and NBSP (\u00A0), trims and lowercases
function canon(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u00A0]+/g, ' ')
    .trim();
}

function escapeRx(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Safe "wordish" contains: normalize to a-z0-9 + single spaces, then string includes
function normalizeForWordish(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function wordishContains(hay, needle) {
  const H = ' ' + normalizeForWordish(hay) + ' ';
  const N = ' ' + normalizeForWordish(needle) + ' ';
  if (!N.trim()) return false;
  return H.includes(N);
}

function sortByOpenDateAsc(a, b) {
  const da = new Date(a?.event?.openDate || 0).getTime();
  const db = new Date(b?.event?.openDate || 0).getTime();
  if (da === db) return 0;
  return da < db ? -1 : 1;
}

// ---------- Alias / canonical helpers ----------
let __CFG = null;
let __ALIAS_MAP = null;

function loadConfig() {
  if (!__CFG) {
    const cfgPath = path.resolve('config/global.json');
    __CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  return __CFG;
}

function loadAliasMap() {
  if (!__ALIAS_MAP) {
    const cfg = loadConfig();
    const p = path.resolve(cfg?.normalize?.teamAliasesPath || 'data/compiled/aliases.index.json');
    __ALIAS_MAP = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return __ALIAS_MAP;
}

function canonTeamName(s) {
  if (!s) return s;
  const m = loadAliasMap();
  const key = canon(s);
  return m[key] || s;
}

// Build a set of acceptable variants for a given canonical so we tolerate
// Betfair flipping between full and abbreviated forms across competitions.
function variantsForCanonical(canonical) {
  const m = loadAliasMap();
  const set = new Set([canon(canonical)]);
  for (const [k, v] of Object.entries(m)) {
    if (canon(v) === canon(canonical)) set.add(canon(k));
  }
  return set;
}

// ---------- Youth/B/Reserves/Women detection (context-aware) ----------
// A small whitelist of B-sides commonly priced in main markets
const B_WHITELIST = new Set([
  'real sociedad b',
  'barcelona b',
  'bayern munich ii',
  'real madrid castilla',
  'jong ajax',
  'jong psv',
  'jong az',
  'jong utrecht',
]);

function hasWomenMarkers(name = '') {
  return /(?:^|[\\s-])(women|ladies|femenino|fem)(?:$|[\\s-])/i.test(name);
}

function hasYouthMarkers(name = '') {
  // Only explicit youth tokens; avoid generic words like "young"
  return /(?:^|[\\s-])(u-?\\d{2}|under\\s?\\d{2}|u\\d{2}|youth)(?:$|[\\s-])/i.test(name);
}

function hasReserveMarkers(name = '') {
  return /\\breserves?\\b/i.test(name);
}

function hasBTeamMarkers(name = '') {
  // End-of-name B/II or well-known synonyms (Castilla, "Jong <club>")
  if (/(?:^|[\\s-])(b|ii)(?:\\s*team)?$/i.test(name)) return true;
  if (/\\bcastilla\\b/i.test(name)) return true;
  if (/^\\s*jong\\s+/i.test(name)) return true;
  return false;
}

function flagsFor(name = '') {
  const lc = canon(name);
  const isWomen = hasWomenMarkers(name);
  const isYouth = hasYouthMarkers(name);
  const isReserve = hasReserveMarkers(name);
  const isBTeam = hasBTeamMarkers(name);
  const isWhitelistedB = B_WHILIST_CHECK(lc);
  return { isWomen, isYouth, isReserve, isBTeam, isWhitelistedB };
}

// Split out to be robust if we change storage
function B_WHILIST_CHECK(lc) {
  return B_WHITELIST.has(lc);
}

/**
 * Decide whether to drop a candidate based on *who* carries youth/B/Reserves/Women markers.
 * - Drop when our mapped team is Women (unless explicitly requested in rawTeam).
 * - Drop when our mapped team is Youth/Reserves or B/II (unless whitelisted or explicitly requested in rawTeam).
 * - Allow when only the opponent is youthish/B/etc.
 */
function shouldDropBySelfVsOpponent({ runnerNames = [], teamCanon = '', rawTeam = '' }) {
  // Identify the runner corresponding to our team and the opponent.
  const nonDraw = (runnerNames || []).filter(r => r && canon(r) !== 'the draw');
  const self = nonDraw.find(r => canon(r) === canon(teamCanon))
    || nonDraw.find(r => wordishContains(r, teamCanon))
    || null;
  if (!self) {
    // If we can't identify our runner, be conservative: keep the candidate.
    return false;
  }
  const opponent = nonDraw.find(r => r !== self) || '';

  const selfFlags = flagsFor(self);
  const oppFlags = flagsFor(opponent);
  const reqFlags  = flagsFor(rawTeam);

  // --- Women ---
  // Default: block Women if our mapped team is Women, UNLESS the acca explicitly asked for Women.
  if (selfFlags.isWomen) {
    if (reqFlags.isWomen) return false; // allow if the bet explicitly targets Women
    return true; // otherwise block
  }

  // --- Youth / Reserves ---
  const selfYouthish = selfFlags.isYouth || selfFlags.isReserve;
  const reqYouthish  = reqFlags.isYouth || reqFlags.isReserve;
  if (selfYouthish) {
    // Allow only if the acca explicitly requested a youth/reserve side; otherwise drop.
    if (reqYouthish) return false; // allowed because the leg says e.g. "Fulham U21"
    return true; // blocked: we matched a youth team but the acca didn't say youth
  }

  // --- B / II sides ---
  if (selfFlags.isBTeam) {
    // Always allow whitelisted well-known B/II teams.
    if (selfFlags.isWhitelistedB) return false;
    // If acca explicitly says B/II (e.g., "Barcelona B"), allow; else block.
    if (reqFlags.isBTeam) return false;
    return true;
  }

  // If only the opponent is youth/B/Reserves/Women → allow (do not drop).
  const opponentIsYouthish = oppFlags.isWomen || oppFlags.isYouth || oppFlags.isReserve || oppFlags.isBTeam;
  if (opponentIsYouthish) return false;

  // Otherwise, keep.
  return false;
}

// ---------- Betfair catalogue fetch ----------
/**
 * Query MATCH_ODDS catalogue candidates for a team.
 * We use a tight filter:
 * - eventTypeIds: Soccer
 * - marketTypeCodes: MATCH_ODDS
 * - inPlayOnly: false
 * - marketStartTime: now - 2h .. now + horizonHours (default 72h)
 * - textQuery: team (lets Betfair pre-filter by names/markets)
 */
async function fetchMoCandidatesForTeam(team, { horizonHours = 72 } = {}) {
  const fromIso = nowIso(-2 * 60 * 60 * 1000); // small negative to allow imminent KOs
  const toIso = nowIso(horizonHours * 60 * 60 * 1000);
  const filter = {
    eventTypeIds: [SOCCER_EVENT_TYPE_ID],
    marketTypeCodes: [MO_CODE],
    inPlayOnly: false,
    marketStartTime: { from: fromIso, to: toIso },
    textQuery: team,
  };
  const opts = { marketProjection: ['EVENT', 'COMPETITION', 'RUNNER_DESCRIPTION'], sort: 'FIRST_TO_START', maxResults: 200 };
  const cats = await listMarketCatalogue(filter, opts);
  return Array.isArray(cats) ? cats : [];
}

/**
 * Map a single leg { team } to { marketId, selectionId, eventId, eventName, koIso }
 */
export async function mapMatchOdds(leg, { debug = false, horizonHours = 72 } = {}) {
  const rawTeam = leg?.team || leg?.label || leg?.name || '';
  const teamCanon = canonTeamName(rawTeam);

  // IMPORTANT: triedName shows what we actually query Betfair with
  const triedName = teamCanon;
  const cats = await fetchMoCandidatesForTeam(teamCanon, { horizonHours });
  if (debug) console.log(`[map:MO] candidates for "${teamCanon}": ${cats.length}`);

  if (!cats.length) {
    return { ok: false, team: rawTeam, reason: 'NO_CANDIDATES', triedName };
  }

  // 1) Keep only candidates that actually include the team among runners (ignoring 'The Draw')
  const withTeam = cats.filter(c => {
    const runners = c?.runners || [];
    const nonDraw = runners.filter(r => r?.runnerName && canon(r.runnerName) !== 'the draw');
    const hasExact = nonDraw.some(r => canon(r.runnerName) === canon(teamCanon));
    const hasFuzzy = nonDraw.some(r => wordishContains(r.runnerName, teamCanon));
    return hasExact || hasFuzzy;
  });

  if (!withTeam.length) {
    return {
      ok: false,
      team: rawTeam,
      reason: 'NO_EVENT_MATCH',
      triedName,
      candidatesHint: cats.slice(0, 8).map(c => c?.event?.name).filter(Boolean),
    };
  }

  // 2) Context-aware filter: drop only if OUR TEAM is youth/B/Reserves/Women (w/ B whitelist) and not explicitly requested
  const postFilter = withTeam.filter(c => {
    const runnerNames = (c?.runners || []).map(r => r?.runnerName || '');
    const drop = shouldDropBySelfVsOpponent({ runnerNames, teamCanon, rawTeam });
    if (debug && drop) console.log('[map:MO] drop (self flagged as youth/B/women without explicit request)', { eventName: c?.event?.name, competitionName: c?.competition?.name });
    return !drop;
  });

  if (!postFilter.length) {
    return {
      ok: false,
      team: rawTeam,
      reason: 'NO_EVENT_MATCH_AFTER_FILTER',
      triedName,
      candidatesHint: withTeam.slice(0, 8).map(c => c?.event?.name).filter(Boolean),
    };
  }

  // 3) Prefer exact-runner matches; fall back to fuzzy; within each, pick earliest KO
  const exact = [];
  const fuzzy = [];
  for (const c of postFilter) {
    const nonDraw = (c?.runners || []).filter(r => r?.runnerName && canon(r.runnerName) !== 'the draw');
    const hasExact = nonDraw.some(r => canon(r.runnerName) === canon(teamCanon));
    if (hasExact) exact.push(c); else fuzzy.push(c);
  }
  exact.sort(sortByOpenDateAsc);
  fuzzy.sort(sortByOpenDateAsc);

  function pickFrom(list, preferExact) {
    for (const c of list) {
      const nonDraw = (c?.runners || []).filter(r => r?.runnerName && canon(r.runnerName) !== 'the draw');
      let hit = null;
      if (preferExact) {
        hit = nonDraw.find(r => canon(r.runnerName) === canon(teamCanon)) || null;
      }
      if (!hit) {
        hit = nonDraw.find(r => wordishContains(r.runnerName, teamCanon)) || null;
      }
      if (hit) return { c, hit };
    }
    return { c: null, hit: null };
  }

  let chosen = null; let runner = null;
  ({ c: chosen, hit: runner } = pickFrom(exact, true));
  if (!chosen || !runner) {
    ({ c: chosen, hit: runner } = pickFrom(fuzzy, false));
  }

  if (!chosen || !runner) {
    return {
      ok: false,
      team: rawTeam,
      reason: 'NO_RUNNER_FOR_TEAM',
      triedName,
      candidatesHint: postFilter.slice(0, 8).map(c => c?.event?.name).filter(Boolean),
    };
  }

  const res = {
    ok: true,
    team: rawTeam, // preserve original bookmaker wording for anything upstream/downstream
    marketId: chosen.marketId,
    selectionId: runner.selectionId,
    eventId: chosen?.event?.id || null,
    eventName: chosen?.event?.name || null,
    koIso: chosen?.event?.openDate || null,
    competition: chosen?.competition?.name || null,
  };

  if (debug) {
    console.log(
      `[map:MO] OK "${teamCanon}" -> event="${res.eventName}" | marketId=${res.marketId} | sel=${res.selectionId}`
    );
  }

  return res;
}

/**
 * Map many legs; preserves input order.
 * legs: [{ team: "Crystal Palace" }, ...]
 * Returns: { mapped: [..], unmatched: [..] }
 */
export async function mapAllToWinLegs(legs, { debug = false, horizonHours = 72, bookie = '' } = {}) {
  const mapped = [];
  const unmatched = [];

  for (const L of (legs || [])) {
    const r = await mapMatchOdds(L, { debug, horizonHours });
    if (r.ok) {
      mapped.push({
        team: r.team,
        marketId: r.marketId,
        selectionId: r.selectionId,
        eventId: r.eventId,
        eventName: r.eventName,
        koIso: r.koIso,
        competition: r.competition,
      });
    } else {
      unmatched.push({
        team: r.team,
        reason: r.reason,
        triedName: r.triedName,
        candidatesHint: r.candidatesHint,
      });
    }
  }

  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(
      `[map:ALL_TO_WIN] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`
    );
  }

  return { mapped, unmatched };
}

export default { mapAllToWinLegs, mapMatchOdds };