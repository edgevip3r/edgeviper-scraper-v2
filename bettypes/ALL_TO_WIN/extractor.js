// bettypes/ALL_TO_WIN/extractor.js
function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function splitTeams(prefix, original) {
  const pre = prefix
    .replace(/\s*&\s*/gi, ',')
    .replace(/\s+and\s+/gi, ',')
    .replace(/\s*\+\s*/g, ',');
  const parts = pre.split(',').map(x => x.trim()).filter(Boolean);

  const legs = [];
  let cursor = 0;
  for (const p of parts) {
    const idx = original.toLowerCase().indexOf(p.toLowerCase(), cursor);
    if (idx >= 0) { legs.push(original.slice(idx, idx + p.length).trim()); cursor = idx + p.length; }
    else { legs.push(p); }
  }
  const seen = new Set();
  return legs.filter(t => { const k = t.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return t.length >= 2; });
}

async function classify(title /*, ctx */) {
  const original = normalize(title);

  // Hard guard: reject if text mentions scoring/BTTS/etc.
  if (/\bBTTS\b/i.test(original)) return { match: false, legs: [], reason: 'BTTS_PHRASE' };
  if (/\bboth\s+teams\s+to\s+score\b/i.test(original)) return { match: false, legs: [], reason: 'BTTS_PHRASE' };
  if (/\ball\s+\d+\s+teams?\s+to\s+score\b/i.test(original)) return { match: false, legs: [], reason: 'BTTS_PHRASE' };
  if (/\bto\s+score\b/i.test(original)) return { match: false, legs: [], reason: 'SCORE_PHRASE' };

  // Extract the bit before “… to win / wins”
  let prefix = null;
  const reList = [
    /^(.*?)(?:\s*both\s*to\s*win)\b/i,
    /^(.*?)(?:\s*all\s*to\s*win)\b/i,
    /^(.*?)(?:\s*to\s*win)\b/i,
    /^(.*?)(?:\s*wins?)\b/i
  ];
  for (const re of reList) { const m = original.match(re); if (m) { prefix = m[1]; break; } }
  if (!prefix) prefix = original;

  const legs = splitTeams(prefix, original);
  return legs.length >= 2
    ? { match: true, legs }
    : { match: false, legs: [], reason: 'legs<2' };
}

export default { classify };