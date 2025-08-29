// lib/normalize/team-normalizer.js
// Loads a central alias index and (optionally) a per-book overlay, returns Betfair-canonical name.

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cfg from '../../config/global.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Central index (from config or env)
const centralConfigured = process.env.TEAM_ALIASES_JSON || cfg.normalize?.teamAliasesPath || './data/compiled/aliases.index.json';
const CENTRAL_PATH = path.resolve(__dirname, '..', '..', centralConfigured);

// Per-book overlays live here by default (williamhill.aliases.json, pricedup.aliases.json, …)
const overlayDirConfigured = process.env.TEAM_ALIASES_BOOK_DIR || path.resolve(__dirname, '..', '..', 'data', 'bookmakers');

const CACHE = new Map(); // key: bookie||'__central__' -> Map

function normKey(s='') {
  return String(s).toLowerCase().trim();
}

async function loadCentral() {
  if (CACHE.has('__central__')) return CACHE.get('__central__');
  const map = new Map();
  if (fss.existsSync(CENTRAL_PATH)) {
    const raw = JSON.parse(await fs.readFile(CENTRAL_PATH, 'utf8'));
    for (const [k, v] of Object.entries(raw)) {
      if (k === '//' || k === '_comment') continue;
      map.set(normKey(k), String(v).trim());
    }
  }
  CACHE.set('__central__', map);
  return map;
}

async function loadOverlay(bookie) {
  if (!bookie) return new Map();
  const cacheKey = `__overlay__:${bookie}`;
  if (CACHE.has(cacheKey)) return CACHE.get(cacheKey);

  const map = new Map();
  const file = path.join(overlayDirConfigured, `${bookie}.aliases.json`);
  if (fss.existsSync(file)) {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const [k, v] of Object.entries(raw)) {
      if (k === '//' || k === '_comment') continue;
      map.set(normKey(k), String(v).trim());
    }
  }
  CACHE.set(cacheKey, map);
  return map;
}

async function loadMerged(bookie) {
  const central = await loadCentral();
  const overlay = await loadOverlay(bookie);
  // overlay wins on conflicts
  const merged = new Map(central);
  for (const [k, v] of overlay.entries()) merged.set(k, v);
  return merged;
}

/**
 * Normalize a raw team name to Betfair-canonical using central + (optional) per-book overlay.
 * @param {string} raw
 * @param {string|null} bookie e.g. 'williamhill'
 * @returns {Promise<{canonical:string, variantsTried:string[]}>}
 */
export async function normalizeTeam(raw, bookie = null) {
  const input = String(raw||'').trim();
  const map = await loadMerged(bookie);

  // Try direct
  const direct = map.get(normKey(input));
  if (direct) return { canonical: direct, variantsTried: [input, direct] };

  // Try a lightly normalized variant (strip accents, punctuation, collapse spaces)
  const looseKey = String(input)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/&/g,'and')
    .replace(/[^a-z0-9]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
  const loose = map.get(looseKey);
  if (loose) return { canonical: loose, variantsTried: [input, loose] };

  // Fallback: return input as canonical (no change)
  return { canonical: input, variantsTried: [input] };
}

export default { normalizeTeam };