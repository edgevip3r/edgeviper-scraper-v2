// bookmakers/nrg/parser.js
// Parse NRG boosts HTML into raw offers (title + fractional odds).
// v1 scope: FOOTBALL ONLY — structurally scoped to EventRowWrapper whose
// EventRowHeader contains the word "Football". Avoids Tennis/Horse Racing.

import * as cheerio from 'cheerio';
import { cleanText } from '../../lib/text/clean.js';

// Structural selectors from the site
const WRAPPER_SEL = 'div[class*="EventRowWrapper"]';
const HEADER_SEL  = 'div[class*="EventRowHeader"]';
const NAME_SEL    = 'div[class*="SelectionsGroupName"]';
const CARD_SEL    = 'li[class*="SelectionsGroupLiItem"]';
const ODDS_SEL    = 'a[class*="SelectionItemStyle"],button[class*="SelectionItemStyle"]';

function pickFractional(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (/^(EVS|EVENS)$/i.test(s)) return 'EVS';
  const m = s.match(/(\d+)\s*[\/\u2044]\s*(\d+)/); // 10/3 or 10⁄3
  return m ? `${m[1]}/${m[2]}` : null;
}

export function parseNRG(html, ctx = {}) {
  const debug = !!ctx.debug;
  const $ = cheerio.load(html);

  const rawOffers = [];
  let wrappersTotal = 0, wrappersFootball = 0;
  let cardsSeen = 0, emitted = 0, missingOdds = 0, missingName = 0;

  $(WRAPPER_SEL).each((_, wrapper) => {
    wrappersTotal++;

    const headerText = ($(wrapper).find(HEADER_SEL).first().text() || '').trim();
    const isFootball = /football/i.test(headerText);
    if (!isFootball) return; // HARD FILTER: non-football dropped at source
    wrappersFootball++;

    // Only parse cards within this Football wrapper
    $(wrapper).find(CARD_SEL).each((__, li) => {
      cardsSeen++;

      // Name
      const $name = $(li).find(NAME_SEL).first();
      const titleRaw = ($name.attr('title') || $name.text() || '').trim();
      // Remove noisy tokens for pricing/posting, but keep original separately
      const title = cleanText(titleRaw, ['(was', 'Was ', 'Price Boost']).trim();

      // Odds (fractional/EVS)
      let oddsFrac = null;
      const $oddsNodes = $(li).find(ODDS_SEL);
      $oddsNodes.each((___, node) => {
        if (oddsFrac) return;
        const cand = pickFractional($(node).text());
        if (cand) oddsFrac = cand;
      });

      if (!title) { missingName++; return; }
      if (!oddsFrac) { missingOdds++; return; }

      rawOffers.push({
        bookie: 'nrg',
        book: 'NRG',
        text: title,
        textOriginal: titleRaw,
        boostedOddsFrac: oddsFrac,
        oddsRaw: oddsFrac,
        sportHint: 'Football',
        meta: { source: 'nrg', header: headerText }
      });
      emitted++;
    });
  });

  if (debug) {
    console.log(`[parse:nrg] wrappers total: ${wrappersTotal} | football: ${wrappersFootball}`);
    console.log(`[parse:nrg] cards seen: ${cardsSeen} | emitted: ${emitted} | missingOdds: ${missingOdds} | missingName: ${missingName}`);
    for (const r of rawOffers.slice(0, 5)) {
      console.log(' -', r.text, '| frac:', r.boostedOddsFrac);
    }
  }

  return { rawOffers, diagnostics: { wrappersTotal, wrappersFootball, cardsSeen, emitted, missingOdds, missingName } };
}

export default parseNRG;
