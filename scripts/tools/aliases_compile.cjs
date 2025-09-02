// =============================================
// File: scripts/tools/aliases_compile.js
// Purpose: Build alias indices for teams/players/horses/golf/etc.
//  - Outputs (by default):
//      data/compiled/aliases.index.json            (teams-only; back-compat)
//      data/compiled/aliases.extended.index.json   (everything; future-proof)
//  - Design choices for this repo (V2):
//      * By DEFAULT we only compile aliases actually present in our sources
//        (masters + bookmaker/betfair alias overlays). We EXCLUDE "possible"
//        or hypothetical variants.
//      * Synonyms (search-only) are EXCLUDED by default to avoid confusion.
//        Use --include-synonyms explicitly, or gate them by --collected so
//        only synonyms observed in scraped data are included.
//
// CLI:
//   node scripts/tools/aliases_compile.js build \
//        [--out=data/compiled] \
//        [--include-synonyms] \
//        [--collected=data/collected] \
//        [--kinds=team,player:football,competition,horse,course,tournament]
//
// Notes:
//  - Requires only Node core modules (fs, path, crypto). No external deps.
//  - Safe to run even if some folders/files are missing; it will just skip.
//  - Normalisation removes diacritics, lowercases, collapses whitespace, and
//    unifies punctuation. Women/B/Uxx are excluded by default.
// =============================================

const fs = require('fs');
const path = require('path');

const DEFAULT_OUT_DIR = path.join('data', 'compiled');
const DATA_DIR = 'data';
const MASTER_TEAM_FILE = path.join(DATA_DIR, 'teams', 'master.json'); // legacy path support
const MASTER_DIR = path.join(DATA_DIR, 'master'); // new multi-entity masters live here
const ALIASES_DIR = path.join(DATA_DIR, 'aliases');
const SYNONYMS_DIR = path.join(DATA_DIR, 'synonyms');

const ARGV = process.argv.slice(2);

function getArgFlag(name) {
  return ARGV.includes(`--${name}`);
}

function getArgValue(name, def = undefined) {
  const pref = `--${name}=`;
  const hit = ARGV.find(a => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : def;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

// ---------------- Normalisation helpers ----------------
function stripDiacritics(s) {
  return s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function normaliseKey(raw) {
  if (typeof raw !== 'string') return '';
  let s = stripDiacritics(raw)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ') // keep letters/numbers; replace others with space
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

// Exclusion: default-off categories unless explicitly allowed later
const DEFAULT_EXCLUDE_PATTERNS = [
  /\bwomen\b/i,
  /\bladies\b/i,
  /\bu(?:-)?(?:18|19|20|21|23)\b/i,
  /\b(b|ii|iii)\s*team\b/i,
  /\b(b|ii|iii)\b(?![a-z])/i, // bare Roman/B squads
  /\(w\)/i,
];

function shouldExcludeRawName(raw) {
  if (typeof raw !== 'string') return false;
  return DEFAULT_EXCLUDE_PATTERNS.some(rx => rx.test(raw));
}

// ---------------- File helpers ----------------
function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) return null;
    return JSON.parse(text);
  } catch (e) {
    console.warn(`[WARN] Failed to parse JSON: ${file}: ${e.message}`);
    return null;
  }
}

function listJsonFilesRecursive(root) {
  const out = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile() && entry.toLowerCase().endsWith('.json')) out.push(full);
    }
  })(root);
  return out;
}

// ---------------- Load masters ----------------
function loadMasters() {
  const entities = [];

  // Legacy teams master
  const teamsMaster = readJsonSafe(MASTER_TEAM_FILE);
  if (Array.isArray(teamsMaster)) {
    for (const row of teamsMaster) {
      if (!row || !row.id || !row.name) continue;
      entities.push({
        id: row.id,
        name: row.name,
        kind: row.kind || inferKindFromId(row.id) || 'team',
        sport: row.sport || 'football',
        country: row.country || undefined,
        source: 'master',
        priority: 100,
      });
    }
  }

  // New-style masters in data/master/*.json
  if (fs.existsSync(MASTER_DIR)) {
    for (const f of listJsonFilesRecursive(MASTER_DIR)) {
      const arr = readJsonSafe(f);
      if (!Array.isArray(arr)) continue;
      for (const row of arr) {
        if (!row || !row.id || !row.name) continue;
        entities.push({
          id: row.id,
          name: row.name,
          kind: row.kind || inferKindFromId(row.id) || inferKindFromPath(f),
          sport: row.sport || inferSportFromId(row.id) || inferSportFromPath(f),
          country: row.country || undefined,
          source: 'master',
          priority: 100,
        });
      }
    }
  }

  return entities;
}

function inferKindFromId(id) {
  if (typeof id !== 'string') return undefined;
  const pref = id.split(':')[0];
  // Accept composite kinds like player:football
  return pref.includes('/') ? pref.split('/')[0] : pref; // but we preserve full id
}

function inferSportFromId(id) {
  if (typeof id !== 'string') return undefined;
  const parts = id.split(':');
  if (parts.length >= 2) {
    const maybe = parts[0];
    if (['team', 'player', 'competition', 'horse', 'jockey', 'trainer', 'course', 'tournament', 'tour'].includes(maybe)) {
      const tail = parts[1] || '';
      if (tail.startsWith('eng') || tail.startsWith('fra') || tail.startsWith('esp')) return 'football';
    }
  }
  return undefined;
}

function inferKindFromPath(p) {
  const s = p.toLowerCase();
  if (s.includes('football.players')) return 'player:football';
  if (s.includes('football') && s.includes('competitions')) return 'competition';
  if (s.includes('racing.horses')) return 'horse';
  if (s.includes('racing.jockeys')) return 'jockey';
  if (s.includes('racing.trainers')) return 'trainer';
  if (s.includes('racing.courses')) return 'course';
  if (s.includes('golf.players')) return 'player:golf';
  if (s.includes('golf.tournaments')) return 'tournament';
  if (s.includes('golf.tours')) return 'tour';
  return undefined;
}

function inferSportFromPath(p) {
  const s = p.toLowerCase();
  if (s.includes('football')) return 'football';
  if (s.includes('racing')) return 'racing';
  if (s.includes('golf')) return 'golf';
  return undefined;
}

// ---------------- Load aliases & synonyms ----------------
function loadAliasOverlays() {
  const out = [];
  if (!fs.existsSync(ALIASES_DIR)) return out;
  const files = listJsonFilesRecursive(ALIASES_DIR);
  for (const f of files) {
    const obj = readJsonSafe(f);
    if (!obj || typeof obj !== 'object') continue;
    const lowerPath = f.replace(/\\/g, '/').toLowerCase();
    const source = lowerPath.includes('/bookmakers/')
      ? `bookmaker:${lowerPath.split('/bookmakers/')[1].split('/')[0]}`
      : lowerPath.includes('/betfair/')
        ? 'betfair'
        : 'aliases';
    const guessedKind = inferKindFromPath(lowerPath);
    for (const [raw, id] of Object.entries(obj)) {
      if (!raw || !id) continue;
      out.push({ raw, id, source, kind: inferKindFromId(id) || guessedKind, sport: inferSportFromId(id) || inferSportFromPath(lowerPath), priority: source.startsWith('bookmaker:') ? 70 : 60 });
    }
  }
  return out;
}

function loadSynonyms(includeSynonyms, collectedSet) {
  const out = [];
  if (!includeSynonyms) return out; // default OFF unless explicitly asked
  if (!fs.existsSync(SYNONYMS_DIR)) return out;
  for (const f of listJsonFilesRecursive(SYNONYMS_DIR)) {
    const m = readJsonSafe(f);
    if (!m || typeof m !== 'object') continue;
    const guessedKind = inferKindFromPath(f);
    const sport = inferSportFromPath(f);
    for (const [id, variants] of Object.entries(m)) {
      if (!Array.isArray(variants)) continue;
      for (const raw of variants) {
        if (!raw) continue;
        if (collectedSet && collectedSet.size && !collectedSet.has(raw)) continue; // gate by observed strings if provided
        out.push({ raw, id, source: 'synonym', kind: inferKindFromId(id) || guessedKind, sport, priority: 40 });
      }
    }
  }
  return out;
}

// ---------------- Collected gating ----------------
function loadCollectedRawStrings(collectedDir) {
  const set = new Set();
  if (!collectedDir || !fs.existsSync(collectedDir)) return set;
  const files = listJsonFilesRecursive(collectedDir);
  const pick = (v) => {
    if (typeof v === 'string') set.add(v);
    else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) pick(v[k]);
    } else if (Array.isArray(v)) {
      for (const x of v) pick(x);
    }
  };
  for (const f of files) {
    const data = readJsonSafe(f);
    if (data == null) continue;
    pick(data);
  }
  return set;
}

// ---------------- Build index ----------------
function buildIndex({ masters, overlays, synonyms }) {
  // Index: normalised key -> array of entries {id, kind, sport, country, source, priority}
  const index = Object.create(null);

  const push = (raw, entry) => {
    if (!raw || shouldExcludeRawName(raw)) return; // enforce default exclusions
    const key = normaliseKey(raw);
    if (!key) return;
    if (!index[key]) index[key] = [];
    // avoid duplicates for same id/source
    if (!index[key].some(e => e.id === entry.id && e.source === entry.source)) index[key].push(entry);
  };

  // Masters: push canonical name as a variant
  for (const m of masters) {
    push(m.name, { id: m.id, kind: m.kind, sport: m.sport, country: m.country, source: m.source, priority: m.priority });
  }

  // Aliases overlays (bookmakers, betfair aliases)
  for (const a of overlays) {
    push(a.raw, { id: a.id, kind: a.kind, sport: a.sport, source: a.source, priority: a.priority });
  }

  // Synonyms (opt-in / gated)
  for (const s of synonyms) {
    push(s.raw, { id: s.id, kind: s.kind, sport: s.sport, source: s.source, priority: s.priority });
  }

  // sort each bucket by priority desc then id asc for determinism
  for (const k of Object.keys(index)) {
    index[k].sort((a, b) => (b.priority - a.priority) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  return index;
}

function filterIndexByKinds(index, allowedKinds) {
  if (!allowedKinds || allowedKinds.size === 0) return index;
  const out = Object.create(null);
  for (const [k, arr] of Object.entries(index)) {
    const filt = arr.filter(e => allowedKinds.has(e.kind));
    if (filt.length) out[k] = filt;
  }
  return out;
}

function deriveTeamsOnly(index) {
  const out = Object.create(null);
  for (const [k, arr] of Object.entries(index)) {
    const teams = arr.filter(e => e.kind === 'team');
    if (teams.length) {
      // de-duplicate IDs across sources (master, bookmaker, betfair)
      const seen = new Set();
      const uniq = [];
      for (const e of teams) {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          uniq.push(e.id);
        }
      }
      out[k] = uniq;
    }
  }
  return out;
}

function writeJsonPretty(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function main() {
  const cmd = ARGV[0];
  if (cmd !== 'build') {
    console.error('Usage: node scripts/tools/aliases_compile.js build [--out=dir] [--include-synonyms] [--collected=dir] [--kinds=team,horse,...]');
    process.exit(1);
  }

  const outDir = getArgValue('out', DEFAULT_OUT_DIR);
  const includeSyn = getArgFlag('include-synonyms');
  const collectedDir = getArgValue('collected', undefined);
  const kindsArg = getArgValue('kinds', '');
  const kindsSet = new Set((kindsArg || '').split(',').map(s => s.trim()).filter(Boolean));

  const masters = loadMasters();
  const overlays = loadAliasOverlays();
  const observed = loadCollectedRawStrings(collectedDir);
  const synonyms = loadSynonyms(includeSyn, observed);

  console.log(`[aliases_compile] masters=${masters.length} overlays=${overlays.length} synonyms=${synonyms.length} observed=${observed.size}`);

  let index = buildIndex({ masters, overlays, synonyms });
  if (kindsSet.size) index = filterIndexByKinds(index, kindsSet);

  // Extended index with metadata & byKind view
  const byKind = {};
  for (const [k, arr] of Object.entries(index)) {
    for (const e of arr) {
      if (!byKind[e.kind]) byKind[e.kind] = {};
      if (!byKind[e.kind][k]) byKind[e.kind][k] = [];
      // push shallow copy to avoid accidental mutation
      byKind[e.kind][k].push({ id: e.id, kind: e.kind, sport: e.sport, country: e.country, source: e.source, priority: e.priority });
    }
  }

  const extended = {
    version: 4,
    generatedAt: new Date().toISOString(),
    index,
    byKind,
  };

  const teamsOnly = deriveTeamsOnly(index);

  writeJsonPretty(path.join(outDir, 'aliases.extended.index.json'), extended);
  writeJsonPretty(path.join(outDir, 'aliases.index.json'), teamsOnly);

  // Summary
  const keys = Object.keys(index).length;
  const teamKeys = Object.keys(teamsOnly).length;
  console.log(`[aliases_compile] wrote: ${path.join(outDir, 'aliases.extended.index.json')} (keys=${keys})`);
  console.log(`[aliases_compile] wrote: ${path.join(outDir, 'aliases.index.json')} (team-keys=${teamKeys})`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error(e); process.exit(1); }
}