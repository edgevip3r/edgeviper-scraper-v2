
// lib/map/betfair-football.js
// Thin core that delegates to resolvers. In DEBUG, it augments results with a
// `details` object including per-leg candidate lists fetched directly from Betfair,
// so printers can show `candidates=N -> name | name ...` without touching resolver logic.
//
// Behaviour for mapping/pricing is unchanged.

import { resolveMO } from './resolvers/football/matchOdds.js';
import { resolveMO_BTTS } from './resolvers/football/matchOddsBTTS.js';
import { listMarketCatalogue } from '../betfair/client.js';

const SOCCER = '1';
const MO_CODE = 'MATCH_ODDS';
const MO_BTTS_CODE = 'MATCH_ODDS_AND_BOTH_TEAMS_TO_SCORE';

function nowIso(offsetMs = 0){ return new Date(Date.now() + offsetMs).toISOString(); }
function keyOf(L){ return String((L && (L.team || L.label || L.name)) || '').trim().toLowerCase(); }
function chosenBlock(r){
  return {
    eventName: r?.eventName || null,
    eventStart: r?.koIso || null,
    competition: r?.competition || null,
    marketId: r?.marketId || null,
    selectionId: r?.selectionId ?? null,
    selName: null,
  };
}

async function listMarketCatalogueCompat(filter, { maxResults=200, marketProjection=['EVENT','COMPETITION','RUNNER_DESCRIPTION'], sort='FIRST_TO_START' } = {}){
  try{ const r=await listMarketCatalogue({ filter, maxResults, marketProjection, sort }); if(Array.isArray(r)) return r; }catch(e){}
  try{ const r=await listMarketCatalogue(filter, { maxResults, marketProjection, sort }); if(Array.isArray(r)) return r; }catch(e){}
  try{ const r=await listMarketCatalogue(filter, maxResults, marketProjection, sort); if(Array.isArray(r)) return r; }catch(e){ throw e; }
  return [];
}

function horizonRange(h){ return { from: nowIso(-2*60*60*1000), to: nowIso(h*60*60*1000) }; }

async function fetchCandidates(team, marketTypeCode, horizonHours){
  const filter={
    eventTypeIds:[SOCCER],
    marketTypeCodes:[marketTypeCode],
    inPlayOnly:false,
    marketStartTime: horizonRange(horizonHours),
    textQuery: team
  };
  const cats = await listMarketCatalogueCompat(filter, { maxResults:200, marketProjection:['EVENT','COMPETITION','RUNNER_DESCRIPTION'], sort:'FIRST_TO_START' });
  return (Array.isArray(cats)?cats:[]).map(c => (c && c.event && c.event.name) || '').filter(Boolean);
}

export async function mapMatchOdds(leg, opts = {}) {
  return resolveMO(leg, opts);
}

export async function mapAllToWinLegs(legs, { debug = false, horizonHours = 72, bookie = '' } = {}) {
  const mapped = [];
  const unmatched = [];
  const details = Object.create(null);

  for (let i = 0; i < (legs || []).length; i++) {
    const L = legs[i];
    const r = await resolveMO(L, { debug, horizonHours });
    const k = keyOf(L);

    if (r && r.ok) {
      mapped.push({
        team:r.team, marketId:r.marketId, selectionId:r.selectionId,
        eventId:r.eventId, eventName:r.eventName, koIso:r.koIso, competition:r.competition
      });
      details[k] = details[k] || { candidates: null, skipped: [], chosen: null, notes: [] };
      details[k].chosen = chosenBlock(r);
    } else {
      unmatched.push({
        team:(r && r.team) || (L && (L.team || L.label || L.name)) || '',
        reason:r && r.reason, triedName:r && r.triedName, candidatesHint:r && r.candidatesHint
      });
      details[k] = details[k] || { candidates: null, skipped: [], chosen: null, notes: [] };
    }

    if (debug) {
      try{
        const team = (L && (L.team || L.label || L.name)) || '';
        const names = await fetchCandidates(team, MO_CODE, horizonHours);
        details[k] = details[k] || { candidates: null, skipped: [], chosen: null, notes: [] };
        details[k].candidates = names.map(n => ({ name:n }));
      }catch(e){ /* ignore debug fetch failure */ }
    }
  }

  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:ALL_TO_WIN] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`);
  }
  return { mapped, unmatched, details };
}

export async function mapMatchOddsAndBTTS(leg, opts = {}) {
  return resolveMO_BTTS(leg, opts);
}

export async function mapWinAndBttsLegs(legs, { debug = false, horizonHours = 72, bookie = '' } = {}) {
  const mapped = [];
  const unmatched = [];
  const details = Object.create(null);

  for (let i = 0; i < (legs || []).length; i++) {
    const L = legs[i];
    const r = await resolveMO_BTTS(L, { debug, horizonHours });
    const k = keyOf(L);

    if (r && r.ok) {
      mapped.push({
        team:r.team, marketId:r.marketId, selectionId:r.selectionId,
        eventId:r.eventId, eventName:r.eventName, koIso:r.koIso, competition:r.competition
      });
      details[k] = details[k] || { candidates: null, skipped: [], chosen: null, notes: [] };
      details[k].chosen = { ...chosenBlock(r), selName: 'Yes' };
    } else {
      unmatched.push({
        team:(r && r.team) || (L && (L.team || L.label || L.name)) || '',
        reason:r && r.reason, triedName:r && r.triedName, candidatesHint:r && r.candidatesHint
      });
      details[k] = details[k] || { candidates: null, skipped: [], chosen: null, notes: [] };
    }

    if (debug) {
      try{
        const team = (L && (L.team || L.label || L.name)) || '';
        const names = await fetchCandidates(team, MO_BTTS_CODE, horizonHours);
        details[k] = details[k] || { candidates: null, skipped: [], chosen: null, notes: [] };
        details[k].candidates = names.map(n => ({ name:n }));
      }catch(e){ /* ignore debug fetch failure */ }
    }
  }

  if (debug) {
    const unm = unmatched.map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:WIN_AND_BTTS] done -> mapped=${mapped.length}/${(legs || []).length}; unmatched: ${unm}`);
  }
  return { mapped, unmatched, details };
}

export default { mapAllToWinLegs, mapMatchOdds, mapWinAndBttsLegs, mapMatchOddsAndBTTS };
