//
// lib/map/shared/runnerMatch.js (v5)
// Adds tiny tweaks and keeps all v4 behavior.
//
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
    .replace(/[^a-z0-9/|\\\-\s\(\)]+/g,' ')
    .replace(/[\s\-_]+/g,' ')
    .trim();
}

export function tokens(s){
  return norm(s).split(' ').map(canonToken).filter(Boolean);
}

export function parseYesRunnerLabel(rawLabel){
  const raw = String(rawLabel||'');
  const s = norm(rawLabel||'');
  let m = s.match(/^(.*?)[\s/|\\-]+yes$/i);
  if (m && m[1]) return { teamLabel: m[1].trim(), yesNo: 'yes', raw };
  m = s.match(/^(.*?)\s+\(yes\)$/i);
  if (m && m[1]) return { teamLabel: m[1].trim(), yesNo: 'yes', raw };
  m = s.match(/^(.*?)\s+yes$/i);
  if (m && m[1]) return { teamLabel: m[1].trim(), yesNo: 'yes', raw };
  m = s.match(/^yes[\s/|\\-]+(.*?)$/i);
  if (m && m[1]) return { teamLabel: m[1].trim(), yesNo: 'yes', raw };
  if (s === 'yes') return { teamLabel: '', yesNo: 'yes', raw };
  return { teamLabel: s, yesNo: 'other', raw };
}

export function tokenScore(runnerLabel, teamName){
  const R = tokens(runnerLabel);
  const T = tokens(teamName);
  if (!R.length || !T.length) return 0;
  let score = 0;
  for (const r of R){
    const hit = T.find(t => t===r || t.startswith(r) || r.startswith(t));
    if (hit) score++;
  }
  return score;
}

export function pickYesRunner(runners, eventHome, eventAway, preferTeam, debugLog){
  const R = Array.isArray(runners) ? runners : [];
  const home = String(eventHome||'');
  const away = String(eventAway||'');
  const prefer = String(preferTeam||'');

  const parsed = R.map((r) => {
    const raw = String(r.runnerName || r.selectionName || r.name || '');
    const p = parseYesRunnerLabel(raw);
    return { ...p, runner: r };
  }).filter(x => x.yesNo === 'yes');

  if (!parsed.length){
    if (typeof debugLog === 'function'){
      const names = R.map(r => String(r.runnerName || r.selectionName || r.name || '')).join(' | ') || '(no runner names on MarketBook)';
      debugLog(`[runnerMatch] no YES runners parsed | runners=${names}`);
    }
    return null;
  }

  function scoreTeam(p, team){ return tokenScore(p.teamLabel, team); }

  let best = null;
  for (const p of parsed){
    const sHome = scoreTeam(p, home);
    const sAway = scoreTeam(p, away);
    const s = Math.max(sHome, sAway);
    if (!best || s > best.s) best = { p, s };
  }
  if (best && best.s>0) return best.p.runner;

  // As last resort: if labels don't overlap tokens at all, pick by preference (favor home if ambiguous).
  const prefHome = tokenScore(prefer, home);
  const prefAway = tokenScore(prefer, away);
  if (prefHome || prefAway){
    return (prefAway > prefHome ? parsed[1] : parsed[0]).runner || null;
  }

  if (typeof debugLog === 'function'){
    const names = parsed.map(p=>p.teamLabel).join(' | ');
    debugLog(`[runnerMatch] ambiguous YES labels: ${names}`);
  }
  return null;
}
