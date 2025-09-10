// lib/classify/composer/multi_and.js
// Composer — MULTI_AND
// Merges multiple atomic bettype hits from the same boost into a single offer.
// Keeps marketing prefixes for sheet display and ensures stable leg ordering.

/**
 * @param {Array} hits - [{ kind, params, meta: { marketingPrefix, rawText, book }, weight? }, ...]
 * @param {Object} opts - { book }
 * @returns {Object|null} { kind:'FOOTBALL_MULTI_AND', legs:[{kind,params}], meta:{} }
 */
export default function composeMultiAnd(hits, { book='' } = {}) {
  if (!Array.isArray(hits) || !hits.length) return null;

  // Shallow clone and normalise kinds
  const norm = hits
    .filter(Boolean)
    .map(h => ({
      kind: String(h.kind || '').trim(),
      params: Object.assign({}, h.params || {}),
      meta: Object.assign({}, h.meta || {}),
      weight: typeof h.weight === 'number' ? h.weight : 0
    }))
    .filter(h => h.kind);

  if (!norm.length) return null;

  // Stable sort by (weight desc, kind asc, JSON(params) asc) for deterministic legs order
  const legs = norm
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      const ka = a.kind.localeCompare(b.kind);
      if (ka !== 0) return ka;
      const pa = JSON.stringify(a.params);
      const pb = JSON.stringify(b.params);
      return pa.localeCompare(pb);
    })
    // Strip meta from legs
    .map(h => ({ kind: h.kind, params: h.params }));

  // Merge meta
  const prefixes = norm.map(h => (h.meta && h.meta.marketingPrefix) || '').filter(Boolean);
  const uniquePrefixes = Array.from(new Set(prefixes));
  const mergedPrefix = uniquePrefixes.join(' ') || '';

  const rawSamples = norm.map(h => (h.meta && h.meta.rawText) || '').filter(Boolean).slice(0, 3);

  return {
    kind: 'FOOTBALL_MULTI_AND',
    book,
    legs,
    meta: {
      marketingPrefix: mergedPrefix,
      rawSamples,
      legCount: legs.length
    }
  };
}
