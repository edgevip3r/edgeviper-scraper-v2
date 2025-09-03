// bookmakers/planetsportbet/parser.js
// FOOTBALL ONLY — scope to EventRowWrapper whose EventRowHeader contains "Football".

import * as cheerio from 'cheerio';
import { cleanText } from '../../lib/text/clean.js';

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

export function parsePlanetSportBet(html, ctx = {}) {
  const debug = !!ctx.debug;
  const $ = cheerio.load(html);

  const rawOffers = [];
  let wrappersTotal = 0, wrappersFootball = 0;
  let cardsSeen = 0, emitted = 0, missingOdds = 0, missingName = 0;

  $(WRAPPER_SEL).each((_, wrapper) => {
    wrappersTotal++;
    const headerText = ($(wrapper).find(HEADER_SEL).first().text() || '').trim();
    const isFootball = /football/i.test(headerText);
    if (!isFootball) return;
    wrappersFootball++;

    $(wrapper).find(CARD_SEL).each((__, li) => {
      cardsSeen++;
      const $name = $(li).find(NAME_SEL).first();
      const titleRaw = ($name.attr('title') || $name.text() || '').trim();
      // PlanetSportBet typically lacks "Home advantage:" prefices; still drop generic noise like "Was ..."
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
        bookie: 'planetsportbet',
        book: 'PlanetSportBet',
        text: title,
        textOriginal: titleRaw,
        boostedOddsFrac: oddsFrac,
        oddsRaw: oddsFrac,
        sportHint: 'Football',
        meta: { source: 'planetsportbet', header: headerText }
      });
      emitted++;
    });
  });

  if (debug) {
    console.log(`[parse:planetsportbet] wrappers total: ${wrappersTotal} | football: ${wrappersFootball}`);
    console.log(`[parse:planetsportbet] cards seen: ${cardsSeen} | emitted: ${emitted} | missingOdds: ${missingOdds} | missingName: ${missingName}`);
    for (const r of rawOffers.slice(0, 5)) {
      console.log(' -', r.text, '| frac:', r.boostedOddsFrac);
    }
  }

  return { rawOffers, diagnostics: { wrappersTotal, wrappersFootball, cardsSeen, emitted, missingOdds, missingName } };
}

export default parsePlanetSportBet;
