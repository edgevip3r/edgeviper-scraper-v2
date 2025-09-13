//
// lib/map/resolvers/football/matchOddsBTTS.js (v5)
//
import * as BF from '../../betfair-football.js';
import { pickYesRunner, tokens } from '../../shared/runnerMatch.js';

let bannerOnce = false;

export async function mapMatchOddsAndBTTS(team, ctx = {}){
  if (!bannerOnce && ctx && ctx.debug){
    console.log('[resolver:MO+BTTS] v5 loaded');
    bannerOnce = true;
  }
  const q = String(team||'').trim();
  const debug = !!ctx.debug;
  const log = (msg)=>{ if (debug) console.log(msg); };

  const maxFutureHours = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));

  const ev = await BF.mapMatchOdds(q, { ...ctx, maxFutureHours });
  if (!ev || !ev.ok){
    log(`[MO+BTTS] NO_EVENT team="${q}" reason="${ev?.reason||'n/a'}"`);
    return { ok:false, reason: ev?.reason || 'NO_EVENT' };
  }
  const { eventId, eventName, homeTeam, awayTeam, startTime } = ev;
  log(`[MO+BTTS] anchoring via MO | team="${q}" | home="${homeTeam}" away="${awayTeam}" | tokens: prefer=${tokens(q).join(',')} home=${tokens(homeTeam).join(',')} away=${tokens(awayTeam).join(',')}`);

  const sgm = await BF.findMatchOddsAndBTTSMarket(eventId, ctx);
  if (!sgm || !sgm.marketId){
    log(`[MO+BTTS] NO_SGM_MARKET team="${q}" event="${eventName}"`);
    return { ok:false, reason:'NO_SGM_MARKET' };
  }

  const books = await BF.loadMarketBook([sgm.marketId], { bestPricesDepth: 1 });
  const book = Array.isArray(books) ? books[0] : null;
  const runners = (book && Array.isArray(book.runners)) ? book.runners : [];
  if (debug){
    const names = runners.map(r => String(r.runnerName || r.selectionName || r.name || '')).join(' | ') || '(no runner names on MarketBook)';
    log(`[MO+BTTS] market="${sgm.marketId}" runners=${names}`);
  }

  const yesRunner = pickYesRunner(
    runners,
    homeTeam || ev.homeName,
    awayTeam || ev.awayName,
    q,
    debug ? (msg)=>console.log(msg) : undefined
  );

  if (!yesRunner){
    log(`[MO+BTTS] NO_YES_RUNNER team="${q}" event="${eventName}"`);
    return { ok:false, reason:'NO_YES_RUNNER' };
  }

  return {
    ok: true,
    book: 'betfair',
    eventId,
    marketId: sgm.marketId,
    runnerId: yesRunner.selectionId || yesRunner.id,
    runnerName: yesRunner.runnerName || yesRunner.selectionName || yesRunner.name,
    startTime,
    _debug: { eventName, homeTeam: homeTeam || ev.homeName, awayTeam: awayTeam || ev.awayName, marketName: sgm.marketName || 'SGM:MO+BTTS' }
  };
}

export const resolveMO_BTTS = mapMatchOddsAndBTTS;
export default { resolveMO_BTTS, mapMatchOddsAndBTTS };
