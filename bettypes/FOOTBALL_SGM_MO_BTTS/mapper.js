// bettypes/FOOTBALL_SGM_MO_BTTS/mapper.js — restore MO-anchored SGM (Win & BTTS) mapping like legacy
import { listMarketCatalogue } from '../../lib/betfair/client.js';
import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';

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
function legLine(L){
  const ev = L.eventName || L.event || L.match || 'unknown event';
  const k = fmt(L.koIso || L.eventStart || L.startTime || L.kickoff);
  const comp = L.competition || L.league || '';
  const mk = L.marketId ? ` mkt=${L.marketId}` : '';
  const sel = L.selectionId ? ` sel=${L.selectionId}` : '';
  return `${L.team || L.label || ''} -> ${ev}${comp? ' ('+comp+')' : ''} @ ${k}${mk}${sel}`;
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
  // 1) Try by type code (preferred)
  let cats = await listMarketCatalogue(
    { eventTypeIds: ['1'], eventIds: [eventId], marketTypeCodes: ['MATCH_ODDS_AND_BOTH_TEAMS_TO_SCORE'] },
    { marketProjection: ['RUNNER_DESCRIPTION'], maxResults: 10 }
  );
  if (!Array.isArray(cats) || cats.length === 0) {
    // 2) Fallback: strict name match within this event
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
      if (debug) console.log(`[wbtts.v2] ${team} -> NO_MO_MAPPING`);
      continue;
    }

    // 2) MO catalogue → eventId + exact Betfair team runner name + KO
    const moCat = await loadMoCat(moMap.marketId);
    if (!moCat?.eventId) {
      out.unmatched.push({ team, reason: 'NO_EVENT_ID' });
      if (debug) console.log(`[wbtts.v2] ${team} -> NO_EVENT_ID`);
      continue;
    }
    const moRunner = moCat.runners.find(r => r.selectionId === moMap.selectionId);
    const moTeamName = moRunner?.runnerName || null;
    if (!moTeamName) {
      out.unmatched.push({ team, reason: 'MO_RUNNER_NOT_FOUND' });
      if (debug) console.log(`[wbtts.v2] ${team} -> MO_RUNNER_NOT_FOUND | sel=${moMap.selectionId}`);
      continue;
    }

    // 3) Load MO&BTTS for THIS event (strict)
    const mb = await loadMoBttsForEvent(moCat.eventId);
    if (!mb?.marketId) {
      out.unmatched.push({ team, reason: 'MO_BTTS_ABSENT', eventId: moCat.eventId, eventName: moCat.eventName });
      if (debug) console.log(`[wbtts.v2] ${team} -> MO_BTTS_ABSENT | event="${moCat.eventName}"`);
      continue;
    }

    // 4) Pick "<Team>/Yes" or Home/Yes / Away/Yes
    const rxTeamYes = new RegExp(`^${escRx(moTeamName)}\\s*/\\s*Yes$`, 'i');
    let runner = mb.runners.find(r => rxTeamYes.test(r.runnerName));

    if (!runner) {
      const { home } = splitHomeAway(moCat.eventName);
      const isHome = home && moTeamName.toLowerCase() === home.toLowerCase();
      const rxHomeYes = /^Home\s*\/\s*Yes$/i;
      const rxAwayYes = /^Away\s*\/\s*Yes$/i;
      runner = mb.runners.find(r => (isHome ? rxHomeYes : rxAwayYes).test(r.runnerName));
      if (!runner && debug) {
        console.log(`[wbtts.v2] ${team} -> NO_YES_RUNNER | try="${moTeamName}/Yes" | runners=[ ${mb.runners.map(r=>r.runnerName).join(' | ')} ]`);
      }
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
      koIso: moCat.eventOpenDate || null
    });

    if (debug) {
      const h = hoursFromNow(moCat.eventOpenDate);
      const far = (h!=null && h>maxFutureHrs) ? ` [SKIP:FUTURE +${Math.round(h)}h]` : '';
      console.log(`[wbtts.v2] ${team} -> OK | event="${moCat.eventName}" | btts="${runner.runnerName}" ${far}`);
    }
  }

  if (debug) {
    const unm = (out.unmatched||[]).map(u => `${u.team}:${u.reason}`).join(' | ') || 'none';
    console.log(`[map:FOOTBALL_SGM_MO_BTTS] done -> mapped=${out.mapped.length}/${(offer.legs||[]).length}; unmatched: ${unm}`);
  }

  return out;
}

export default { map };