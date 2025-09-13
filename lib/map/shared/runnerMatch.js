//
// lib/map/shared/runnerMatch.js (v6 minimal)
// Token-based YES-runner picker tolerant to Betfair's shortened labels.
const DROP = new Set(['fc','cf','club','cp','the','de','cd','ud','ac','sc','sv','bk','nk','fk']);

function canonToken(t){
  let x = String(t||'').toLowerCase().replace(/\.+$/,'');
  if (DROP.has(x)) return '';
  if (x === 'at' || x === 'atl' || x === 'atleti') return 'atletico';
  if (x === 'ath' || x === 'athl') return 'athletic';
  if (x === 'sp' || x === 'sport' || x === 'sport.') return 'sporting';
  if (x === 'lis' || x === 'lisb') return 'lisbon';
  return x;
}

export function norm(s){
  return String(s||'')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/[–—]/g,'-')
    .replace(/[^a-z0-9/|\-\s\(\)]+/g,' ')
    .replace(/[\s\-_]+/g,' ')
    .trim();
}

export function tokens(s){
  return norm(s).split(' ').map(canonToken).filter(Boolean);
}

function parseYesLabel(raw){
  const s = norm(raw||'');
  let m = s.match(/^(.*?)[\s/|\-]+yes$/i);   // "Team/Yes", "Team - Yes"
  if (m && m[1]) return m[1].trim();
  m = s.match(/^(.*?)\s+\(yes\)$/i);          // "Team (Yes)"
  if (m && m[1]) return m[1].trim();
  m = s.match(/^(.*?)\s+yes$/i);              // "Team Yes"
  if (m && m[1]) return m[1].trim();
  m = s.match(/^yes[\s/|\-]+(.*?)$/i);       // "Yes / Team"
  if (m && m[1]) return m[1].trim();
  return ''; // not a YES label
}

function tokenScore(a, b){
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  let s = 0; for (const t of A){ if (B.has(t)) s++; }
  return s;
}

export function pickYesRunner(runners, homeName, awayName, preferTeam, debugLog){
  const yes = (Array.isArray(runners)?runners:[])
    .map(r => ({ r, raw: String(r.runnerName || r.selectionName || r.name || '') }))
    .map(x => ({ ...x, teamLike: parseYesLabel(x.raw) }))
    .filter(x => !!x.teamLike);

  if (!yes.length){
    if (debugLog) debugLog('[runnerMatch] no YES runners parsed');
    return null;
  }

  const preferHome = tokenScore(preferTeam, homeName);
  const preferAway = tokenScore(preferTeam, awayName);

  let best = null;
  for (const y of yes){
    const sHome = tokenScore(y.teamLike, homeName);
    const sAway = tokenScore(y.teamLike, awayName);
    const s = (preferHome >= preferAway) ? sHome : sAway;
    if (!best || s > best.s) best = { ...y, s };
  }

  if (best && best.s > 0) return best.r;
  // Fallback: strongest overlap to either side; if tie/zero, prefer home
  let alt = null;
  for (const y of yes){
    const s = Math.max(tokenScore(y.teamLike, homeName), tokenScore(y.teamLike, awayName));
    if (!alt || s > alt.s) alt = { ...y, s };
  }
  return (alt && alt.r) || null;
}
