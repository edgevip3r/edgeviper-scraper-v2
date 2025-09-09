// bookmakers/pricedup/parser.js
// PricedUp parser — Football-only by traversing the top-level boosts list.
// We walk the main list and only parse EventRowWrappers while the CURRENT sport header == "Football".
// This avoids accidentally picking Horse Racing/Tennis multis that look like football phrases.
//
// Contract: default export (html, ctx) -> { rawOffers, diagnostics }
import * as cheerio from 'cheerio';
import { cleanText } from '../../lib/text/clean.js';

// Robust selectors
const CONTAINER = 'section[data-test="special-sport-event-list-wrapper"]';
const SPORT_HEADER = 'header[class*="event-group-header"]';
const EVENT_ROW = 'div[data-component="EventRowMobx"]';
const CARD_SEL = 'li[class*="SelectionsGroupLiItem"], li[class*="SelectionGroupItem"]';
const NAME_SEL  = 'div[class*="SelectionsGroupName"], span[class*="SelectionsGroupName"]';
const ODDS_SEL  = 'a[class*="SelectionItemStyle"], button[class*="SelectionItemStyle"], [data-testid*="price"], [class*="price"]';

function pickFractional(text) {
  if (!text) return null;
  const s = String(text).trim();
  if (/^(EVS|EVENS)$/i.test(s)) return 'EVS';
  const m = s.match(/(\d+)\s*[\/\u2044]\s*(\d+)/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function isSportHeader($, el) {
  if (!el || el.tagName !== 'header') return false;
  const $el = $(el);
  if (!/event-group-header/i.test($el.attr('class') || '')) return false;
  const $h4 = $el.find('h4').first();
  if (!$h4.length) return false;
  // Prefer explicit attr when present
  const test = ($h4.attr('data-test') || '').toLowerCase();
  if (test === 'sport-header') return true;
  // Fallback: if header text matches a known sport name, treat as sport header
  const t = ($h4.text() || '').trim().toLowerCase();
  return ['football','horse racing','tennis','american football','golf','cricket','rugby union','rugby league','basketball','baseball'].includes(t);
}

function sportName($, el) {
  const $h4 = $(el).find('h4').first();
  return ($h4.text() || '').trim();
}

export default function parsePricedUp(html, ctx = {}) {
  const debug = !!ctx.debug;
  const $ = cheerio.load(html);

  const $container = $(CONTAINER).first().length ? $(CONTAINER).first() : $.root();

  let currentSport = '';
  let sportBoundedRows = 0;
  let itemsSeen = 0, emitted = 0, missingName = 0, missingOdds = 0;

  const rawOffers = [];

  // Iterate top-level children in order to keep sport scoping accurate
  const children = $container.children().toArray();

  for (const node of children) {
    if (isSportHeader($, node)) {
      currentSport = sportName($, node);
      continue;
    }

    // Only parse rows when we are inside the Football section
    if (/^football$/i.test(currentSport) && node.tagName === 'div') {
      const $node = $(node);
      if ($node.is(EVENT_ROW)) {
        sportBoundedRows++;

        $node.find(CARD_SEL).each((_, li) => {
          itemsSeen++;
          const $li = $(li);

          let titleRaw = ($li.find(NAME_SEL).first().attr('title') || $li.find(NAME_SEL).first().text() || '').trim();
          if (!titleRaw) titleRaw = ($li.find('strong, span').first().text() || '').trim();
          const title = cleanText(titleRaw, ['(was', 'Was ', 'Price Boost']).trim();

          let oddsFrac = null;
          $li.find(ODDS_SEL).each((__, nodeOdds) => {
            if (oddsFrac) return;
            const cand = pickFractional($(nodeOdds).text());
            if (cand) oddsFrac = cand;
          });
          if (!oddsFrac) oddsFrac = pickFractional($li.text());

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
            meta: { source: 'pricedup' }
          });
          emitted++;
        });
      }
    }
  }

  if (debug) {
    console.log(`[parse:pricedup] scopedRows:${sportBoundedRows} itemsSeen:${itemsSeen} emitted:${emitted} missingName:${missingName} missingOdds:${missingOdds}`);
    for (const r of rawOffers.slice(0, 5)) console.log(' -', r.text, '| frac:', r.boostedOddsFrac);
  }

  return { rawOffers, diagnostics: { scopedRows: sportBoundedRows, itemsSeen, emitted, missingOdds, missingName } };
}
