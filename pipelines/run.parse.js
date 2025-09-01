// pipelines/run.parse.js — ESM (FINAL)
// Runs a bookmaker parser against a snapshot HTML file.
//
// Usage:
//   node pipelines/run.parse.js --book=<book> [--file="C:\\path\\to\\page.html"] [--debug]
//
// Behavior:
// - If --file is omitted, resolve latest via snapshots/<book>/LATEST.json then fallback scan.
// - Pass **file path** to parsers that expect a path (currently: paddypower JSON parser).
// - Pass **HTML string** to parsers that expect HTML (e.g., williamhill, pricedup).
// - Accept parser returns: string path, { outPath }, or offers array/object.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

const args = parseArgs(process.argv);
const bookKey = String(args.book || '').trim().toLowerCase();
const debug = !!args.debug;
let htmlPath = args.file ? path.resolve(process.cwd(), String(args.file)) : null;

if (!bookKey) {
  console.error('Usage: node pipelines/run.parse.js --book=<book> [--file="path\\to\\page.html"] [--debug]');
  process.exit(1);
}

// ------------ resolve latest snapshot ------------
function resolveLatestFromPointer(book) {
  try {
    const p = path.resolve(__dirname, '..', 'snapshots', book, 'LATEST.json');
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const hp = j && typeof j.htmlPath === 'string' ? j.htmlPath : null;
    if (hp && fs.existsSync(hp)) return path.resolve(hp);
  } catch {}
  return null;
}

function resolveLatestByScan(book) {
  const root = path.resolve(__dirname, '..', 'snapshots', book);
  if (!fs.existsSync(root)) return null;
  let latest = null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(full);
      } else if (e.isFile() && e.name.toLowerCase() === 'page.html') {
        let t = 0; try { t = fs.statSync(full).mtimeMs; } catch {}
        if (!latest || t > latest.t) latest = { file: full, t };
      }
    }
  }
  return latest ? latest.file : null;
}

if (!htmlPath) {
  htmlPath = resolveLatestFromPointer(bookKey) || resolveLatestByScan(bookKey);
}

if (!htmlPath) {
  console.error('[parse] no HTML found. Provide --file or run snapshot first.');
  process.exit(1);
}

// ------------ helper: read meta for sourceUrl ------------
function readSourceUrl(htmlPath) {
  const dir = path.dirname(htmlPath);
  const meta = path.join(dir, 'meta.json');
  if (fs.existsSync(meta)) {
    try {
      const j = JSON.parse(fs.readFileSync(meta, 'utf8'));
      if (j?.url) return j.url;
    } catch {}
  }
  return null;
}

// ------------ dynamic import parser ------------
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

async function loadParser(book) {
  const modPath = `../bookmakers/${book}/parser.js`;
  let mod;
  try {
    mod = await import(modPath);
  } catch (e) {
    console.error(`[parse] cannot import parser at ${modPath}:`, e?.message || e);
    process.exit(1);
  }
  const candidates = ['default', 'parser', 'parse', `parse${cap(book)}`];
  for (const key of candidates) {
    const fn = mod?.[key];
    if (typeof fn === 'function') return fn;
  }
  console.error('[parse] parser export not found. Expected one of:', candidates.join(', '));
  process.exit(1);
}

// ------------ main ------------
(async () => {
  try {
    const parseFn = await loadParser(bookKey);
    if (debug) console.log(`[parse:${bookKey}] using htmlPath=${htmlPath}`);

    // Decide invocation mode per bookmaker
    // - 'paddypower' uses JSON captures in the folder => expects FILE PATH
    // - others default to HTML string
    let result;
    if (bookKey === 'paddypower') {
      result = await parseFn(htmlPath, { debug, bookKey });
    } else {
      const html = await fsp.readFile(htmlPath, 'utf8');
      const sourceUrl = readSourceUrl(htmlPath);
      result = await parseFn(html, { debug, bookKey, htmlPath, sourceUrl, seenAtIso: new Date().toISOString() });
    }

    // Handle return styles
    const asString = typeof result === 'string' ? result : null;
    const asObj = (result && typeof result === 'object' && !Array.isArray(result)) ? result : null;

    if (asString) {
      const p = path.resolve(asString);
      if (fs.existsSync(p)) {
        if (debug) console.log(`[parse:${bookKey}] parser wrote → ${p}`);
        return;
      }
    }

    if (asObj && typeof asObj.outPath === 'string') {
      const p = path.resolve(asObj.outPath);
      if (fs.existsSync(p)) {
        if (debug) console.log(`[parse:${bookKey}] parser wrote → ${p}`);
        return;
      }
    }

    // If parser returned offers, persist them next to the HTML
    const offers = Array.isArray(result) ? result : (result?.rawOffers || result?.raw || []);
    if (!Array.isArray(offers)) {
      console.error('[parse] parser returned an unexpected value.');
      process.exit(1);
    }

    const outDir = path.dirname(htmlPath);
    const base = path.basename(htmlPath).replace(/\.html?$/i, '');
    const outPath = path.join(outDir, `${base}.rawoffers.json`);
    await fsp.writeFile(outPath, JSON.stringify({ rawOffers: offers }, null, 2), 'utf8');
    console.log(`[parse:${bookKey}] wrote ${offers.length} raw offers → ${outPath}`);
  } catch (e) {
    console.error('[parse] failed:', e?.message || e);
    process.exit(1);
  }
})();
