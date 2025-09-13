//
// lib/classify/composer/football_multi_and.simple.js
// Adds group WIN+BTTS expansion for WH-style phrasing and emits V2 kinds.
//
const DELIM_RX = /\s*(?:,|&| and )\s*/i;
const LOWER = s => String(s || '').toLowerCase().trim();
const CLEAN = s => LOWER(s).replace(/\s+/g, ' ').trim();

const RX = {
  GROUP_ALL_WIN  : /\b(?:all|both)\s+to\s+win\b/i,
  GROUP_WIN_BTTS : /\b(?:all|both)\s+to\s+win\b.*\b(?:(?:all\s+(?:\d+|four)\s+teams\s+to\s+score)|(?:both\s+teams\s+to\s+score)|btts)\b/i,

  WTN       : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?win\s*to\s*nil\b/i,
  DRAW      : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?draw\b/i,
  WIN_BTTS  : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?win\s*(?:,|\s*&\s*|\s*and\s*)\s*(?:(?:both\s+teams\s+to\s+score)|btts)\b/i,
  WIN       : /\b([a-z0-9\.\- ]+?)\s+(?:to\s+)?win\b/i,

  PROP_SCORER  : /\b(to\s+score|scorer|anytime|first\s+goalscorer|assist)\b/i,
  PROP_SHOTS   : /\bshots?\s+on\s+target\b/i,
  PROP_CORNERS : /\bcorners?\b/i,
};

function splitByDelims(s){
  return String(s || '').split(DELIM_RX).map(t => t.trim()).filter(Boolean);
}

function expandGroupAllToWin(title){
  const m = String(title || '').match(RX.GROUP_ALL_WIN);
  if (!m) return null;
  const teamsPart = String(title).slice(0, m.index).trim();
  if (!teamsPart) return null;
  const teams = splitByDelims(teamsPart).map(CLEAN).filter(Boolean);
  if (teams.length < 2) return null;
  return teams.map(team => ({ kind:'FOOTBALL_TEAM_WIN', team }));
}

function expandGroupWinBTTS(title){
  const m = String(title || '').match(RX.GROUP_WIN_BTTS);
  if (!m) return null;
  const teamsPart = String(title).slice(0, m.index).trim();
  if (!teamsPart) return null;
  const teams = splitByDelims(teamsPart).map(CLEAN).filter(Boolean);
  if (teams.length < 2) return null;
  return teams.map(team => ({ kind:'FOOTBALL_SGM_MO_BTTS', team }));
}

function classifyFragmentToAtomic(frag){
  let m;
  if (m = frag.match(RX.WTN))      return { kind:'FOOTBALL_WIN_TO_NIL',    team: CLEAN(m[1]) };
  if (m = frag.match(RX.DRAW))     return { kind:'FOOTBALL_TEAM_TO_DRAW',  team: CLEAN(m[1]) };
  if (m = frag.match(RX.WIN_BTTS)) return { kind:'FOOTBALL_SGM_MO_BTTS',   team: CLEAN(m[1]) };
  if (m = frag.match(RX.WIN))      return { kind:'FOOTBALL_TEAM_WIN',      team: CLEAN(m[1]) };
  if (RX.PROP_SCORER.test(frag))  return { kind:'PROP_PLAYER' };
  if (RX.PROP_SHOTS.test(frag))   return { kind:'PROP_SHOTS' };
  if (RX.PROP_CORNERS.test(frag)) return { kind:'PROP_CORNERS' };
  return { kind:'UNKNOWN' };
}

export function composeFootballMultiAnd(offer, ctx = {}){
  const title = String(offer?.title || offer?.text || offer?.rawText || '').trim();
  if (!title) return null;

  // Priority: "Both/All To Win & (All/Both Teams) To Score" -> MO+BTTS legs
  const groupWinBtts = expandGroupWinBTTS(title);
  if (groupWinBtts && groupWinBtts.length){
    return { typeId:'FOOTBALL_MULTI_AND', text:title, textOriginal:title, legs: groupWinBtts };
  }

  // Next: "All/Both To Win" -> team win legs
  const groupWin = expandGroupAllToWin(title);
  if (groupWin && groupWin.length){
    return { typeId:'FOOTBALL_MULTI_AND', text:title, textOriginal:title, legs: groupWin };
  }

  // Fallback: split fragments and classify
  const frags = splitByDelims(title);
  if (frags.length === 1){
    const c = classifyFragmentToAtomic(frags[0]);
    if (c.kind === 'FOOTBALL_WIN_TO_NIL' && c.team) {
      return { typeId:'FOOTBALL_WIN_TO_NIL', text:title, textOriginal:title, legs:[{ team:c.team }] };
    }
    if (c.kind === 'FOOTBALL_SGM_MO_BTTS' && c.team){
      return { typeId:'FOOTBALL_SGM_MO_BTTS', text:title, textOriginal:title, legs:[{ team:c.team }] };
    }
    return null;
  }

  const legs = [];
  const unsupported = [];
  for (const frag of frags){
    const c = classifyFragmentToAtomic(frag);
    switch (c.kind){
      case 'FOOTBALL_TEAM_WIN':
      case 'FOOTBALL_TEAM_TO_DRAW':
      case 'FOOTBALL_WIN_TO_NIL':
      case 'FOOTBALL_SGM_MO_BTTS':
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
