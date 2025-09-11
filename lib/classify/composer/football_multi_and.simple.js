
// lib/classify/composer/football_multi_and.simple.js
// Improved detector: extracts CLEAN team names for the two common recipes.
//   1) "A & B Both To Win & C To Draw"
//   2) "A & B Both To Win & C To Win To Nil"
// Returns a composed offer with FINAL flattened legs [{kind, team}, ...].

function stripPrefix(text){
  // Generic marketing prefix like "Road Warriors:" — drop everything up to first colon
  const m = String(text||'').match(/^[^:]{2,60}:\s*(.*)$/);
  return m ? m[1] : String(text||'');
}

function cleanTeam(s){
  return String(s||'')
    .replace(/\((?:[^)]*?v[^)]*?)\)\s*$/i, '') // drop "(X v Y)"
    .replace(/\b(both\s+to\s+win|to\s+draw|to\s+win\s+to\s+nil|win\s+to\s+nil)\b/ig, '')
    .replace(/\s+/g,' ')
    .trim();
}

function getTeamsLoose(text){
  const parts = String(text||'').split(/\s*&\s*|\s*,\s*|\s+and\s+/i).map(s=>s.trim()).filter(Boolean);
  return parts.map(cleanTeam).filter(Boolean);
}

function has(rx, text){ return rx.test(text); }
const RX_BOTH_TO_WIN = /\bboth\s+to\s+win\b/i;
const RX_TO_DRAW = /\bto\s+draw\b/i;
const RX_WIN_TO_NIL = /\b(win\s+to\s+nil|to\s+win\s+to\s+nil)\b/i;

export function composeFootballMultiAnd(offer, ctx = {}){
  const raw = stripPrefix(String(offer.title || offer.text || offer.rawText || '').trim());

  // Case 1: structured capture for Win & Win & Draw
  let m = raw.match(/^\s*(.+?)\s*&\s*(.+?)\s+both\s+to\s+win\s*&\s*(.+?)\s+to\s+draw\s*$/i);
  if (m) {
    const A = cleanTeam(m[1]);
    const B = cleanTeam(m[2]);
    const C = cleanTeam(m[3]);
    if (A && B && C) {
      return {
        ...offer,
        typeId:'FOOTBALL_MULTI_AND',
        legs: [
          { kind:'MO_TEAM_WIN', team: A },
          { kind:'MO_TEAM_WIN', team: B },
          { kind:'MO_DRAW',     team: C }
        ]
      };
    }
  }

  // Case 2: structured capture for Win & Win & Win to Nil
  m = raw.match(/^\s*(.+?)\s*&\s*(.+?)\s+both\s+to\s+win\s*&\s*(.+?)\s+(?:to\s+win\s+to\s+nil|win\s+to\s+nil)\s*$/i);
  if (m) {
    const A = cleanTeam(m[1]);
    const B = cleanTeam(m[2]);
    const C = cleanTeam(m[3]);
    if (A && B && C) {
      return {
        ...offer,
        typeId:'FOOTBALL_MULTI_AND',
        legs: [
          { kind:'MO_TEAM_WIN', team: A },
          { kind:'MO_TEAM_WIN', team: B },
          { kind:'WIN_TO_NIL',  team: C }
        ]
      };
    }
  }

  // Fallback: loose detection + cleanup
  if (has(RX_BOTH_TO_WIN, raw) && (has(RX_TO_DRAW, raw) || has(RX_WIN_TO_NIL, raw))) {
    const teams = getTeamsLoose(raw);
    if (teams.length >= 3) {
      const A = teams[0], B = teams[1], C = teams[teams.length-1];
      const lastKind = has(RX_TO_DRAW, raw) ? 'MO_DRAW' : 'WIN_TO_NIL';
      return {
        ...offer,
        typeId:'FOOTBALL_MULTI_AND',
        legs: [
          { kind:'MO_TEAM_WIN', team: A },
          { kind:'MO_TEAM_WIN', team: B },
          { kind:lastKind,      team: C }
        ]
      };
    }
  }

  return null;
}

export default { composeFootballMultiAnd };
