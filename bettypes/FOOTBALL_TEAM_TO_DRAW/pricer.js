
// bettypes/FOOTBALL_TEAM_TO_DRAW/pricer.js — multiply mid prices across legs (same as TEAM_WIN pattern)
import { mid } from '../../lib/price/mid.js';

export async function price(offer, ctx = {}){
  const legs = offer.mapped || offer.legs || [];
  if (!Array.isArray(legs) || !legs.length) return { ok:false, reason:'NO_LEGS' };

  let fair = 1.0;
  const priced = [];
  for (const L of legs){
    const m = await mid(L.marketId, L.selectionId, ctx);
    if (!m || !m.mid) return { ok:false, reason:'NO_MID', leg:L };
    fair *= m.mid;
    priced.push({ ...L, mid: m.mid });
  }

  return {
    ok: true,
    fairOdds: fair,
    legs: priced
  };
}

export default { price };
