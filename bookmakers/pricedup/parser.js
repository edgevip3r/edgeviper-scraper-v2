// bookmakers/pricedup/parser.js
// Parse PricedUp boosts HTML into raw offers (title + fractional odds).
// Do NOT set sourceUrl here; run.parse.js will fill (or fallback to base URL).

import * as cheerio from 'cheerio';
import { cleanText } from '../../lib/text/clean.js';

// selectors (robust to CSS hash changes)
const NAME_SEL  = 'div[class*="SelectionsGroupName"]';
const CARD_SEL  = 'li[class*="SelectionsGroupLiItem"]';
const ODDS_SEL  = 'a[class*="SelectionItemStyle"],button[class*="SelectionItemStyle"]';

function pickFractional(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (/^(EVS|EVENS)$/i.test(s)) return 'EVS';
  const m = s.match(/(\d+)\s*[\/\u2044]\s*(\d+)/); // 10/3 or 10⁄3
  return m ? `${m[1]}/${m[2]}` : null;
}

export function parsePricedUp(html, ctx = {}) {
  const debug = !!ctx.debug;
  const $ = cheerio.load(html);

  const rawOffers = [];
  let itemsSeen = 0, missingOdds = 0, missingName = 0;

  $(CARD_SEL).each((_, li) => {
    itemsSeen++;

    // Name
    const $name = $(li).find(NAME_SEL).first();
    const titleRaw = ($name.attr('title') || $name.text() || '').trim();
    const title = cleanText(titleRaw, ['(was', 'Was ', 'Price Boost']).trim();

    // Odds (fractional/EVS) — scan the selection anchors/buttons
    let oddsFrac = null;
    const $oddsNodes = $(li).find(ODDS_SEL);
    $oddsNodes.each((__, node) => {
      if (oddsFrac) return;
      const cand = pickFractional($(node).text());
      if (cand) oddsFrac = cand;
    });

    if (!title) { missingName++; return; }
    if (!oddsFrac) { missingOdds++; return; }

    rawOffers.push({
      bookie: 'pricedup',
      book: 'Priced Up',
      text: title,
      textOriginal: titleRaw,
      boostedOddsFrac: oddsFrac,
      // legacy compatibility keys used by downstream
      oddsRaw: oddsFrac,
      sportHint: 'Football',
      meta: { source: 'pricedup' }
    });
  });

  if (debug) {
    console.log(`[parse:pricedup] card nodes: ${itemsSeen}`);
    for (const r of rawOffers.slice(0, 5)) {
      console.log(' -', r.text, '| frac:', r.boostedOddsFrac);
    }
  }

  return {
    rawOffers,
    diagnostics: { itemsSeen, emitted: rawOffers.length, missingOdds, missingName }
  };
}

export default parsePricedUp;