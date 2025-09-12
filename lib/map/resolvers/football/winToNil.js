// lib/map/resolvers/football/winToNil.js
// Resolve Betfair "<Team> Win To Nil" market via MO anchor, then select "Yes".
import { resolveMO } from './matchOdds.js';
import { listMarketCatalogue } from '../../../betfair/client.js';

/**
 * Find "<Team> Win To Nil" market for the MO-anchored event and pick the "Yes" runner.
 * Returns: { ok:true, team, eventId, eventName, competition, koIso, marketId, selectionId }
 */
export async function resolveWinToNil(leg, { horizonHours = 72, debug = false } = {}){
  const baseTeam = String(leg?.team || leg?.label || leg?.name || '').trim();
  if (!baseTeam) return { ok:false, team:'', reason:'NO_TEAM' };

  // 1) Anchor event via MO
  const mo = await resolveMO({ team: baseTeam }, { horizonHours, debug });
  if (!mo || !mo.ok) return { ok:false, team: baseTeam, reason: mo?.reason || 'NO_EVENT_MATCH' };

  const { eventId, eventName, competition, koIso } = mo;

  // 2) Search markets for that event id looking for "<Team> Win To Nil"
  const timeFrom = new Date(Date.now() - 2*60*60*1000).toISOString();
  const timeTo   = new Date(Date.now() + horizonHours*60*60*1000).toISOString();

  const filter = {
    eventTypeIds: ['1'],
    eventIds: [ String(eventId) ],
    inPlayOnly: false,
    marketStartTime: { from: timeFrom, to: timeTo },
    textQuery: `${baseTeam} Win To Nil`
  };

  let cats = [];
  try{
    // Some environments take (obj,opts), others take (filter, opts). Try both.
    const r1 = await listMarketCatalogue({ filter, maxResults: 100, marketProjection: ['EVENT','COMPETITION','RUNNER_DESCRIPTION'] });
    if (Array.isArray(r1) && r1.length) cats = r1;
    if (!cats.length) {
      const r2 = await listMarketCatalogue(filter, { maxResults: 100, marketProjection: ['EVENT','COMPETITION','RUNNER_DESCRIPTION'] });
      if (Array.isArray(r2) && r2.length) cats = r2;
    }
  }catch(e){
    if (debug) console.log('[resolveWinToNil] listMarketCatalogue error:', e?.message || e);
  }

  const rx = new RegExp(`\\b${escapeRx(baseTeam)}\\b\\s*Win\\s*To\\s*Nil`, 'i');
  const mkt = cats.find(c => rx.test(String(c?.marketName || '')));
  if (!mkt) {
    return { ok:false, team: baseTeam, reason:'NO_WTN_MARKET', eventId, eventName, competition, koIso };
  }

  const yes = (Array.isArray(mkt.runners) ? mkt.runners : []).find(r => /^yes$/i.test(String(r?.runnerName || '')));
  if (!yes) {
    return { ok:false, team: baseTeam, reason:'NO_YES_RUNNER', eventId, eventName, competition, koIso };
  }

  return {
    ok: true,
    team: baseTeam,
    eventId, eventName, competition, koIso,
    marketId: mkt.marketId,
    selectionId: yes.selectionId
  };
}

function escapeRx(s){
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default { resolveWinToNil };
