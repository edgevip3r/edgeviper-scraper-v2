// lib/map/filters.js
// Central filters for mapping — with allow-list for specific "B/II" opponents.

import cfg from '../../config/global.json' with { type: 'json' };

const DEF_COMP_TOKENS = [
  'U21', 'U23', 'U20', 'U19', 'U18',
  'Development', 'Premier League 2', 'Academy', 'Youth',
  'Reserve', 'Reserves'
];

const DEF_TEAM_PATTERNS = [
  /\bU1[89]\b/i,        // U18/U19
  /\bU2[013]\b/i,       // U20/U21/U23
  /\bDevelopment\b/i,
  /\bAcademy\b/i,
  /\bYouth\b/i,
  /\bReserves?\b/i,
  /\bII\b$/i,           // "... II" at end
  /\bB\b$/i             // "... B" (Barcelona B, Real Sociedad B, etc.)
];

const compTokens = (cfg.mapping?.excludeCompetitionsTokens?.length)
  ? cfg.mapping.excludeCompetitionsTokens
  : DEF_COMP_TOKENS;

const teamPatterns = (cfg.mapping?.excludeTeamPatterns?.length)
  ? cfg.mapping.excludeTeamPatterns.map(s => new RegExp(s, 'i'))
  : DEF_TEAM_PATTERNS;

const allowOpponentsExact = (cfg.mapping?.allowOpponentsExact || []).map(s => String(s || '').toLowerCase());

function ciEq(a,b){ return String(a||'').toLowerCase() === String(b||'').toLowerCase(); }

export function shouldDropCandidate({ competitionName = '', eventName = '', runnerNames = [], targetTeam = '' }) {
  // 1) If opponent allow-list is present among runners, do NOT drop.
  const hasAllowedOpponent = runnerNames.some(n => allowOpponentsExact.includes(String(n||'').toLowerCase()));
  if (hasAllowedOpponent) return false;

  // 2) Drop by competition tokens (e.g., Premier League 2)
  const comp = String(competitionName || '').toLowerCase();
  for (const t of compTokens) {
    if (t && comp.includes(String(t).toLowerCase())) return true;
  }

  // 3) If the *target* team itself matches a drop pattern (e.g., name contains "B"),
  //    we *keep* the candidate — we only intend to filter based on opponents/competition.
  if (targetTeam && teamPatterns.some(rx => rx.test(targetTeam))) return false;

  // 4) Otherwise, drop if *any* name (event or runner) matches a reserve/youth pattern.
  const names = [String(eventName || ''), ...runnerNames.map(r => String(r || ''))];
  return names.some(n => teamPatterns.some(rx => rx.test(n)));
}