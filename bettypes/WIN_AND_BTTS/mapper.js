// bettypes/WIN_AND_BTTS/mapper.js
// Lean mapper: anchor via MO, then fetch the same event’s MO&BTTS and pick "<Team>/Yes".

import { listMarketCatalogue } from '../../lib/betfair/client.js';
import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';

const SOCCER = '1';
const RX_MO_BTTS_NAME = /^(?:match\s*odds\s*(?:and|&)\s*both\s*teams\s*to\s*score)$/i;

function escRx(s){ return String(s||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function splitHomeAway(eventName){
  const p = String(eventName||'').split(/\sv\s/i);
  return p.length === 2 ? { home: p[0].trim(), away: p[1].trim() } : { home:null, away:null };
}

async function loadMoCat(marketId){
  const cats = await listMarketCatalogue(
    { marketIds: [marketId], eventTypeIds: [SOCCER] }, // IMPORTANT: inside filter
    { marketProjection: ['EVENT','RUNNER_DESCRIPTION'], maxResults: 5 }
  );
  const c = Array.isArray(cats) ? cats[0] : null;
  if (!c) return null;
  return {
    eventId: c?.event?.id || null,
    eventName: c?.event?.name || null,
    runners: (c?.runners || []).map(r => ({ selectionId: r.selectionId, runnerName: r.runnerName || '' }))
  };
}

async function loadMoBttsForEvent(eventId){
  // Prefer marketTypeCodes
  let cats = await listMarketCatalogue(
    { eventTypeIds: [SOCCER], eventIds: [eventId], marketTypeCodes: ['MATCH_ODDS_AND_BOTH_TEAMS_TO_SCORE'] },
    { marketProjection: ['RUNNER_DESCRIPTION'], maxResults: 10 }
  );
  if (!Array.isArray(cats) || cats.length === 0) {
    // Fallback strict name match
    const all = await listMarketCatalogue(
      { eventTypeIds: [SOCCER], eventIds: [eventId] },
      { marketProjection: ['RUNNER_DESCRIPTION','EVENT'], maxResults: 100 }
    );
    cats = (all || []).filter(c => RX_MO_BTTS_NAME.test(String(c.marketName||'')));
  }
  return Array.isArray(cats) && cats.length ? {
    marketId: cats[0].marketId,
    runners: (cats[0].runners || []).map(r => ({ selectionId: r.selectionId, runnerName: r.runnerName || '' }))
  } : null;
}

export async function map(offer, ctx = {}) {
  const debug = !!ctx.debug;
  const out = { mapped: [], unmatched: [] };

  // 1) Seed via MO mapper (same as ALL_TO_WIN)
  const legs = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));
  const mo = await mapAllToWinLegs(legs, { debug, bookie: ctx.bookie });

  for (let i = 0; i < legs.length; i++) {
    const team  = legs[i].team;
    const moMap = mo.mapped?.[i];
    if (!moMap?.marketId || !moMap?.selectionId) {
      out.unmatched.push({ team, reason: 'NO_MO_MAPPING' });
      if (debug) console.log(`[wbtts] ${team} -> NO_MO_MAPPING`);
      continue;
    }

    // 2) Get MO catalogue → eventId + exact MO runnerName (team as Betfair spells it)
    const moCat = await loadMoCat(moMap.marketId);
    if (!moCat?.eventId) {
      out.unmatched.push({ team, reason: 'NO_EVENT_ID' });
      if (debug) console.log(`[wbtts] ${team} -> NO_EVENT_ID`);
      continue;
    }
    const moRunner = moCat.runners.find(r => r.selectionId === moMap.selectionId);
    const moTeamName = moRunner?.runnerName || null;
    if (!moTeamName) {
      out.unmatched.push({ team, reason: 'MO_RUNNER_NOT_FOUND' });
      if (debug) console.log(`[wbtts] ${team} -> MO_RUNNER_NOT_FOUND | sel=${moMap.selectionId}`);
      continue;
    }

    // 3) Load MO&BTTS for THIS event (strictly)
    const mb = await loadMoBttsForEvent(moCat.eventId);
    if (!mb?.marketId) {
      out.unmatched.push({ team, reason: 'MO_BTTS_ABSENT', eventId: moCat.eventId, eventName: moCat.eventName });
      if (debug) console.log(`[wbtts] ${team} -> MO_BTTS_ABSENT | event="${moCat.eventName}"`);
      continue;
    }

    // 4) Pick "<Team>/Yes" (fallback to Home/Yes or Away/Yes if needed)
    const rxTeamYes = new RegExp(`^${escRx(moTeamName)}\\s*/\\s*Yes$`, 'i');
    let runner = mb.runners.find(r => rxTeamYes.test(r.runnerName));

    if (!runner) {
      const { home, away } = splitHomeAway(moCat.eventName);
      const isHome = home && moTeamName.toLowerCase() === home.toLowerCase();
      const rxHomeYes = /^Home\s*\/\s*Yes$/i;
      const rxAwayYes = /^Away\s*\/\s*Yes$/i;
      runner = mb.runners.find(r => isHome ? rxHomeYes.test(r.runnerName) : rxAwayYes.test(r.runnerName));
      if (!runner && debug) {
        console.log(`[wbtts] ${team} -> NO_YES_RUNNER | try="${moTeamName}/Yes" | runners=[ ${mb.runners.map(r=>r.runnerName).join(' | ')} ]`);
      }
    }

    if (!runner) { out.unmatched.push({ team, reason: 'NO_YES_RUNNER', marketId: mb.marketId }); continue; }

    out.mapped.push({
      team,
      marketId: mb.marketId,
      selectionId: runner.selectionId,
      eventId: moCat.eventId,
      eventName: moCat.eventName
    });

    if (debug) console.log(`[wbtts] ${team} -> OK | event="${moCat.eventName}" | btts="${runner.runnerName}"`);
  }

  if (debug) {
    const unm = (out.unmatched||[]).map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:WIN_AND_BTTS] done -> mapped=${out.mapped.length}/${(offer.legs||[]).length}; unmatched: ${unm}`);
  }
  return out;
}

export default { map };