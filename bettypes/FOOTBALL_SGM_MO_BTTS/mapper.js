
// bettypes/FOOTBALL_SGM_MO_BTTS/mapper.js — MO-anchored SGM (Win & BTTS) + shared debug printer
import { listMarketCatalogue } from '../../lib/betfair/client.js';
import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';
import { printMapperDebug } from '../../lib/map/shared/print.js';

const RX_MO_BTTS_NAME = /^(?:match\s*odds\s*(?:and|&)\s*both\s*teams\s*to\s*score)$/i;

function escRx(s){ return String(s||'').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function splitHomeAway(eventName){
  const p = String(eventName||'').split(/\sv\s/i);
  return p.length === 2 ? { home: p[0].trim(), away: p[1].trim() } : { home:null, away:null };
}
function fmt(dt){
  if(!dt) return 'n/a';
  try { const d = new Date(dt);
    const y = d.getUTCFullYear(); const m = String(d.getUTCMonth()+1).padStart(2,'0');
    const da = String(d.getUTCDate()).padStart(2,'0'); const hh=String(d.getUTCHours()).padStart(2,'0'); const mm=String(d.getUTCMinutes()).padStart(2,'0');
    return `${y}-${m}-${da} ${hh}:${mm}Z`;
  } catch { return String(dt); }
}
function hoursFromNow(dt){
  if(!dt) return null;
  try { return (new Date(dt).getTime() - Date.now()) / 36e5; } catch { return null; }
}

async function loadMoCat(marketId){
  const cats = await listMarketCatalogue(
    { marketIds: [marketId], eventTypeIds: ['1'] },
    { marketProjection: ['EVENT','RUNNER_DESCRIPTION'], maxResults: 5 }
  );
  const c = Array.isArray(cats) ? cats[0] : null;
  if (!c) return null;
  return {
    eventId: c?.event?.id || null,
    eventName: c?.event?.name || null,
    eventOpenDate: c?.event?.openDate || null,
    runners: (c?.runners || []).map(r => ({ selectionId: r.selectionId, runnerName: r.runnerName || '' }))
  };
}

async function loadMoBttsForEvent(eventId){
  let cats = await listMarketCatalogue(
    { eventTypeIds: ['1'], eventIds: [eventId], marketTypeCodes: ['MATCH_ODDS_AND_BOTH_TEAMS_TO_SCORE'] },
    { marketProjection: ['RUNNER_DESCRIPTION'], maxResults: 10 }
  );
  if (!Array.isArray(cats) || cats.length === 0) {
    const all = await listMarketCatalogue(
      { eventTypeIds: ['1'], eventIds: [eventId] },
      { marketProjection: ['RUNNER_DESCRIPTION','EVENT'], maxResults: 100 }
    );
    cats = (all || []).filter(c => RX_MO_BTTS_NAME.test(String(c.marketName||'')));
  }
  return (Array.isArray(cats) && cats.length)
    ? { marketId: cats[0].marketId,
        runners: (cats[0].runners || []).map(r => ({ selectionId: r.selectionId, runnerName: r.runnerName || '' })) }
    : null;
}

export async function map(offer, ctx = {}) {
  const debug = !!ctx.debug;
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));
  const legs = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));
  const out = { mapped: [], unmatched: [] };

  // 1) Anchor via MO mapper (same seed as legacy ALL_TO_WIN)
  const mo = await mapAllToWinLegs(legs, { debug: false, bookie: ctx.bookie, horizonHours: maxFutureHrs });

  for (let i = 0; i < legs.length; i++) {
    const team = legs[i].team;
    const moMap = mo?.mapped?.[i];

    if (!moMap?.marketId || !moMap?.selectionId) {
      out.unmatched.push({ team, reason: 'NO_MO_MAPPING' });
      continue;
    }

    // 2) MO catalogue → eventId + exact Betfair team runner name + KO
    const moCat = await loadMoCat(moMap.marketId);
    if (!moCat?.eventId) {
      out.unmatched.push({ team, reason: 'NO_EVENT_ID' });
      continue;
    }
    const moRunner = moCat.runners.find(r => r.selectionId === moMap.selectionId);
    const moTeamName = moRunner?.runnerName || null;
    if (!moTeamName) {
      out.unmatched.push({ team, reason: 'MO_RUNNER_NOT_FOUND' });
      continue;
    }

    // 3) Load MO&BTTS for THIS event (strict)
    const mb = await loadMoBttsForEvent(moCat.eventId);
    if (!mb?.marketId) {
      out.unmatched.push({ team, reason: 'MO_BTTS_ABSENT', eventId: moCat.eventId, eventName: moCat.eventName });
      continue;
    }

    // 4) Pick "/Yes" or Home/Yes / Away/Yes
    const rxTeamYes = new RegExp(`^${escRx(moTeamName)}\\s*/\\s*Yes$`, 'i');
    let runner = mb.runners.find(r => rxTeamYes.test(r.runnerName));

    if (!runner) {
      const { home } = splitHomeAway(moCat.eventName);
      const isHome = home && moTeamName.toLowerCase() === home.toLowerCase();
      const rxHomeYes = /^Home\s*\/\s*Yes$/i;
      const rxAwayYes = /^Away\s*\/\s*Yes$/i;
      runner = mb.runners.find(r => (isHome ? rxHomeYes : rxAwayYes).test(r.runnerName));
    }

    if (!runner) {
      out.unmatched.push({ team, reason: 'NO_YES_RUNNER', marketId: mb.marketId });
      continue;
    }

    out.mapped.push({
      team,
      marketId: mb.marketId,
      selectionId: runner.selectionId,
      eventId: moCat.eventId,
      eventName: moCat.eventName,
      koIso: moCat.eventOpenDate || null,
      _marketTag: 'SGM:MO+BTTS'
    });
  }

  if (debug) {
    printMapperDebug('FOOTBALL_SGM_MO_BTTS', legs, out, { horizonHours: maxFutureHrs });
  }
  return out;
}

export default { map };
