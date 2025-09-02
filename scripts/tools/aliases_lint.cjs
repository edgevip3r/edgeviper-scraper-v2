// =============================================
// File: scripts/tools/aliases_lint.js
// Purpose: Lint alias sources and compiled indices for conflicts & bad patterns.
//  - Checks:
//     * Conflicting mappings: same normalised key -> multiple IDs of SAME kind
//     * Banned tokens in alias keys (Women/Ladies/U21/U23/B/II/III)
//     * Orphan IDs in alias files not present in masters
//  - Exit non-zero on severe conflicts so CI can fail the build.
// =============================================

const fs2 = require('fs');
const path2 = require('path');

const DATA_DIR2 = 'data';
const COMPILED_EXT = path2.join(DATA_DIR2, 'compiled', 'aliases.extended.index.json');
const COMPILED_TEAMS = path2.join(DATA_DIR2, 'compiled', 'aliases.index.json');
const ALIASES_DIR2 = path2.join(DATA_DIR2, 'aliases');
const MASTER_TEAM_FILE2 = path2.join(DATA_DIR2, 'teams', 'master.json');
const MASTER_DIR2 = path2.join(DATA_DIR2, 'master');

function readJsonSafe2(f) { try { if (!fs2.existsSync(f)) return null; return JSON.parse(fs2.readFileSync(f, 'utf8')); } catch { return null; } }
function listJsonFilesRecursive2(root) {
  const out = [];
  (function walk(dir) {
    if (!fs2.existsSync(dir)) return;
    for (const entry of fs2.readdirSync(dir)) {
      const full = path2.join(dir, entry);
      const st = fs2.statSync(full);
      if (st.isDirectory()) walk(full); else if (entry.toLowerCase().endsWith('.json')) out.push(full);
    }
  })(root);
  return out;
}

function normaliseKey2(s) {
  return s
    ? s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

const BANNED = [ /\bwomen\b/i, /\bladies\b/i, /\bu(?:-)?(?:18|19|20|21|23)\b/i, /\b(b|ii|iii)\s*team\b/i, /\(w\)/i ];

function loadMasterIds2() {
  const ids = new Set();
  const t = readJsonSafe2(MASTER_TEAM_FILE2);
  if (Array.isArray(t)) for (const r of t) if (r && r.id) ids.add(r.id);
  if (fs2.existsSync(MASTER_DIR2)) {
    for (const f of listJsonFilesRecursive2(MASTER_DIR2)) {
      const arr = readJsonSafe2(f);
      if (Array.isArray(arr)) for (const r of arr) if (r && r.id) ids.add(r.id);
    }
  }
  return ids;
}

function lintCompiled() {
  const issues = { conflicts: [], banned: [], orphans: [] };

  const extended = readJsonSafe2(COMPILED_EXT);
  if (extended && extended.index) {
    for (const [key, entries] of Object.entries(extended.index)) {
      const byKind = new Map();
      for (const e of entries) {
        if (!byKind.has(e.kind)) byKind.set(e.kind, new Set());
        byKind.get(e.kind).add(e.id);
      }
      for (const [kind, idset] of byKind.entries()) {
        if (idset.size > 1) {
          issues.conflicts.push({ key, kind, ids: Array.from(idset) });
        }
      }
      if (BANNED.some(rx => rx.test(key))) issues.banned.push({ key });
    }
  } else {
    // fall back to teams-only index (we can't detect multi-id conflicts by kind here)
    const teamsOnly = readJsonSafe2(COMPILED_TEAMS) || {};
    for (const key of Object.keys(teamsOnly)) if (BANNED.some(rx => rx.test(key))) issues.banned.push({ key });
  }

  // Orphans in alias files
  const masterIds = loadMasterIds2();
  for (const f of listJsonFilesRecursive2(ALIASES_DIR2)) {
    const obj = readJsonSafe2(f);
    if (!obj || typeof obj !== 'object') continue;
    for (const id of Object.values(obj)) {
      if (!masterIds.has(id)) issues.orphans.push({ file: f, id });
    }
  }

  // Report
  const hasConflicts = issues.conflicts.length > 0;
  const hasBanned = issues.banned.length > 0;
  const hasOrphans = issues.orphans.length > 0;

  if (hasConflicts) {
    console.error(`[aliases_lint] CONFLICTS: ${issues.conflicts.length}`);
    for (const c of issues.conflicts.slice(0, 20)) {
      console.error(`  key='${c.key}' kind='${c.kind}' ids=${c.ids.join(',')}`);
    }
  }
  if (hasBanned) {
    console.error(`[aliases_lint] BANNED TOKENS: ${issues.banned.length}`);
    for (const b of issues.banned.slice(0, 20)) {
      console.error(`  key='${b.key}'`);
    }
  }
  if (hasOrphans) {
    console.error(`[aliases_lint] ORPHAN IDS (not in masters): ${issues.orphans.length}`);
    for (const o of issues.orphans.slice(0, 20)) {
      console.error(`  file='${o.file}' id='${o.id}'`);
    }
  }

  const exitBad = hasConflicts || hasOrphans; // banned is a warning; conflicts/orphans fail
  if (exitBad) process.exit(2);
  console.log('[aliases_lint] OK');
}

if (require.main === module) {
  try { lintCompiled(); } catch (e) { console.error(e); process.exit(1); }
}