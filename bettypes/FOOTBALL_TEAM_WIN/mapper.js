
// bettypes/FOOTBALL_TEAM_WIN/mapper.js — uses shared printer for consistent debug
import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';
import { printMapperDebug } from '../../lib/map/shared/print.js';

export async function map(offer, ctx = {}) {
  const debug = !!ctx.debug;
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));
  const legsIn = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));

  const res = await mapAllToWinLegs(legsIn, { debug: false, bookie: ctx.bookie, horizonHours: maxFutureHrs });

  if (debug) {
    printMapperDebug('FOOTBALL_TEAM_WIN', legsIn, res, { horizonHours: maxFutureHrs });
  }
  return { mapped: res?.mapped || [], unmatched: res?.unmatched || [] };
}

export default { map };
