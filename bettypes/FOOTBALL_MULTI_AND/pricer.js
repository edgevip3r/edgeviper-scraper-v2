
// bettypes/FOOTBALL_MULTI_AND/pricer.js — strict but debug-friendly mids on partials
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
 * and merge any mappedLegs onto it by team label. Keeps placeholders for missing legs.
 */
function orderLegs(offer, mappedLegs){
  const order = [];
  const legs = Array.isArray(offer?.legs) ? offer.legs : [];
  for (const L of legs){
    const kind = (L?.kind || '').toUpperCase();
    if (kind === 'FOOTBALL_TEAM_WIN' || kind === 'ALL_TO_WIN'){
      const teams = Array.isArray(L?.params?.teams) ? L.params.teams : (L?.params?.team ? [L.params.team] : []);
      for (const t of teams){ order.push({ team: String(t || '') }); }
    } else if (kind === 'FOOTBALL_SGM_MO_BTTS' || kind === 'WIN_AND_BTTS' || kind === 'FOOTBALL_WIN_TO_NIL'){
      const t = L?.params?.team || (Array.isArray(L?.params?.teams) ? L.params.teams[0] : '');
      order.push({ team: String(t || '') });
    } else {
      order.push({ team: '' });
    }
  }
  // Merge mappedLegs by team label (case-insensitive)
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

  // Price via book mid APIs (does not require all legs to be present)
  const pricedLegs = priceLegsFromBooks(ordered, books).map(leg => ({
    ...leg,
    mid: Number.isFinite(leg?.pricing?.mid) ? Number(leg.pricing.mid) : null
  }));

  const mids = pricedLegs.map(L => (Number.isFinite(L.mid) ? L.mid : null));
  const have = mids.filter(m => Number.isFinite(m) && m > 1).length;
  const allMids = (exp > 0) && (have === exp);

  // Diagnostics
  const liqs = pricedLegs.map(L => Number.isFinite(L?.pricing?.liq) ? L.pricing.liq : 0);
  const minLiquidity = liqs.length ? Math.min(...liqs) : 0;
  const spreads = pricedLegs.map(L => Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null).filter(x => x != null);
  const maxSpreadPct = spreads.length ? Math.max(...spreads) : null;

  // --- Added: debug mids line even on partials (mirrors TEAM_WIN style) ---
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
  // ----------------------------------------------------------------------

  const fairOddsDec = allMids ? mids.reduce((p, n) => p * (Number(n) || 1), 1) : null;

  return {
    pricedLegs,
    fairOddsDec,
    diagnostics: { minLiquidity, maxSpreadPct }
  };
}

export default { price };
