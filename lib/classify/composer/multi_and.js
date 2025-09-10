// lib/classify/composer/multi_and.js
export default function composeMultiAnd(hits, { book='' } = {}) {
  if (!Array.isArray(hits) || !hits.length) return null;
  return {
    kind: 'FOOTBALL_MULTI_AND',
    book,
    legs: hits.map(h => (h.kind && h.params) ? h : ({ kind: h.kind || h.typeId, params: h.params || { teams: h.teams || h.legs || [] } }))
  };
}
