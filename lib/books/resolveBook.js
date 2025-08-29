// lib/books/resolveBook.js
// Resolve --book input to a canonical key (bookmakers/<key>/...), using config/book-aliases.json.
// Safe, cached, and verifies the folder exists.

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Allow override via env; default to ../config/book-aliases.json
const ALIASES_PATH = process.env.BOOK_ALIASES_JSON
  ? path.resolve(process.env.BOOK_ALIASES_JSON)
  : path.resolve(__dirname, '..', '..', 'config', 'book-aliases.json');

let CACHE = null;

function sanitize(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9 _-]+$/.test(s) ? s : null;
}
function sanitizeCanonical(raw) {
  const s = String(raw || '').trim().toLowerCase();
  // canonical folder keys must be [a-z0-9_-]+ (no spaces)
  return /^[a-z0-9_-]+$/.test(s) ? s : null;
}

async function loadAliases() {
  if (CACHE) return CACHE;
  if (!fss.existsSync(ALIASES_PATH)) {
    CACHE = new Map();
    return CACHE;
  }
  const txt = await fs.readFile(ALIASES_PATH, 'utf8');
  let json;
  try { json = JSON.parse(txt); }
  catch { throw new Error(`book-aliases JSON malformed: ${ALIASES_PATH}`); }
  const map = new Map();
  for (const [k, v] of Object.entries(json)) {
    if (k === '//' || k === '_comment') continue;
    const key = sanitize(k);
    const val = sanitizeCanonical(v);
    if (key && val) map.set(key, val);
  }
  CACHE = map;
  return CACHE;
}

/**
 * Resolve a raw --book flag to canonical, verifying bookmakers/<canonical> exists.
 * @returns {Promise<{canonical:string, aliasUsed:boolean}>}
 */
export async function resolveBookKey(raw) {
  const s = sanitize(raw);
  if (!s) throw new Error(`Invalid --book value "${raw}". Allowed characters: [a-z0-9 _-].`);
  const aliases = await loadAliases();

  // Look up alias (exact) or fall back to a collapsed canonical guess (strip spaces)
  let canonical = aliases.get(s) || sanitizeCanonical(s.replace(/\s+/g, ''));
  if (!canonical) throw new Error(`--book "${raw}" did not resolve to a canonical key.`);

  // Verify folder exists
  const folder = path.resolve(__dirname, '..', '..', 'bookmakers', canonical);
  if (!fss.existsSync(folder)) throw new Error(`Book folder not found: bookmakers/${canonical}`);

  return { canonical, aliasUsed: aliases.has(s) };
}

export default { resolveBookKey };