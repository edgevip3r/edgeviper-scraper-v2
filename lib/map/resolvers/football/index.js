// lib/map/resolvers/football/index.js
import { resolveMO } from './matchOdds.js';
import { resolveMO_BTTS } from './matchOddsBTTS.js';
import { resolveWinToNil } from './winToNil.js';

import fs from 'fs';
import path from 'path';

export const KIND = {
  ALL_TO_WIN: 'ALL_TO_WIN',
  WIN_AND_BTTS: 'BOTH_TO_WIN_AND_ALL_TEAMS_TO_SCORE'
};

const ORDER = {
  [KIND.ALL_TO_WIN]: ['football.matchOdds'],
  [KIND.WIN_AND_BTTS]: ['football.matchOddsBTTS']
};

const MAP = {
  'football.matchOdds': async (leg, ctx) => resolveMO(leg, ctx),
  'football.matchOddsBTTS': async (leg, ctx) => resolveMO_BTTS(leg, ctx),
  'football.winToNil': async (leg, ctx) => resolveWinToNil(leg, ctx),
  'football/WinToNil': async (leg, ctx) => resolveWinToNil(leg, ctx) // allow slash alias as used in map.hints.json
};

export function getResolverByKind(kind) {
  const list = ORDER[kind] || [];
  const first = list[0];
  if (!first) return null;
  return MAP[first] || null;
}

export function getResolverByName(name='') {
  return MAP[name] || null;
}

// Optional: load per-book, per-kind hints (kept for MO / MO&BTTS parity)
export function getHints(book = '', kind = '') {
  try {
    if (!book || !kind) return {};
    const base = path.resolve('lib/map/resolvers/football/overlays'); // may not exist; fine
    const tryPaths = [
      path.join(base, String(book), String(kind).toUpperCase() + '.json'),
      path.join(base, String(book), String(kind).toLowerCase() + '.json')
    ];
    for (const p of tryPaths) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        const j = JSON.parse(raw);
        if (j && typeof j === 'object') return j;
      } catch (e) { /* try next */ }
    }
  } catch (e) { /* ignore */ }
  return {};
}

export default { getResolverByKind, getResolverByName, getHints, KIND };
