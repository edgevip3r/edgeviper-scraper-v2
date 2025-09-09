// bookmakers/pricedup/parser.js
// FOOTBALL ONLY — parse PricedUp boosts under the Football section.
// Fix: site moved the sport header ("Football") *outside* of EventRowHeader, so
// older logic using header text to detect Football stopped matching.
// We now detect Football by finding the nearest previous sibling with
// data-test="sport-header" and checking its H3 text.

import * as cheerio from 'cheerio';
import { cleanText } from '../../lib/text/clean.js';

// Classname fragments (site is CSS-in-JS; use contains selectors)
const WRAPPER_SEL = 'div[class*="EventRowWrapper"]';
const HEADER_SEL = 'div[class*="EventRowHeader"]';
const NAME_SEL   = 'div[class*="SelectionsGroupName"]';
const CARD_SEL   = 'li[class*="SelectionsGroupLiItem"]';
const ODDS_SEL   = 'a[class*="SelectionItemStyle"],button[class*="SelectionItemStyle"]';

function pickFractional(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (/^(EVS|EVENS)$/i.test(s)) return 'EVS';
  const m = s.match(/(\d+)\s*[\/\u2044]\s*(\d+)/); // 10/3 or 10⁄3
  return m ? `${m[1]}/${m[2]}` : null;
}

function getSportTitleForWrapper($, wrapper) {
  // Nearest *previous* sport header block, then read its <h3 data-test="section-title">
  const $wrapper = $(wrapper);
  const $sportHeader = $wrapper.prevAll('div[data-test="sport-header"]').first();
  if ($sportHeader && $sportHeader.length) {
    const title = ($sportHeader.find('h3[data-test="section-title"]').first().text() || '').trim();
    if (title) return title;
  }
  // Fallback: walk up to the event list wrapper and look backwards in siblings
  const $container = $wrapper.closest('section[data-test="special-sport-event-list-wrapper"], div[data-test="special-sport-event-list-wrapper"]');
  if ($container && $container.length) {
    // Find the closest sport-header *before* this wrapper in document order
    // (Cheerio lacks previousElementSibling traversal with indices; prevAll above is usually enough.)
    const title = ($container.find('div[data-test="sport-header"]').first().find('h3[data-test="section-title"]').first().text() || '').trim();
    if (title) return title;
  }
  return '';
}

export function parsePricedUp(html, ctx = {}) {
  const debug = !!ctx.debug;
  const $ = cheerio.load(html);

  const rawOffers = [];
  let wrappersTotal = 0,
      wrappersFootball = 0,
      cardsSeen = 0,
      emitted = 0,
      missingOdds = 0,
      missingName = 0;

  $(WRAPPER_SEL).each((_, wrapper) => {
    wrappersTotal++;

    const headerText = ($(wrapper).find(HEADER_SEL).first().text() || '').trim();
    // New robust sport detection
    const sportTitle = getSportTitleForWrapper($, wrapper);
    const isFootball = /football/i.test(sportTitle) || /football/i.test(headerText);
    if (!isFootball) return;

    wrappersFootball++;

    $(wrapper).find(CARD_SEL).each((__, li) => {
      cardsSeen++;

      const $name = $(li).find(NAME_SEL).first();
      const titleRaw = ($name.attr('title') || $name.text() || '').trim();
      const title = cleanText(titleRaw, ['(was', 'Was ', 'Price Boost']).trim();

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
        bookie: 'pricedup',
        book: 'PricedUp',
        text: title,
        textOriginal: titleRaw,
        boostedOddsFrac: oddsFrac,
        oddsRaw: oddsFrac,
        sportHint: 'Football',
        meta: { source: 'pricedup', header: headerText, sportTitle }
      });
      emitted++;
    });
  });

  if (debug) {
    console.log(`[parse:pricedup] wrappers total: ${wrappersTotal} | football: ${wrappersFootball}`);
    console.log(`[parse:pricedup] cards seen: ${cardsSeen} | emitted: ${emitted} | missingOdds: ${missingOdds} | missingName: ${missingName}`);
    for (const r of rawOffers.slice(0, 5)) {
      console.log(' -', r.text, '| frac:', r.boostedOddsFrac, '| sportTitle:', r.meta?.sportTitle);
    }
  }

  return {
    rawOffers,
    diagnostics: { wrappersTotal, wrappersFootball, cardsSeen, emitted, missingOdds, missingName }
  };
}

export default parsePricedUp;