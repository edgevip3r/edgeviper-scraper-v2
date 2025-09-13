#!/usr/bin/env node
/**
 * scripts/migrate/remove_legacy_bettypes.cjs
 * Patches config/global.json and bettypes/registry.json to remove legacy bettypes.
 *
 * Usage:
 *   node scripts/migrate/remove_legacy_bettypes.cjs
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const cfgPath = path.join(ROOT, 'config', 'global.json');
const regPath = path.join(ROOT, 'bettypes', 'registry.json');

const V2_TYPES = [
  "FOOTBALL_MULTI_AND",
  "FOOTBALL_TEAM_WIN",
  "FOOTBALL_TEAM_TO_DRAW",
  "FOOTBALL_SGM_MO_BTTS",
  "FOOTBALL_WIN_TO_NIL"
];

function readJson(p, def) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return def; }
}

function writeJson(p, obj){
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  console.log('[migrate] wrote', p);
}

(function main(){
  // 1) Patch config/global.json
  const cfg = readJson(cfgPath, {});
  cfg.features = cfg.features || {};
  cfg.features.bettypesV2Default = "on";
  cfg.bettypes = cfg.bettypes || {};
  cfg.bettypes.registryV2 = Array.isArray(cfg.bettypes.registryV2) && cfg.bettypes.registryV2.length
    ? Array.from(new Set(cfg.bettypes.registryV2))
    : V2_TYPES.slice();
  cfg.bettypes.registry = []; // legacy off
  writeJson(cfgPath, cfg);

  // 2) Patch bettypes/registry.json (fallback)
  writeJson(regPath, V2_TYPES);
})();
