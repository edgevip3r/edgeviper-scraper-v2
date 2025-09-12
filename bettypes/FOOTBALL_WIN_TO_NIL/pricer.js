// bettypes/FOOTBALL_WIN_TO_NIL/pricer.js — partial-friendly with batched direct-book fallback
import { priceLegsFromBooks, priceFromMarketBook } from '../../lib/price/mid.js';
import { listMarketBook } from '../../lib/betfair/client.js';

/** Use mappedLegs order; if absent, build a minimal placeholder list */
function orderLegs(offer, mappedLegs){
  if (Array.isArray(mappedLegs) && mappedLegs.length){
    return mappedLegs.map(x => ({ ...x }));
  }
  // fall back to placeholders from offer.legs
  const legs = Array.isArray(offer?.legs) ? offer.legs : [];
  return legs.map(L => ({ team: L.team || L.label || L.name || '' }));
}

export async function price({ offer, mappedLegs, books }, ctx = {}){
  const debug = !!ctx.debug;

  const ordered = orderLegs(offer, mappedLegs);

  // 1) Price via normal books route
  let pricedLegs = priceLegsFromBooks(ordered, books).map(leg => ({
    ...leg,
    mid: Number.isFinite(leg?.pricing?.mid) ? Number(leg.pricing.mid) : null
  }));

  // 2) Fallback: fill any (marketId,selectionId) with direct listMarketBook mid
  const need = pricedLegs.filter(L => L.mid == null && L.marketId && (L.selectionId != null));
  if (need.length){
    const marketIds = Array.from(new Set(need.map(L => String(L.marketId))));
    try {
      const booksRes = await listMarketBook(marketIds, { priceData: ['EX_BEST_OFFERS'], virtualise: true });
      const byId = new Map((booksRes || []).map(b => [b.marketId, b]));
      for (let i = 0; i < pricedLegs.length; i++){
        const L = pricedLegs[i];
        if (L.mid == null && L.marketId && (L.selectionId != null)){
          const mb = byId.get(String(L.marketId));
          const px = priceFromMarketBook(mb, L.selectionId);
          const v = (px && typeof px.mid === 'number') ? px.mid : null;
          if (v != null){
            pricedLegs[i] = { ...L, mid: v, pricing: L.pricing || { mid: v, liq: px.liq ?? 0, spreadPct: px.spreadPct ?? null } };
          }
        }
      }
    } catch (e) {
      if (debug) console.log('[pricer:FOOTBALL_WIN_TO_NIL] fallback listMarketBook failed:', e?.message || e);
    }
  }

  const mids = pricedLegs.map(L => (Number.isFinite(L.mid) ? L.mid : null));
  const have = mids.filter(m => Number.isFinite(m) && m > 1).length;
  const allMids = (pricedLegs.length > 0) && (have === pricedLegs.length);

  // Debug mids (even for partials)
  if (debug){
    if (!allMids) {
      const missing = pricedLegs.length - have;
      console.log(`[pricer:FOOTBALL_WIN_TO_NIL] partial mapping -> expected=${pricedLegs.length} have=${have} (missing=${missing})`);
    } else {
      console.log(`[pricer:FOOTBALL_WIN_TO_NIL] all legs mapped -> n=${pricedLegs.length}`);
    }
    const midsStr = mids.map(v => (v==null ? 'n/a' : (Number(v).toFixed(3)))).join(' | ');
    const boosted = Number.isFinite(offer?.boostedOddsDec) ? Number(offer.boostedOddsDec).toFixed(3)
                    : Number.isFinite(offer?.boostedOdds) ? Number(offer.boostedOdds).toFixed(3)
                    : 'n/a';
    console.log(`[offer:FOOTBALL_WIN_TO_NIL] ${offer?.text || offer?.title || ''} | boosted=${boosted} | mids=[ ${midsStr} ]`);
  }

  const fairOddsDec = allMids ? mids.reduce((p, n) => p * (Number(n) || 1), 1) : null;

  return {
    pricedLegs,
    fairOddsDec,
    diagnostics: {
      minLiquidity: pricedLegs.reduce((m,L)=>Math.min(m, Number.isFinite(L?.pricing?.liq)?L.pricing.liq:Infinity), Infinity),
      maxSpreadPct: pricedLegs.reduce((m,L)=>{
        const s = Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null;
        return (s!=null && (m==null || s>m)) ? s : m;
      }, null)
    }
  };
}

export default { price };
