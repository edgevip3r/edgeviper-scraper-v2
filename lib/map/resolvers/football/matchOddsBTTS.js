//
// lib/map/resolvers/football/matchOddsBTTS.js (v6 minimal drop-in)
// Exports the legacy name `resolveMO_BTTS` and logs when actually called.
//
import * as BF from '../../betfair-football.js';
import { pickYesRunner, tokens } from '../../shared/runnerMatch.js';

export async function resolveMO_BTTS(leg, ctx = {}){
  const q = String(leg && (leg.team || leg.label || leg.name) || '').trim();
  const debug = !!ctx.debug;

  if (debug) console.log('[resolver:MO+BTTS] v6(active) team="%s"', q);

  const maxFutureHours = Number(process.env.EV_MAX_FUTURE_HOURS || (ctx.maxFutureHours ?? 72));

  // 1) Anchor via MO
  const ev = await BF.mapMatchOdds(q, { ...ctx, maxFutureHours });
  if (!ev || !ev.ok){
    if (debug) console.log('[MO+BTTS] NO_EVENT team="%s" reason="%s"', q, ev?.reason||'n/a');
    return { ok:false, reason: ev?.reason || 'NO_EVENT', team:q };
  }
  const { eventId, eventName, homeTeam, awayTeam, startTime } = ev;
  if (debug) console.log('[MO+BTTS] anchor ok | home="%s" away="%s" | prefer=%o homeTok=%o awayTok=%o',
    homeTeam, awayTeam, tokens(q), tokens(homeTeam), tokens(awayTeam));

  // 2) SGM market
  const sgm = await BF.findMatchOddsAndBTTSMarket(eventId, ctx);
  if (!sgm || !sgm.marketId){
    if (debug) console.log('[MO+BTTS] NO_SGM_MARKET team="%s" event="%s"', q, eventName);
    return { ok:false, reason:'NO_SGM_MARKET', team:q };
  }

  // 3) Read market book & pick YES runner
  const books = await BF.loadMarketBook([sgm.marketId], { bestPricesDepth: 1 });
  const book = Array.isArray(books) ? books[0] : null;
  const runners = book?.runners || [];
  if (debug){
    const names = runners.map(r => String(r.runnerName || r.selectionName || r.name || '')).join(' | ') || '(no runner names)';
    console.log('[MO+BTTS] runners: %s', names);
  }

  const yesRunner = pickYesRunner(
    runners,
    homeTeam || ev.homeName,
    awayTeam || ev.awayName,
    q,
    debug ? (m)=>console.log(m) : undefined
  );

  if (!yesRunner){
    if (debug){
      const names = runners.map(r => String(r.runnerName || r.selectionName || r.name || '')).join(' | ');
      console.log('[MO+BTTS] NO_YES_RUNNER team="%s" event="%s" runners=%s', q, eventName, names);
    }
    return { ok:false, reason:'NO_YES_RUNNER', team:q };
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

export async function mapMatchOddsAndBTTS(team, ctx = {}){
  // keep modern alias too
  return resolveMO_BTTS({ team }, ctx);
}

export default { resolveMO_BTTS, mapMatchOddsAndBTTS };
