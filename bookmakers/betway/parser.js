// bookmakers/betway/parser.js
// META-FIRST parser with robust meta file resolution.
// It will attempt to locate the saved *_meta.json alongside the HTML using several name patterns.
// Falls back to parsing the provided input as JSON if it already is the meta payload.
//
// Emits FOOTBALL ONLY (subcategoryCName === 'football-boost').

import fs from 'fs';
import path from 'path';
import { cleanText } from '../../lib/text/clean.js';

function readTextSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function resolveMetaText(input, ctx, debug=false) {
  // 1) If input is already JSON, return it
  if (input && typeof input === 'string') {
    try {
      const j = JSON.parse(input);
      if (j && typeof j === 'object' && 'body' in j) return input;
    } catch {}
  }

  const htmlPath = ctx?.htmlPath || ctx?.filePath || null;
  const candidates = [];
  if (ctx?.metaPath) candidates.push(ctx.metaPath);

  if (htmlPath) {
    const dir = path.dirname(htmlPath);
    const base = path.basename(htmlPath); // e.g. 2025-09-03_17-10-19_boosts.html
    // Patterns we will try:
    // a) replace .html -> .meta.json       => 2025-09-03_17-10-19_boosts.meta.json
    candidates.push(path.join(dir, base.replace('.html', '.meta.json')));
    // b) replace _boosts.html -> _meta.json => 2025-09-03_17-10-19_meta.json
    candidates.push(path.join(dir, base.replace('_boosts.html', '_meta.json')));
    // c) strip suffix and add _meta.json    => 2025-09-03_17-10-19_meta.json
    const stamp = base.replace('_boosts.html', '');
    candidates.push(path.join(dir, `${stamp}_meta.json`));
    // d) simple .meta.json with stamp       => 2025-09-03_17-10-19.meta.json
    candidates.push(path.join(dir, `${stamp}.meta.json`));
  }

  for (const p of candidates) {
    const t = p && readTextSafe(p);
    if (t) {
      debug && console.log('[parse:betway] loaded meta from', p);
      return t;
    }
  }

  return null;
}

/** Balanced extractor for an object that starts after "<key>":{ in a string. */
function extractFirstMap(body, key) {
  const anchor = `"${key}":{`;
  const pos = body.indexOf(anchor);
  if (pos === -1) return null;
  let i = pos;
  while (i < body.length && body[i] !== '{') i++;
  const start = i;
  let depth = 0, inStr = false, esc = false;
  for (i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === '\\\\') { esc = true; }
      else if (ch === '"') { inStr = false; }
    } else {
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { i++; break; } }
    }
  }
  return body.slice(start, i);
}

function safeJsonParse(objText) {
  if (!objText) return null;
  try {
    const sanitized = objText.replace(/\$undefined/g, 'null');
    return JSON.parse(sanitized);
  } catch (e) {
    return null;
  }
}

function buildFraction(n, d) {
  if (typeof n !== 'number' || typeof d !== 'number' || !d) return null;
  if (n === 1 && d === 1) return 'EVS';
  return `${n}/${d}`;
}

export default function parseBetway(input, ctx = {}) {
  const debug = !!ctx.debug;

  // Locate meta JSON text
  let metaText = resolveMetaText(input, ctx, debug);
  if (!metaText) {
    // As last chance, maybe input was already meta text but not valid JSON (rare)
    try {
      const maybe = String(input || '');
      const test = JSON.parse(maybe);
      metaText = maybe;
    } catch {
      debug && console.log('[parse:betway] meta JSON not found via ctx/htmlPath and input is not JSON');
      return { rawOffers: [], diagnostics: { error: 'meta-json-missing' } };
    }
  }

  let meta;
  try { meta = JSON.parse(metaText); } catch {
    debug && console.log('[parse:betway] meta JSON parse failed');
    return { rawOffers: [], diagnostics: { error: 'meta-json-parse-failed' } };
  }

  const body = meta?.body || '';
  if (!body || typeof body !== 'string') {
    return { rawOffers: [], diagnostics: { error: 'no-body-in-meta' } };
  }

  const eventsMap = safeJsonParse(extractFirstMap(body, 'events')) || {};
  const marketsMap = safeJsonParse(extractFirstMap(body, 'markets')) || {};
  const outcomesMap = safeJsonParse(extractFirstMap(body, 'outcomes')) || {};

  const seenEvents = Object.keys(eventsMap).length;
  const seenMarkets = Object.keys(marketsMap).length;
  const seenOutcomes = Object.keys(outcomesMap).length;

  const rawOffers = [];
  let emitted = 0;

  for (const mid of Object.keys(marketsMap)) {
    const m = marketsMap[mid];
    const ev = eventsMap[String(m.eventId)];
    if (!ev) continue;
    if (ev.subcategoryCName !== 'football-boost') continue;

    const outIds = Array.isArray(m.outcomes) ? m.outcomes : [];
    let picked = null;
    for (const oid of outIds) {
      const o = outcomesMap[String(oid)];
      if (!o) continue;
      if (o.displayed === false) continue;
      picked = o; break;
    }
    if (!picked) continue;

    const oddsFrac = buildFraction(picked.oddsNumerator, picked.oddsDenominator);
    const titleRaw = (ev.name || '').trim();
    const title = cleanText(titleRaw, ['(was', 'Was ', 'Price Boost']).trim();

    if (!title || !oddsFrac) continue;

    rawOffers.push({
      bookie: 'betway',
      book: 'Betway',
      text: title,
      textOriginal: titleRaw,
      boostedOddsFrac: oddsFrac,
      oddsRaw: oddsFrac,
      sportHint: 'Football',
      meta: {
        source: 'betway.meta',
        category: ev.categoryName,
        subcategory: ev.subcategoryName,
        group: ev.groupName
      }
    });
    emitted++;
  }

  if (debug) {
    console.log(`[parse:betway] maps → events:${seenEvents} markets:${seenMarkets} outcomes:${seenOutcomes} | emitted:${emitted}`);
    for (const r of rawOffers.slice(0, 5)) console.log(' -', r.text, '|', r.boostedOddsFrac);
  }

  return { rawOffers, diagnostics: { seenEvents, seenMarkets, seenOutcomes, emitted } };
}
