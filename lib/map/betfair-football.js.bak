// lib/map/betfair-football.js
// Alias-aware Betfair MATCH_ODDS mapper with correct selectionId handling.
//
// Key points:
// • Fans out Betfair search across all alias KEYS that point to the same team ID(s).
// • Matches runners against ANY alias (exact or fuzzy), not just canonical.
// • Returns a *Runner object* (with selectionId) by keeping a nonDrawRunners array of objects.
// • Youth/B/Reserves/Women: blocks only when OUR team is youth/B/Women unless explicitly requested (or whitelisted B).
// • Opponent-only youth/B/etc is allowed.
// • Safe code for Node (no Unicode property regex); compat wrapper for listMarketCatalogue.
//
// Exports: mapMatchOdds, mapAllToWinLegs
//
import { listMarketCatalogue } from '../betfair/client.js';
import fs from 'fs';
import path from 'path';

const SOCCER_EVENT_TYPE_ID = '1';
const MO_CODE = 'MATCH_ODDS';

// ---------- utils ----------
function nowIso(offsetMs = 0) { return new Date(Date.now() + offsetMs).toISOString(); }
function canon(s) { return String(s || '').toLowerCase().replace(/[\s\u00A0]+/g, ' ').trim(); }
function normalizeForWordish(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
function wordishContains(hay, needle) {
  const H = ' ' + normalizeForWordish(hay) + ' ';
  const N = ' ' + normalizeForWordish(needle) + ' ';
  if (!N.trim()) return false;
  return H.indexOf(N) !== -1;
}
function sortByOpenDateAsc(a, b) {
  const da = new Date((a && a.event && a.event.openDate) || 0).getTime();
  const db = new Date((b && b.event && b.event.openDate) || 0).getTime();
  if (da === db) return 0; return da < db ? -1 : 1;
}

// ---------- alias helpers ----------
let __CFG = null;
let __ALIAS_MAP = null;
function loadConfig() {
  if (!__CFG) {
    const p = path.resolve('config/global.json');
    __CFG = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return __CFG;
}
function loadAliasMap() {
  if (!__ALIAS_MAP) {
    const cfg = loadConfig();
    const p = path.resolve((cfg && cfg.normalize && cfg.normalize.teamAliasesPath) || 'data/compiled/aliases.index.json');
    __ALIAS_MAP = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return __ALIAS_MAP;
}
// Primary query string
function canonTeamName(input) {
  if (!input) return input;
  const m = loadAliasMap();
  const key = canon(input);
  const val = m[key];
  return (typeof val === 'string') ? val : input; // arrays (IDs) -> fall back to input string
}
// All alias KEYS for same team IDs as rawTeam
function aliasKeysForInput(rawTeam) {
  try {
    const m = loadAliasMap();
    const key = canon(rawTeam);
    const val = m[key];
    const ids = Array.isArray(val) ? new Set(val) : (val ? new Set([val]) : new Set());
    if (!ids.size) return [];
    const out = [];
    for (const k in m) {
      if (!Object.prototype.hasOwnProperty.call(m, k)) continue;
      const v = m[k];
      const arr = Array.isArray(v) ? v : (v ? [v] : []);
      for (let i = 0; i < arr.length; i++) { if (ids.has(arr[i])) { out.push(k); break; } }
    }
    // de-dup
    const seen = new Set(); const deduped = [];
    for (const k of out) if (!seen.has(k)) { seen.add(k); deduped.push(k); }
    return deduped;
  } catch { return []; }
}
// runnerName vs aliases
function matchesAnyAliasName(runnerName, aliasNames) {
  const rn = runnerName || '';
  for (let i = 0; i < aliasNames.length; i++) {
    const a = aliasNames[i];
    if (!a) continue;
    if (canon(rn) === canon(a)) return true;
    if (wordishContains(rn, a)) return true;
  }
  return false;
}

// ---------- flags (youth/B/etc) ----------
const B_WHITELIST = new Set([
  'real sociedad b','barcelona b','bayern munich ii','real madrid castilla',
  'jong ajax','jong psv','jong az','jong utrecht',
]);
function hasWomenMarkers(n=''){ return /(?:^|[\s-])(women|ladies|femenino|fem)(?:$|[\s-])/i.test(n); }
function hasYouthMarkers(n=''){ return /(?:^|[\s-])(u-?\d{2}|under\s?\d{2}|u\d{2}|youth)(?:$|[\s-])/i.test(n); }
function hasReserveMarkers(n=''){ return /\breserves?\b/i.test(n); }
function hasBTeamMarkers(n=''){ if (/(?:^|[\s-])(b|ii)(?:\s*team)?$/i.test(n)) return true; if (/\bcastilla\b/i.test(n)) return true; if (/^\s*jong\s+/i.test(n)) return true; return false; }
function flagsFor(name=''){ const lc = canon(name); return {
  isWomen: hasWomenMarkers(name),
  isYouth: hasYouthMarkers(name),
  isReserve: hasReserveMarkers(name),
  isBTeam: hasBTeamMarkers(name),
  isWhitelistedB: B_WHITELIST.has(lc),
};}
function findSelfAndOpponent(runnerNames, aliasNames) {
  // runnerNames: array of *strings*
  const nonDraw = [];
  for (let i = 0; i < runnerNames.length; i++) {
    const nm = runnerNames[i];
    if (nm && canon(nm) !== 'the draw') nonDraw.push(nm);
  }
  let self = null;
  for (let i = 0; i < nonDraw.length; i++) { if (matchesAnyAliasName(nonDraw[i], aliasNames)) { self = nonDraw[i]; break; } }
  const opponent = nonDraw.find(r => r !== self) || '';
  return { self, opponent };
}
function shouldDropBySelfVsOpponent({ runnerNames = [], aliasNames = [], rawTeam = '' }) {
  const { self, opponent } = findSelfAndOpponent(runnerNames, aliasNames);
  if (!self) return false;
  const selfFlags = flagsFor(self);
  const oppFlags = flagsFor(opponent);
  const reqFlags  = flagsFor(rawTeam);
  if (selfFlags.isWomen) return !reqFlags.isWomen;
  const selfYouthish = selfFlags.isYouth || selfFlags.isReserve;
  const reqYouthish  = reqFlags.isYouth || reqFlags.isReserve;
  if (selfYouthish) return !reqYouthish;
  if (selfFlags.isBTeam) { if (selfFlags.isWhitelistedB) return false; if (reqFlags.isBTeam) return false; return true; }
  const opponentIsYouthish = oppFlags.isWomen || oppFlags.isYouth || oppFlags.isReserve || oppFlags.isBTeam;
  if (opponentIsYouthish) return false;
  return false;
}

// ---------- Betfair fetch ----------
async function listMarketCatalogueCompat(filter, { maxResults = 200, marketProjection = ['EVENT','COMPETITION','RUNNER_DESCRIPTION'], sort = 'FIRST_TO_START' } = {}) {
  try { const r = await listMarketCatalogue({ filter, maxResults, marketProjection, sort }); if (Array.isArray(r)) return r; } catch(e){}
  try { const r = await listMarketCatalogue(filter, { maxResults, marketProjection, sort }); if (Array.isArray(r)) return r; } catch(e){}
  try { const r = await listMarketCatalogue(filter, maxResults, marketProjection, sort); if (Array.isArray(r)) return r; } catch(e){ throw e; }
  return [];
}
async function fetchMoCandidatesForTeam(team, { horizonHours = 72 } = {}) {
  const fromIso = nowIso(-2 * 60 * 60 * 1000);
  const toIso = nowIso(horizonHours * 60 * 60 * 1000);
  const filter = {
    eventTypeIds: [SOCCER_EVENT_TYPE_ID],
    marketTypeCodes: [MO_CODE],
    inPlayOnly: false,
    marketStartTime: { from: fromIso, to: toIso },
    textQuery: team,
  };
  const cats = await listMarketCatalogueCompat(filter, { maxResults: 200, marketProjection: ['EVENT','COMPETITION','RUNNER_DESCRIPTION'], sort: 'FIRST_TO_START' });
  return Array.isArray(cats) ? cats : [];
}

// ---------- map one ----------
export async function mapMatchOdds(leg, { debug = false, horizonHours = 72 } = {}) {
  const rawTeam = (leg && (leg.team || leg.label || leg.name)) || '';
  const teamCanon = canonTeamName(rawTeam);
  const aliasKeys = aliasKeysForInput(rawTeam);
  // aliasNames are *strings* we consider equal to our team
  const aliasNames = (() => {
    const set = new Set([teamCanon, ...aliasKeys]);
    // Remove empties
    set.delete(''); set.delete(null); set.delete(undefined);
    return Array.from(set);
  })();

  // Query fan-out
  let cats = [];
  for (let i = 0; i < aliasNames.length; i++) {
    const q = aliasNames[i];
    const r = await fetchMoCandidatesForTeam(q, { horizonHours });
    if (debug) console.log(`[map:MO] textQuery="${q}" -> candidates=${(Array.isArray(r) ? r.length : 0)}`);
    if (r && r.length) { cats = r; break; }
  }
  const triedName = teamCanon;
  if (!cats.length) return { ok:false, team:rawTeam, reason:'NO_CANDIDATES', triedName };

  // Keep only candidates where runners include ANY alias
  const withTeam = [];
  for (let i = 0; i < cats.length; i++) {
    const c = cats[i];
    const runners = (c && c.runners) || [];
    const nonDrawRunners = [];
    for (let j = 0; j < runners.length; j++) {
      const rr = runners[j];
      if (rr && rr.runnerName && canon(rr.runnerName) !== 'the draw') nonDrawRunners.push(rr);
    }
    let ok = false;
    for (let j = 0; j < nonDrawRunners.length; j++) {
      if (matchesAnyAliasName(nonDrawRunners[j].runnerName, aliasNames)) { ok = true; break; }
    }
    if (ok) withTeam.push(c);
  }
  if (!withTeam.length) {
    const hint = cats.slice(0, 8).map(c => (c && c.event && c.event.name) || null).filter(Boolean);
    return { ok:false, team:rawTeam, reason:'NO_EVENT_MATCH', triedName, candidatesHint: hint };
  }

  // Context-aware drop (team youth/B/women blocked unless explicit; opponent-only allowed)
  const postFilter = [];
  for (let i = 0; i < withTeam.length; i++) {
    const c = withTeam[i];
    const names = ((c && c.runners) || []).map(r => (r && r.runnerName) || '');
    const drop = shouldDropBySelfVsOpponent({ runnerNames: names, aliasNames, rawTeam });
    if (debug && drop) console.log('[map:MO] drop (self youth/B/women without explicit request)', { eventName: c && c.event && c.event.name, competitionName: c && c.competition && c.competition.name });
    if (!drop) postFilter.push(c);
  }
  if (!postFilter.length) {
    const hint = withTeam.slice(0, 8).map(c => (c && c.event && c.event.name) || null).filter(Boolean);
    return { ok:false, team:rawTeam, reason:'NO_EVENT_MATCH_AFTER_FILTER', triedName, candidatesHint: hint };
  }

  // Prefer exact alias match; else fuzzy; earliest KO within each class
  const exact = []; const fuzzy = [];
  for (let i = 0; i < postFilter.length; i++) {
    const c = postFilter[i];
    const nonDrawRunners = [];
    const runners = (c && c.runners) || [];
    for (let j = 0; j < runners.length; j++) {
      const rr = runners[j];
      if (rr && rr.runnerName && canon(rr.runnerName) !== 'the draw') nonDrawRunners.push(rr);
    }
    let hasExact = false;
    for (let j = 0; j < nonDrawRunners.length; j++) {
      const nm = nonDrawRunners[j].runnerName;
      for (let k = 0; k < aliasNames.length; k++) {
        if (canon(nm) === canon(aliasNames[k])) { hasExact = true; break; }
      }
      if (hasExact) break;
    }
    if (hasExact) exact.push(c); else fuzzy.push(c);
  }
  exact.sort(sortByOpenDateAsc);
  fuzzy.sort(sortByOpenDateAsc);

  function pickFrom(list, preferExact) {
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const nonDrawRunners = [];
      const runners = (c && c.runners) || [];
      for (let j = 0; j < runners.length; j++) {
        const rr = runners[j];
        if (rr && rr.runnerName && canon(rr.runnerName) !== 'the draw') nonDrawRunners.push(rr);
      }
      let hit = null;
      if (preferExact) {
        for (let j = 0; j < nonDrawRunners.length; j++) {
          const nm = nonDrawRunners[j].runnerName;
          for (let k = 0; k < aliasNames.length; k++) {
            if (canon(nm) === canon(aliasNames[k])) { hit = nonDrawRunners[j]; break; }
          }
          if (hit) break;
        }
      }
      if (!hit) {
        for (let j = 0; j < nonDrawRunners.length; j++) {
          if (matchesAnyAliasName(nonDrawRunners[j].runnerName, aliasNames)) { hit = nonDrawRunners[j]; break; }
        }
      }
      if (hit) return { c, hit };
    }
    return { c:null, hit:null };
  }

  let chosen = null, runner = null;
  ({ c: chosen, hit: runner } = pickFrom(exact, true));
  if (!chosen || !runner) { ({ c: chosen, hit: runner } = pickFrom(fuzzy, false)); }
  if (!chosen || !runner) {
    const hint = postFilter.slice(0, 8).map(c => (c && c.event && c.event.name) || null).filter(Boolean);
    return { ok:false, team:rawTeam, reason:'NO_RUNNER_FOR_TEAM', triedName, candidatesHint: hint };
  }

  const res = {
    ok: true,
    team: rawTeam,
    marketId: chosen.marketId,
    selectionId: runner && runner.selectionId || null,
    eventId: (chosen && chosen.event && chosen.event.id) || null,
    eventName: (chosen && chosen.event && chosen.event.name) || null,
    koIso: (chosen && chosen.event && chosen.event.openDate) || null,
    competition: (chosen && chosen.competition && chosen.competition.name) || null
  };
  if (debug) console.log(`[map:MO] OK "${teamCanon}" -> event="${res.eventName}" | marketId=${res.marketId} | sel=${res.selectionId}`);
  return res;
}

// ---------- map many ----------
export async function mapAllToWinLegs(legs, { debug = false, horizonHours = 72, bookie = '' } = {}) {
  const mapped = []; const unmatched = [];
  for (let i = 0; i < (legs || []).length; i++) {
    const L = legs[i];
    const r = await mapMatchOdds(L, { debug, horizonHours });
    if (r && r.ok) {
      mapped.push({ team:r.team, marketId:r.marketId, selectionId:r.selectionId, eventId:r.eventId, eventName:r.eventName, koIso:r.koIso, competition:r.competition });
    } else {
      unmatched.push({ team:r.team, reason:r.reason, triedName:r.triedName, candidatesHint:r.candidatesHint });
    }
  }
  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:ALL_TO_WIN] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`);
  }
  return { mapped, unmatched };
}

export default { mapAllToWinLegs, mapMatchOdds };
