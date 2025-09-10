
// bettypes/FOOTBALL_TEAM_TO_DRAW/mapper.js — MO-anchored draw leg
// Approach: anchor event via MO (using team name), then pick the Draw runner in that MO market.
import { mapAllToWinLegs } from '../../lib/map/betfair-football.js';
import { listMarketCatalogue } from '../../lib/betfair/client.js';
import { printMapperDebug } from '../../lib/map/shared/print.js';

async function loadMoCat(marketId){
  const cats = await listMarketCatalogue(
    { marketIds: [marketId], eventTypeIds: ['1'] },
    { marketProjection: ['EVENT','RUNNER_DESCRIPTION'], maxResults: 5 }
  );
  return Array.isArray(cats) && cats.length ? cats[0] : null;
}

export async function map(offer, ctx = {}){
  const debug = !!ctx.debug;
  const maxFutureHrs = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));
  const legsIn = (offer.legs || []).map(L => ({ team: L.team || L.label || L.name || '' }));
  const out = { mapped: [], unmatched: [] };

  // Anchor each leg via MO
  const mo = await mapAllToWinLegs(legsIn, { debug: false, bookie: ctx.bookie, horizonHours: maxFutureHrs });

  for (let i = 0; i < legsIn.length; i++){
    const { team } = legsIn[i];
    const moLeg = mo?.mapped?.[i];
    if (!moLeg?.marketId){
      out.unmatched.push({ team, reason: 'NO_MO_MAPPING' });
      continue;
    }
    const cat = await loadMoCat(moLeg.marketId);
    if (!cat?.runners?.length){
      out.unmatched.push({ team, reason: 'NO_MO_CATALOGUE' });
      continue;
    }
    const drawRunner = cat.runners.find(r => /^draw$/i.test(String(r.runnerName||'')));
    if (!drawRunner){
      out.unmatched.push({ team, reason: 'NO_DRAW_RUNNER' });
      continue;
    }
    out.mapped.push({
      team,
      marketId: cat.marketId,
      selectionId: drawRunner.selectionId,
      eventId: cat?.event?.id || null,
      eventName: cat?.event?.name || null,
      koIso: cat?.event?.openDate || null,
      _marketTag: 'MO:DRAW'
    });
  }

  if (debug){
    printMapperDebug('FOOTBALL_TEAM_TO_DRAW', legsIn, out, { horizonHours: maxFutureHrs });
  }
  return out;
}

export default { map };
