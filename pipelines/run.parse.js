// pipelines/run.parse.js
// Normalize RawOffers from a bookmaker parser and write *.rawoffers.json
//
// Usage:
//   node pipelines/run.parse.js --book=<williamhill|pricedup> --file="<html path>" [--debug]
//
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { fracToDec } from '../lib/text/odds.parse.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// --- args ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) return [];
    return [m[1], m[2] === undefined ? true : m[2]];
  }).filter(Boolean)
);

const bookKey = (args.book || '').toLowerCase().trim();
const htmlPath = args.file ? path.resolve(process.cwd(), String(args.file)) : null;
const debug = !!args.debug;

if (!bookKey) {
  // Dynamically list available books by scanning ./bookmakers (no hard-coding)
  let detected = [];
  try {
    const dir = path.resolve(__dirname, '..', 'bookmakers');
    detected = fss.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort();
  } catch {}
  const hint = detected.length ? `  Available: ${detected.join(', ')}` : '';
  console.error('Usage: node pipelines/run.parse.js --book=<book> --file="<html path>" [--debug]');
  if (hint) console.error(hint);
  process.exit(1);
}

if (!htmlPath) {
  console.error('[parse] no HTML found. Provide --file or run snapshot first.');
  process.exit(1);
}

// --- helpers ---
function cap(s){ return s ? s[0].toUpperCase() + s.slice(1) : s; }

function loadBookCfg(key) {
  try {
    const p = path.resolve(__dirname, '..', 'data', 'bookmakers', `${key}.json`);
    return JSON.parse(fss.readFileSync(p, 'utf8'));
  } catch { return {}; }
}

async function readText(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch (e) {
    throw new Error(`cannot read HTML file: ${p} (${e.message})`);
  }
}

function ensureArray(a) { return Array.isArray(a) ? a : []; }

function cleanTitle(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
}

function deriveOutputPath(inHtml) {
  const dir = path.dirname(inHtml);
  const base = path.basename(inHtml).replace(/\.html?$/i, '');
  return path.join(dir, `${base}.rawoffers.json`);
}

function coerceOddsDec(it) {
  if (it.boostedOddsDec != null) return Number(it.boostedOddsDec);
  if (it.oddsDec != null) return Number(it.oddsDec);
  const frac = it.boostedOddsFrac ?? it.oddsRaw ?? it.oddsFrac ?? null;
  if (frac) {
    const d = fracToDec(frac);
    return d == null ? null : Number(d);
  }
  return null;
}

function pickUrl(it, baseUrl) {
  // tolerate either key; never reference an undefined symbol
  const u = it.sourceUrl || it.url || null;
  if (!u) return baseUrl || null;
  if (/^https?:\/\//i.test(u)) return u;
  try { return new URL(u, baseUrl || 'https://').toString(); } catch { return baseUrl || null; }
}

// --- dynamic import of parser ---
async function loadParser(key) {
  const mod = await import(`../bookmakers/${key}/parser.js`);
  // Try a few export shapes:
  const tryNames = [
    'parse',                 // export function parse(html, ctx?)
    `parse${cap(key)}`,      // parseWilliamhill / parsePricedup
    'default'                // default export
  ];
  for (const name of tryNames) {
    const fn = mod?.[name];
    if (typeof fn === 'function') return fn;
  }
  throw new Error('parser not found or invalid export in bookmakers/' + key + '/parser.js');
}

// --- main ---
(async () => {
  try {
    const bookCfg = loadBookCfg(bookKey);
    const baseUrl = (bookCfg?.baseUrls && bookCfg.baseUrls[0]) || null;

    const parseFn = await loadParser(bookKey);
    const html = await readText(htmlPath);

    const out = await parseFn(html, { bookKey, bookCfg, debug });
    const items = ensureArray(out?.rawOffers || out?.raw || out);

    if (debug) console.log(`[parse:${bookKey}] items seen=${items.length}`);

    const raw = [];
    for (const it of items) {
      const title = cleanTitle(it.text || it.title || it.name || '');
      const oddsDec = coerceOddsDec(it);
      if (!title || oddsDec == null) {
        if (debug) console.log('[skip:pre]', !title ? 'no-text' : 'no-odds', '|', title.slice(0, 80));
        continue;
      }
      const url = pickUrl(it, baseUrl);

      raw.push({
        bookie: bookKey,
        sportHint: it.sportHint || 'Football',
        text: title,
        textOriginal: it.textOriginal || it.title || title,
        boostedOddsFrac: it.boostedOddsFrac ?? it.oddsRaw ?? it.oddsFrac ?? null,
        boostedOddsDec: oddsDec,
        // keep both keys for compatibility downstream
        url,
        sourceUrl: url
      });
    }

    const outPath = deriveOutputPath(htmlPath);
    await fs.writeFile(outPath, JSON.stringify({ rawOffers: raw }, null, 2), 'utf8');

    console.log(`[parse:${bookKey}] wrote ${raw.length} raw offers -> ${outPath}`);
    // optional preview
    if (debug) {
      for (const r of raw.slice(0, 5)) {
        console.log(' -', r.text, '| odds:', r.boostedOddsFrac ?? '', '| dec:', r.boostedOddsDec, '| url:', r.sourceUrl || '');
      }
    }
  } catch (e) {
    console.error('[parse] failed:', e?.message || e);
    process.exit(1);
  }
})();