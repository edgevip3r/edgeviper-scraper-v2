// bookmakers/williamhill/parser.js
import { load } from 'cheerio';
import { cleanText } from '../../lib/text/clean.js';
import { fracToDec } from '../../lib/text/odds.parse.js';
import wh from '../../data/bookmakers/williamhill.json' with { type: 'json' };

/**
 * Parse a William Hill Price Boosts HTML snapshot into RawOffer[].
 * Emits ALL boost rows; classifier filters later.
 */
export function parseWilliamHill(html, opts = {}) {
  const $ = load(html);
  const seenAt = opts.seenAtIso || new Date().toISOString();
  const sourceUrl = opts.sourceUrl || null;

  const rawOffers = [];
  let itemsSeen = 0, parsed = 0, missingTitle = 0, missingOdds = 0;

  $('.btmarket__actions').each((_, el) => {
    itemsSeen++;

    const nameNode = $(el).find('p.btmarket__name').first();
    const titleRaw = nameNode.text().trim();

    const btn = $(el).find('button.betbutton--enhanced-odds, button.enhanced-offers__button').first();
    const frac = (btn.attr('data-odds') || '').trim()
      || $(el).find('.betbutton__odds').first().text().trim();

    if (!titleRaw) { missingTitle++; return; }
    if (!frac) { missingOdds++; return; }

    const title = cleanText(titleRaw, wh.textDrops || []);
    const oddsDec = fracToDec(frac);

    rawOffers.push({
      bookie: 'williamhill',
      url: sourceUrl,
      seenAt,
      text: title,
      oddsRaw: frac,
      oddsDec,
      sportHint: 'Football',
      context: {
        aria: btn.attr('aria-label') || null,
        dataOdds: btn.attr('data-odds') || null,
        eventId: btn.attr('data-event') || null,
        marketId: btn.attr('data-market') || null,
        entityId: btn.attr('data-entityid') || null
      }
    });
    parsed++;
  });

  return {
    rawOffers,
    diagnostics: { itemsSeen, parsed, missingTitle, missingOdds }
  };
}

export default parseWilliamHill;