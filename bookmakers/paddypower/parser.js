// bookmakers/paddypower/parser.js — ESM (no sibling fallback)
// Reads captured JSON payloads in the same snapshot folder as the given page.html
// and extracts ONLY DAILY_POWER_PRICES football boosts.
//
// Input:  htmlFilePath (string) — e.g. snapshots/paddypower/YYYY-MM-DD/HHMMSS/page.html
// Output: writes snapshots/paddypower/YYYY-MM-DD/HHMMSS/page.rawoffers.json and returns that path.

import fs from 'node:fs';
import path from 'node:path';

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function listDir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function listFiles(dir, rx) {
  return listDir(dir).filter(e => e.isFile() && rx.test(e.name)).map(e => path.join(dir, e.name));
}
function statMs(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

export default async function parser(htmlFilePath, { debug = false } = {}) {
  const dir = path.dirname(htmlFilePath);

  // Resolve source URL from meta.json in THIS folder
  let sourceUrl = 'https://www.paddypower.com/football?tab=specials';
  const metaPath = path.join(dir, 'meta.json');
  if (fs.existsSync(metaPath)) {
    const meta = readJsonSafe(metaPath);
    if (meta?.url) sourceUrl = meta.url;
  }

  const cmpFiles = listFiles(dir, /^content-managed-page\..*\.json$/i).sort((a,b) => statMs(a) - statMs(b));
  const priceFiles = listFiles(dir, /^getMarketPrices\.\d+\.json$/i).sort((a,b) => statMs(a) - statMs(b));
  if (debug) console.log(`[pp:parser] content-managed-page files=${cmpFiles.length}, prices=${priceFiles.length}`);
  if (!cmpFiles.length) throw new Error('No content-managed-page.*.json found in snapshot folder');

  // Build latest price map
  const latestPrice = new Map(); // key `${marketId}:${selectionId}` -> { dec, frac }
  const pickDec = o => (o?.trueOdds?.decimalOdds?.decimalOdds ?? o?.decimalDisplayOdds?.decimalOdds ?? null);
  const pickFrac = o => {
    const n = o?.trueOdds?.fractionalOdds?.numerator, d = o?.trueOdds?.fractionalOdds?.denominator;
    if (typeof n === 'number' && typeof d === 'number') return `${n}/${d}`;
    const n2 = o?.fractionalDisplayOdds?.numerator, d2 = o?.fractionalDisplayOdds?.denominator;
    return (typeof n2 === 'number' && typeof d2 === 'number') ? `${n2}/${d2}` : null;
  };
  for (const pf of priceFiles) {
    const js = readJsonSafe(pf);
    if (!Array.isArray(js)) continue;
    for (const mk of js) {
      const marketId = String(mk?.marketId || '');
      const runners = Array.isArray(mk?.runnerDetails) ? mk.runnerDetails : [];
      for (const rd of runners) {
        const selId = rd?.selectionId; if (selId == null) continue;
        const key = `${marketId}:${selId}`;
        latestPrice.set(key, { dec: pickDec(rd?.winRunnerOdds || {}), frac: pickFrac(rd?.winRunnerOdds || {}) });
      }
    }
  }

  // Walk CMP markets and collect DAILY_POWER_PRICES offers
  const offers = [];
  for (const cf of cmpFiles) {
    const cmp = readJsonSafe(cf); if (!cmp) continue;
    const markets = cmp?.attachments?.markets || {};
    for (const m of Object.values(markets)) {
      if (!m) continue;
      if (m.marketType !== 'DAILY_POWER_PRICES') continue;          // whitelist only
      if (m.eventTypeId != null && m.eventTypeId !== 1) continue;   // football only when present
      if (!Array.isArray(m.runners) || m.runners.length === 0) continue;

      for (const r of m.runners) {
        const title = (r?.runnerName || '').trim();
        if (!title) continue;
        let dec = r?.winRunnerOdds?.trueOdds?.decimalOdds?.decimalOdds ?? null;
        let frac = null;
        const fr = r?.winRunnerOdds?.trueOdds?.fractionalOdds;
        if (fr && typeof fr.numerator === 'number' && typeof fr.denominator === 'number') {
          frac = `${fr.numerator}/${fr.denominator}`;
        }
        const key = `${m.marketId}:${r.selectionId}`;
        const refresh = latestPrice.get(key);
        if (refresh) {
          if (typeof refresh.dec === 'number') dec = refresh.dec;
          if (typeof refresh.frac === 'string') frac = refresh.frac;
        }
        offers.push({
          book: 'paddypower',
          sport: 'football',
          title,
          price: { dec, frac },
          marketId: m.marketId,
          selectionId: r.selectionId,
          marketName: m.marketName,
          marketTimeIso: m.marketTime || null,
          sourceUrl
        });
      }
    }
  }

  const outPath = path.join(dir, path.basename(htmlFilePath).replace(/\.html?$/i, '') + '.rawoffers.json');
  fs.writeFileSync(outPath, JSON.stringify(offers, null, 2), 'utf8');
  if (debug) console.log(`[pp:parser] wrote ${offers.length} offers → ${outPath}`);
  return outPath;
}

export { parser };
