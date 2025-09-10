// bettypes/FOOTBALL_SGM_MO_BTTS/extractor.js
// Handles single-team "X to win & BTTS" and WH-style multi phrasing:
// "Team A & Team B Both To Win & All 4 Teams To Score"
export async function classify(title, { bookKey, typeId, debug } = {}) {
  const s = String(title || '').replace(/\s+/g, ' ').trim();

  // 1) William Hill-style multi: "<teams> Both To Win & All <num> Teams To Score"
  let m = s.match(/^(?<teams>.+?)\s+both\s+to\s+win\s*(?:,|&|and)\s*all\s+(?<num>\d+)\s+teams\s+to\s+score\b/i);
  if (m?.groups?.teams) {
    const teamsRaw = m.groups.teams;
    // split on comma, ampersand, "and"
    let teams = teamsRaw.split(/\s*(?:,|&|and)\s*/i).map(t => t.trim()).filter(Boolean);
    // Basic sanity: if "num" exists, it should equal 2*teams.length (but don't fail hard if it doesn't)
    // e.g., "All 4 Teams To Score" with 2 teams.
    if (teams.length) return { match: true, legs: teams };
  }

  // 2) General multi phrasing: "<teams> Both To Win & (BTTS|Both Teams To Score)"
  m = s.match(/^(?<teams>.+?)\s+both\s+to\s+win\s*(?:,|&|and)\s*(?:both\s+teams\s+to\s+score|btts)\b/i);
  if (m?.groups?.teams) {
    const teamsRaw = m.groups.teams;
    const teams = teamsRaw.split(/\s*(?:,|&|and)\s*/i).map(t => t.trim()).filter(Boolean);
    if (teams.length) return { match: true, legs: teams };
  }

  // 3) Single-team forms: "Team X to win & BTTS" or "BTTS & Team X to win"
  const rxA = /^(?<team>[^()]+?)\s+(?:to\s+win|win)\s*(?:,|&|and)\s*(?:both\s+teams\s+to\s+score|btts)\b/i;
  const rxB = /^(?:both\s+teams\s+to\s+score|btts)\s*(?:,|&|and)\s*(?<team>[^()]+?)\s+(?:to\s+win|win)\b/i;
  let team = null;
  m = s.match(rxA);
  if (m?.groups?.team) team = m.groups.team.trim();
  if (!team) { m = s.match(rxB); if (m?.groups?.team) team = m.groups.team.trim(); }
  if (team) return { match: true, legs: [team] };

  return { match: false };
}
export default { classify };
