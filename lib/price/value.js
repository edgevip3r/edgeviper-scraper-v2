export function computeFairOddsProduct(legs) {
// Stub: multiply leg.mid if present
let p = 1; let ok = true; for (const l of legs) { if (l.mid == null) { ok = false; break; } p *= l.mid; }
return ok ? p : null;
}


export function passesFilters({ rating, minLiquidityOk, spreadOk }, cfg) {
if (rating == null) return false;
if (cfg.threshold && rating < cfg.threshold) return false;
if (cfg.requireMinLiquidity && !minLiquidityOk) return false;
if (cfg.enforceSpread && !spreadOk) return false;
return true;
}