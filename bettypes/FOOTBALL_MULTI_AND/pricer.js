
// bettypes/FOOTBALL_MULTI_AND/pricer.js — partial-friendly with batched direct-book fallback
import { priceLegsFromBooks, priceFromMarketBook } from '../../lib/price/mid.js';
import { listMarketBook } from '../../lib/betfair/client.js';

/** Count atomic legs expected by the composed offer */
function expectedCount(offer){
  let n = 0;
  const legs = Array.isArray(offer?.legs) ? offer.legs : [];
  for (const L of legs){
    const kind = (L?.kind || '').toUpperCase();
    if (kind === 'FOOTBALL_TEAM_WIN' || kind === 'ALL_TO_WIN'){
      const teams = Array.isArray(L?.params?.teams) ? L.params.teams
                  : (L?.params?.team ? [L.params.team] : []);
      n += teams.length;
    } else {
      n += 1;
    }
  }
  return n;
}

/** Build ordered atomic legs and merge mappedLegs onto them */
function orderLegs(offer, mappedLegs){
  const order = [];
  const legs = Array.isArray(offer?.legs) ? offer.legs : [];
  for (const L of legs){
    const kind = (L?.kind || '').toUpperCase();
    if (kind === 'FOOTBALL_TEAM_WIN' || kind === 'ALL_TO_WIN'){
      const teams = Array.isArray(L?.params?.teams) ? L.params.teams
                  : (L?.params?.team ? [L.params.team] : []);
      for (const t of teams){ order.push({ team: String(t || '') }); }
    } else {
      const t = L?.params?.team ?? L?.team ?? '';
      order.push({ team: String(t || '') });
    }
  }
  const left = Array.isArray(mappedLegs) ? [...mappedLegs] : [];
  const merged = order.map(slot => {
    const team = String(slot.team || '');
    const i = left.findIndex(x => (x.team || '').toLowerCase() === team.toLowerCase());
    if (i >= 0){
      const picked = left.splice(i,1)[0];
      return { ...slot, ...picked };
    }
    return { ...slot, marketId: null, selectionId: null };
  });
  return merged;
}

export async function price({ offer, mappedLegs, books }, ctx = {}){
  const debug = !!ctx.debug;

  const exp = expectedCount(offer);
  const ordered = orderLegs(offer, mappedLegs);

  // 1) Try book-based mids first (vectorised)
  let pricedLegs = priceLegsFromBooks(ordered, books).map(leg => ({
    ...leg,
    mid: Number.isFinite(leg?.pricing?.mid) ? Number(leg.pricing.mid) : null
  }));

  // 2) Fallback: for any leg that has marketId+selectionId but mid=null,
  //    batch fetch listMarketBook and compute mids via priceFromMarketBook.
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
      if (debug) console.log('[pricer:FOOTBALL_MULTI_AND] fallback listMarketBook failed:', e?.message || e);
    }
  }

  const mids = pricedLegs.map(L => (Number.isFinite(L.mid) ? L.mid : null));
  const have = mids.filter(m => Number.isFinite(m) && m > 1).length;
  const allMids = (exp > 0) && (have === exp);

  // Diagnostics
  const liqs = pricedLegs.map(L => Number.isFinite(L?.pricing?.liq) ? L.pricing.liq : 0);
  const minLiquidity = liqs.length ? Math.min(...liqs) : 0;
  const spreads = pricedLegs.map(L => Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null).filter(x => x != null);
  const maxSpreadPct = spreads.length ? Math.max(...spreads) : null;

  // Debug mids line (even on partials)
  if (debug){
    if (!allMids) {
      const missing = exp - have;
      console.log(`[pricer:FOOTBALL_MULTI_AND] partial mapping -> expected=${exp} have=${have} (missing=${missing})`);
    } else {
      console.log(`[pricer:FOOTBALL_MULTI_AND] all legs mapped -> n=${exp}`);
    }
    const midsStr = mids.map(v => (v==null ? 'n/a' : (Number(v).toFixed(3)))).join(' | ');
    const boosted = Number.isFinite(offer?.boostedOddsDec) ? Number(offer.boostedOddsDec).toFixed(3)
                    : Number.isFinite(offer?.boostedOdds) ? Number(offer.boostedOdds).toFixed(3)
                    : 'n/a';
    console.log(`[offer:FOOTBALL_MULTI_AND] ${offer?.text || offer?.title || ''} | boosted=${boosted} | mids=[ ${midsStr} ]`);
  }

  const fairOddsDec = allMids ? mids.reduce((p, n) => p * (Number(n) || 1), 1) : null;

  return {
    pricedLegs,
    fairOddsDec,
    diagnostics: { minLiquidity, maxSpreadPct }
  };
}

export default { price };
