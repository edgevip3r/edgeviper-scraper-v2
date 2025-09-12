// lib/map/betfair-football.js
// Central Betfair football mappers: MO, MO+BTTS, Team-to-Draw, Win-to-Nil
import { resolveMO } from './resolvers/football/matchOdds.js';
import { resolveMO_BTTS } from './resolvers/football/matchOddsBTTS.js';
import { resolveWinToNil } from './resolvers/football/winToNil.js';

export async function mapMatchOdds(leg, opts = {}) {
  return resolveMO(leg, opts);
}

export async function mapAllToWinLegs(legs, { debug = false, horizonHours = 72 } = {}) {
  const mapped = [];
  const unmatched = [];
  for (let i = 0; i < (legs || []).length; i++) {
    const L = legs[i];
    const r = await resolveMO(L, { debug, horizonHours });
    if (r && r.ok) {
      mapped.push({
        team:r.team, marketId:r.marketId, selectionId:r.selectionId,
        eventId:r.eventId, eventName:r.eventName, koIso:r.koIso, competition:r.competition
      });
    } else {
      unmatched.push({
        team:(r && r.team) || (L && (L.team || L.label || L.name)) || '',
        reason:r && r.reason, triedName:r && r.triedName, candidatesHint:r && r.candidatesHint
      });
    }
  }
  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:ALL_TO_WIN] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`);
  }
  return { mapped, unmatched };
}

export async function mapMatchOddsAndBTTS(leg, opts = {}) {
  return resolveMO_BTTS(leg, opts);
}

export async function mapWinAndBttsLegs(legs, { debug = false, horizonHours = 72 } = {}) {
  const mapped = [];
  const unmatched = [];
  for (let i = 0; i < (legs || []).length; i++) {
    const L = legs[i];
    const r = await resolveMO_BTTS(L, { debug, horizonHours });
    if (r && r.ok) {
      mapped.push({
        team:r.team, marketId:r.marketId, selectionId:r.selectionId,
        eventId:r.eventId, eventName:r.eventName, koIso:r.koIso, competition:r.competition
      });
    } else {
      unmatched.push({
        team:(r && r.team) || (L && (L.team || L.label || L.name)) || '',
        reason:r && r.reason, triedName:r && r.triedName, candidatesHint:r && r.candidatesHint
      });
    }
  }
  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:WIN_AND_BTTS] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`);
  }
  return { mapped, unmatched };
}

// NEW: map Win To Nil legs via the resolver
export async function mapWinToNilLegs(legs, { debug = false, horizonHours = 72 } = {}) {
  const mapped = [];
  const unmatched = [];
  for (let i = 0; i < (legs || []).length; i++) {
    const L = legs[i];
    const r = await resolveWinToNil(L, { debug, horizonHours });
    if (r && r.ok) {
      mapped.push({
        team:r.team, marketId:r.marketId, selectionId:r.selectionId,
        eventId:r.eventId, eventName:r.eventName, koIso:r.koIso, competition:r.competition
      });
    } else {
      unmatched.push({ team:(r && r.team) || (L && (L.team || L.label || L.name)) || '', reason:r && r.reason });
    }
  }
  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:WIN_TO_NIL] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`);
  }
  return { mapped, unmatched };
}

export default {
  mapAllToWinLegs,
  mapMatchOdds,
  mapWinAndBttsLegs,
  mapMatchOddsAndBTTS,
  mapWinToNilLegs,
};
