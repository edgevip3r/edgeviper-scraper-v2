// bettypes/FOOTBALL_TEAM_WIN/pricer.js — strict: all legs must price or fair=null
import { priceLegsFromBooks } from '../../lib/price/mid.js';

/**
 * @param {{ offer:Object, mappedLegs:Array, books:Array }} input
 * @param {{ debug?:boolean }} ctx
 */
export function price({ offer, mappedLegs, books }, ctx = {}) {
  const debug = !!ctx.debug;
  // Order-preserving merge back to original legs so missing legs stay present as nulls
  const legsOrdered = (offer.legs || []).map(L => {
    const team = L.team || L.label || L.name || '';
    const i = mappedLegs.findIndex(x => (x.team || '').toLowerCase() === team.toLowerCase());
    if (i >= 0) {
      const picked = mappedLegs.splice(i, 1)[0];
      return { ...L, ...picked };
    }
    return { ...L, team, marketId: null, selectionId: null };
  });

  // Price each leg (keeps null mids for missing legs)
  const pricedLegs = priceLegsFromBooks(legsOrdered, books).map(leg => ({
    ...leg, mid: Number.isFinite(leg?.pricing?.mid) ? Number(leg.pricing.mid) : null
  }));

  const mids = pricedLegs.map(L => (Number.isFinite(L.mid) ? L.mid : null));
  const expected = pricedLegs.length;
  const have = mids.filter(m => Number.isFinite(m) && m > 1).length;
  const allMids = (expected > 0) && (have === expected);

  const fairOddsDec = allMids ? mids.reduce((p, n) => p * (Number(n) || 1), 1) : null;

  // Diagnostics
  const liqs = pricedLegs.map(L => Number.isFinite(L?.pricing?.liq) ? L.pricing.liq : 0);
  const minLiquidity = liqs.length ? Math.min(...liqs) : 0;
  const spreads = pricedLegs.map(L => Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null).filter(x => x != null);
  const maxSpreadPct = spreads.length ? Math.max(...spreads) : null;

  if (debug && !allMids) {
    const missing = expected - have;
    console.log(`[pricer:FOOTBALL_TEAM_WIN] partial mapping -> expected=${expected} have=${have} (missing=${missing})`);
  }

  return { pricedLegs, fairOddsDec, diagnostics: { minLiquidity, maxSpreadPct } };
}

export default { price };
