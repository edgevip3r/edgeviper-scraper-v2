// lib/price/mid.js
// Compute mid prices for Betfair runners from listMarketBook output (EX_BEST_OFFERS).
// Exposes helpers to extract best prices and compute a mid/spread/liquidity snapshot per leg.

/**
 * Pull the best back/lay price+size from a Betfair runner EX ladder.
 * @param {object} runner - item from marketBook.runners[]
 * @returns {{ backPrice:number|null, backSize:number, layPrice:number|null, laySize:number }}
 */
export function runnerBestPrices(runner) {
  const ex = runner?.ex || {};
  const bb = Array.isArray(ex.availableToBack) && ex.availableToBack.length ? ex.availableToBack[0] : null;
  const bl = Array.isArray(ex.availableToLay) && ex.availableToLay.length ? ex.availableToLay[0] : null;
  return {
    backPrice: bb?.price ?? null,
    backSize:  Number.isFinite(bb?.size) ? Number(bb.size) : 0,
    layPrice:  bl?.price ?? null,
    laySize:   Number.isFinite(bl?.size) ? Number(bl.size) : 0
  };
}

/**
 * Compute mid price, spread %, and a simple liquidity metric from best prices.
 * - mid: (back+lay)/2 when both sides available; else use the solo side as a weak proxy.
 * - spreadPct: (lay - back) / mid * 100 when both present, else null.
 * - liq: min(backSize, laySize) — conservative per-leg liquidity at top of book.
 * @param {{ backPrice:number|null, backSize:number, layPrice:number|null, laySize:number }} bp
 * @returns {{ mid:number|null, spreadPct:number|null, liq:number }}
 */
export function midFromBest(bp) {
  const { backPrice, layPrice, backSize, laySize } = bp;
  let mid = null;
  if (Number.isFinite(backPrice) && Number.isFinite(layPrice)) {
    mid = (backPrice + layPrice) / 2;
  } else if (Number.isFinite(backPrice)) {
    mid = backPrice; // weaker estimate if only back side visible
  } else if (Number.isFinite(layPrice)) {
    mid = layPrice; // weaker estimate if only lay side visible
  }
  const spreadPct = (Number.isFinite(backPrice) && Number.isFinite(layPrice) && Number.isFinite(mid) && mid > 0)
    ? ((layPrice - backPrice) / mid) * 100
    : null;

  const liq = Math.min(
    Number.isFinite(backSize) ? backSize : 0,
    Number.isFinite(laySize) ? laySize : 0
  );

  return { mid: Number.isFinite(mid) ? mid : null, spreadPct: Number.isFinite(spreadPct) ? spreadPct : null, liq };
}

/**
 * Given a marketBook and a selectionId, compute the pricing snapshot for that runner.
 * @param {object} marketBook - one element from listMarketBook result
 * @param {number} selectionId
 * @returns {{
 *   selectionId:number,
 *   back:number|null, lay:number|null,
 *   backSize:number, laySize:number,
 *   mid:number|null, spreadPct:number|null, liq:number,
 *   totalMatched:number|null
 * }|null}
 */
export function priceFromMarketBook(marketBook, selectionId) {
  if (!marketBook || !Array.isArray(marketBook.runners)) return null;
  const r = marketBook.runners.find(x => x.selectionId === selectionId);
  if (!r) return null;

  const { backPrice, backSize, layPrice, laySize } = runnerBestPrices(r);
  const { mid, spreadPct, liq } = midFromBest({ backPrice, backSize, layPrice, laySize });

  return {
    selectionId,
    back: backPrice,
    lay: layPrice,
    backSize,
    laySize,
    mid,
    spreadPct,
    liq,
    totalMatched: Number.isFinite(marketBook.totalMatched) ? marketBook.totalMatched : null
  };
}

/**
 * Price a set of mapped legs against a list of marketBooks.
 * @param {Array<{ team:string, marketId:string, selectionId:number }>} mappedLegs
 * @param {Array<object>} marketBooks - result from listMarketBook()
 * @returns {Array<object>} legs with pricing fields merged
 */
export function priceLegsFromBooks(mappedLegs = [], marketBooks = []) {
  const byId = new Map((marketBooks || []).map(b => [b.marketId, b]));
  return mappedLegs.map(leg => {
    const mb = byId.get(leg.marketId);
    const px = priceFromMarketBook(mb, leg.selectionId);
    return {
      ...leg,
      pricing: px || {
        selectionId: leg.selectionId,
        back: null, lay: null, backSize: 0, laySize: 0,
        mid: null, spreadPct: null, liq: 0, totalMatched: null
      }
    };
  });
}

export default {
  runnerBestPrices,
  midFromBest,
  priceFromMarketBook,
  priceLegsFromBooks
};