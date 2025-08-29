// lib/text/clean.js
function escapeRegexLiteral(str = '') {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove any phrases in `drops` from `raw` (case-insensitive), safely.
 * `drops` should be plain strings. (We can add regex support later if needed.)
 */
export function cleanText(raw, drops = []) {
  let t = (raw || '').replace(/\s+/g, ' ').trim();
  for (const d of drops) {
    if (!d) continue;
    const rx = new RegExp(escapeRegexLiteral(String(d)), 'gi');
    t = t.replace(rx, '');
  }
  return t.replace(/\s+/g, ' ').trim();
}

export default cleanText;