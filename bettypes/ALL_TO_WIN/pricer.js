// bettypes/ALL_TO_WIN/pricer.js
// Prices MO multiple: attach mids from market books and combine as product.

import { priceLegsFromBooks } from '../../lib/price/mid.js';

/**
 * @param {object} input - { offer, mappedLegs, books }
 * @param {object} ctx   - { debug, bookie }
 * @returns {{ pricedLegs:Array, fairOddsDec:number|null, diagnostics:Object }}
 */
function price(input, ctx = {}) {
  const { offer, mappedLegs, books } = input;
  // order-preserving merge back to original legs
  const legsOrdered = (offer.legs || []).map(L => {
    const team = L.team || L.label || L.name || '';
    const i = mappedLegs.findIndex(x => x.team === team);
    if (i >= 0) {
      const picked = mappedLegs.splice(i, 1)[0];
      return { ...L, ...picked };
    }
    return { ...L, team, marketId: null, selectionId: null };
  });

  const pricedLegs = priceLegsFromBooks(legsOrdered, books).map(leg => ({
    ...leg,
    mid: leg?.pricing?.mid ?? null
  }));

  const mids = pricedLegs.map(L => (Number.isFinite(L.mid) ? Number(L.mid) : null));
  const allMids = mids.every(m => m && m > 1);
  const fairOddsDec = allMids ? mids.reduce((p, n) => p * n, 1) : null;

  const liqs = pricedLegs.map(L => Number.isFinite(L?.pricing?.liq) ? L.pricing.liq : 0);
  const minLiquidity = liqs.length ? Math.min(...liqs) : 0;
  const spreads = pricedLegs.map(L => Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null).filter(x => x != null);
  const maxSpreadPct = spreads.length ? Math.max(...spreads) : null;

  return {
    pricedLegs,
    fairOddsDec,
    diagnostics: { minLiquidity, maxSpreadPct }
  };
}

export { price };
export default { price };