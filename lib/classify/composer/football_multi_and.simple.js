//
// lib/classify/composer/football_multi_and.simple.js
//
// Compose "multi-and" football offers and guard against unsupported props.
// Returns:
//  - { skipType:true, reason }             -> caller should skip this offer
//  - { typeId:'FOOTBALL_WIN_TO_NIL', legs:[{team}] }   (single-leg WTN)
//  - { typeId:'FOOTBALL_MULTI_AND', legs:[{team,kind}] } for supported multis
//
// Supported atomic kinds here:
//   TEAM_WIN, TEAM_DRAW, WIN_TO_NIL
//
const CONN_RX = /\s*(?:,|\/|&| and )\s*/i;
const LOWER = s => String(s || '').toLowerCase().trim();
const CLEAN = s => LOWER(s).replace(/\s+/g, ' ').trim();

const RX = {
  TEAM_WIN     : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?win\b/i,
  TEAM_DRAW    : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?draw\b/i,
  WIN_TO_NIL   : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?win\s*to\s*nil\b/i,
  PROP_SCORER  : /\b(to\s+score|scorer|anytime|first\s+goalscorer|assist)\b/i,
  PROP_SHOTS   : /\bshots?\s+on\s+target\b/i,
  PROP_CORNERS : /\bcorners?\b/i,
};

function splitLegs(text){
  return String(text || '').split(CONN_RX).map(s => s.trim()).filter(Boolean);
}

function classifyFragment(frag){
  let m;
  if (m = frag.match(RX.WIN_TO_NIL)) return { kind:'WIN_TO_NIL', team: CLEAN(m[1]) };
  if (m = frag.match(RX.TEAM_DRAW))  return { kind:'TEAM_DRAW',  team: CLEAN(m[1]) };
  if (m = frag.match(RX.TEAM_WIN))   return { kind:'TEAM_WIN',   team: CLEAN(m[1]) };
  if (RX.PROP_SCORER.test(frag))  return { kind:'PROP_PLAYER' };
  if (RX.PROP_SHOTS.test(frag))   return { kind:'PROP_SHOTS' };
  if (RX.PROP_CORNERS.test(frag)) return { kind:'PROP_CORNERS' };
  return { kind:'UNKNOWN' };
}

export function composeFootballMultiAnd(offer, ctx = {}){
  const title = String(offer?.title || offer?.text || offer?.rawText || '').trim();
  if (!title) return null;

  const frags = splitLegs(title);

  // Single-leg special casing
  if (frags.length <= 1){
    const c = classifyFragment(frags[0] || '');
    if (c.kind === 'WIN_TO_NIL' && c.team) {
      return { typeId:'FOOTBALL_WIN_TO_NIL', text:title, textOriginal:title, legs:[{ team:c.team }] };
    }
    return null;
  }

  // Multi
  const legs = [];
  const unsupported = [];

  for (const frag of frags){
    const c = classifyFragment(frag);
    switch (c.kind){
      case 'TEAM_WIN':
      case 'TEAM_DRAW':
      case 'WIN_TO_NIL':
        legs.push({ team: c.team, kind: c.kind });
        break;
      case 'PROP_PLAYER':
      case 'PROP_SHOTS':
      case 'PROP_CORNERS':
        unsupported.push(c.kind);
        break;
      default: break;
    }
  }

  if (unsupported.length){
    return { skipType:true, reason:`UNSUPPORTED_PROP(${Array.from(new Set(unsupported)).join(',')})` };
  }
  if (!legs.length) return null;

  return { typeId:'FOOTBALL_MULTI_AND', text:title, textOriginal:title, legs };
}

export default { composeFootballMultiAnd };
