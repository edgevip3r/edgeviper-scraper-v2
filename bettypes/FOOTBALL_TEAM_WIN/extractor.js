// bettypes/FOOTBALL_TEAM_WIN/extractor.js
export async function classify(title, { bookKey, typeId, debug } = {}) {
  const s = String(title || '').replace(/\s+/g, ' ').trim();
  if (/\b(btts|both\s+teams\s+to\s+score|win\s+to\s+nil|to\s+win\s+to\s+nil)\b/i.test(s)) return { match: false };

  const listMatch = s.match(/^(?<teams>.+?)\s+(?:both|all)\s+to\s+win\b/i);
  const singleMatch = s.match(/^(?<team>[^()]+?)\s+to\s+win\b/i);

  let teams = [];
  if (listMatch?.groups?.teams) {
    const raw = listMatch.groups.teams;
    teams = raw.split(/\s*(?:,|&|and)\s*/i).map(t => t.trim()).filter(Boolean);
  } else if (singleMatch?.groups?.team) {
    teams = [singleMatch.groups.team.trim()];
  } else {
    const multi = s.split(/\s*(?:,|;|\+|\|)\s*/).filter(Boolean);
    for (const part of multi) {
      const m = part.match(/^(?<team>[^()]+?)\s+to\s+win\b/i);
      if (m?.groups?.team) teams.push(m.groups.team.trim());
    }
  }
  teams = teams.filter(t => t.length >= 2 && !/(^\d+\/\d+$|^\d+\.\d+$)/.test(t));
  const seen = new Set(); teams = teams.filter(t => { const k=t.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
  return teams.length ? { match: true, legs: teams } : { match: false };
}
export default { classify };
