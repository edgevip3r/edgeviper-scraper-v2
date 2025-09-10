// bettypes/FOOTBALL_MULTI_AND/pricer.js — strict: all atomic legs must price
import { priceLegsFromBooks } from '../../lib/price/mid.js';

/**
 * Compute how many atomic legs are required by the offer structure.
 */
function expectedCount(offer){
  let n = 0;
  const legs = Array.isArray(offer?.legs) ? offer.legs : [];
  for (const L of legs){
    const kind = (L?.kind || '').toUpperCase();
    if (kind === 'FOOTBALL_TEAM_WIN' || kind === 'ALL_TO_WIN'){
      const teams = Array.isArray(L?.params?.teams) ? L.params.teams : (L?.params?.team ? [L.params.team] : []);
      n += teams.length;
    } else if (kind === 'FOOTBALL_SGM_MO_BTTS' || kind === 'WIN_AND_BTTS' || kind === 'FOOTBALL_WIN_TO_NIL'){
      n += 1;
    } else {
      // default to one atomic leg
      n += 1;
    }
  }
  return n;
}

/**
 * Build an ordered list of atomic legs (with team ids where possible) from the offer,
 * and merge any mappedLegs onto it by team label. This keeps placeholders for missing legs.
 */
function orderLegs(offer, mappedLegs){
  const order = [];
  const legs = Array.isArray(offer?.legs) ? offer.legs : [];
  for (const L of legs){
    const kind = (L?.kind || '').toUpperCase();
    if (kind === 'FOOTBALL_TEAM_WIN' || kind === 'ALL_TO_WIN'){
      const teams = Array.isArray(L?.params?.teams) ? L.params.teams : (L?.params?.team ? [L.params.team] : []);
      for (const t of teams){
        order.push({ team: String(t || '') });
      }
    } else if (kind === 'FOOTBALL_SGM_MO_BTTS' || kind === 'WIN_AND_BTTS' || kind === 'FOOTBALL_WIN_TO_NIL'){
      const t = L?.params?.team || (Array.isArray(L?.params?.teams) ? L.params.teams[0] : '');
      order.push({ team: String(t || '') });
    } else {
      order.push({ team: '' });
    }
  }

  // Merge mappedLegs into this order by team label (case-insensitive)
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

export function price({ offer, mappedLegs, books }, ctx = {}){
  const debug = !!ctx.debug;
  const exp = expectedCount(offer);
  const ordered = orderLegs(offer, mappedLegs);

  const pricedLegs = priceLegsFromBooks(ordered, books).map(leg => ({
    ...leg, mid: Number.isFinite(leg?.pricing?.mid) ? Number(leg.pricing.mid) : null
  }));

  const mids = pricedLegs.map(L => (Number.isFinite(L.mid) ? L.mid : null));
  const have = mids.filter(m => Number.isFinite(m) && m > 1).length;
  const allMids = (exp > 0) && (have === exp);
  const fairOddsDec = allMids ? mids.reduce((p, n) => p * (Number(n) || 1), 1) : null;

  const liqs = pricedLegs.map(L => Number.isFinite(L?.pricing?.liq) ? L.pricing.liq : 0);
  const minLiquidity = liqs.length ? Math.min(...liqs) : 0;
  const spreads = pricedLegs.map(L => Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null).filter(x => x != null);
  const maxSpreadPct = spreads.length ? Math.max(...spreads) : null;

  if (debug && !allMids) {
    const missing = exp - have;
    console.log(`[pricer:FOOTBALL_MULTI_AND] partial mapping -> expected=${exp} have=${have} (missing=${missing})`);
  }

  return { pricedLegs, fairOddsDec, diagnostics: { minLiquidity, maxSpreadPct } };
}

export default { price };
