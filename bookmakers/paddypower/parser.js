// bookmakers/paddypower/parser.js — ESM (dedupe by marketId:selectionId; return array)
// Reads captured JSON payloads in the SAME snapshot folder as the given page.html
// and returns ONLY football 'DAILY_POWER_PRICES' runners. If multiple
// content-managed-page.*.json files contain the same runners (very common on PP),
// we de‑dupe by `${marketId}:${selectionId}` and let the LAST seen (latest by mtime)
// win so odds/wording are the freshest.
//
// Signature (path-based parser):
//   export default async function parser(htmlFilePath, ctx)
//     - htmlFilePath: snapshots/paddypower/YYYY-MM-DD/HHMMSS/page.html
//     - ctx: { debug?, bookKey?, htmlPath?, sourceUrl?, seenAtIso? }
// Returns:
//   Array<{ book?:string, sportHint?:string, title?:string, text?:string,
//           boostedOddsFrac?:string, boostedOddsDec?:number, oddsRaw?:string, oddsDec?:number,
//           url?:string, sourceUrl?:string }>

import fs from 'node:fs';
import path from 'node:path';

function readJsonSafe(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function listDir(dir) { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } }
function listFiles(dir, rx) { return listDir(dir).filter(e => e.isFile() && rx.test(e.name)).map(e => path.join(dir, e.name)); }
function statMs(p) { try { return fs.statSync(p).mtimeMs; } catch { return 0; } }

export default async function parser(htmlFilePath, { debug = false, sourceUrl: sourceUrlFromMeta = null } = {}) {
  const dir = path.dirname(htmlFilePath);

  // Source URL fallback from meta.json (same folder)
  let sourceUrl = sourceUrlFromMeta || 'https://www.paddypower.com/football?tab=specials';
  const metaPath = path.join(dir, 'meta.json');
  if (!sourceUrl && fs.existsSync(metaPath)) {
    const meta = readJsonSafe(metaPath);
    if (meta?.url) sourceUrl = meta.url;
  }

  // Sort so later files (by mtime) overwrite earlier ones in our de‑dupe map
  const cmpFiles = listFiles(dir, /^content-managed-page\..*\.json$/i).sort((a,b) => statMs(a) - statMs(b));
  const priceFiles = listFiles(dir, /^getMarketPrices\.[0-9]+\.json$/i).sort((a,b) => statMs(a) - statMs(b));
  if (debug) console.log(`[pp:parser] content-managed-page files=${cmpFiles.length}, prices=${priceFiles.length}`);
  if (!cmpFiles.length) return []; // nothing captured in this snapshot

  // Build latest price map (selection-level)
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

  // De‑dupe across all CMP files using a map
  const byKey = new Map(); // key `${marketId}:${selectionId}` -> offer

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

        // LAST file wins (because cmpFiles sorted ascending)
        byKey.set(key, {
          book: 'paddypower',
          sportHint: 'Football',
          title,                 // exact bookmaker text
          boostedOddsFrac: frac, // runner will coerce to dec if needed
          boostedOddsDec: dec,
          url: sourceUrl,
          sourceUrl
        });
      }
    }
  }

  return Array.from(byKey.values());
}

export { parser };