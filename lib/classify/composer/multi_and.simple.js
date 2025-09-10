
// lib/classify/composer/football_multi_and.simple.js
// Pattern detector that builds `hits` and delegates to the existing generic composer
// at ./multi_and.js, so we don't diverge shapes across the pipeline.
//
// Handles:
//   - "A & B Both To Win & C To Draw"
//   - "A & B Both To Win & C To Win To Nil"
//
// Output: whatever composeMultiAnd(hits, {book}) returns (FOOTBALL_MULTI_AND).

import composeMultiAnd from './multi_and.js';

function getTeams(offer){
  if (Array.isArray(offer.teams) && offer.teams.length) return offer.teams.map(String);
  if (Array.isArray(offer.legs) && offer.legs.length) {
    const t = offer.legs.map(L => L && (L.team || L.label || L.name)).filter(Boolean);
    if (t.length) return t.map(String);
  }
  const txt = String(offer.title || offer.text || offer.rawText || '').replace(/\s+/g, ' ').trim();
  const m = txt.split(/\s*&\s*|\s*,\s*|\s+and\s+/i).filter(Boolean);
  return m.length ? m : [];
}

function has(rx, text){ return rx.test(text); }
const RX_BOTH_TO_WIN = /\bboth\s+to\s+win\b/i;
const RX_TO_DRAW = /\bto\s+draw\b/i;
const RX_WIN_TO_NIL = /\b(win\s+to\s+nil|to\s+win\s+to\s+nil)\b/i;

export function composeFootballMultiAnd(offer, ctx = {}){
  const text = String(offer.title || offer.text || offer.rawText || '').trim();
  const teams = getTeams(offer);
  const book = ctx?.book || ctx?.bookie || '';

  if (!teams.length) return null;

  // Case 1: A & B Both To Win & C To Draw
  if (has(RX_BOTH_TO_WIN, text) && has(RX_TO_DRAW, text) && teams.length >= 3){
    const hits = [
      { kind:'FOOTBALL_TEAM_WIN',     params:{ teams:[ teams[0], teams[1] ] } },
      { kind:'FOOTBALL_TEAM_TO_DRAW', params:{ teams:[ teams[teams.length-1] ] } }
    ];
    return composeMultiAnd(hits, { book });
  }

  // Case 2: A & B Both To Win & C To Win To Nil
  if (has(RX_BOTH_TO_WIN, text) && has(RX_WIN_TO_NIL, text) && teams.length >= 3){
    const hits = [
      { kind:'FOOTBALL_TEAM_WIN',  params:{ teams:[ teams[0], teams[1] ] } },
      { kind:'FOOTBALL_WIN_TO_NIL', params:{ teams:[ teams[teams.length-1] ] } }
    ];
    return composeMultiAnd(hits, { book });
  }

  return null;
}

export default { composeFootballMultiAnd };
