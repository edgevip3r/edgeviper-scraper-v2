// =============================================================
// File: scripts/tools/bookie_collect_names.cjs
// Purpose: Parse *offline* snapshots (JSON or HTML) from a bookmaker to
//          extract raw names, and write to data/collected/bookmakers/<bookie>/YYYY-MM-DD.json
// Notes:
//  - This is snapshot-first; pass --file=path-to-snapshot.(json|html)
//  - Heuristics favour JSON (look for common keys), otherwise regex text scan.
//  - Only strings we actually observe are saved.
// CLI examples:
//    node scripts/tools/bookie_collect_names.cjs --bookie=williamhill --sport=football --kind=team --file=snapshots/williamhill/epl-outrights.json
//    node scripts/tools/bookie_collect_names.cjs --bookie=skybet --sport=racing --kind=horse --file=snapshots/skybet/todays-races.html
// =============================================================

const fsB = require('fs');
const pathB = require('path');

function aVal(name, def) { const pref = `--${name}=`; const hit = process.argv.find(a => a.startsWith(pref)); return hit ? hit.slice(pref.length) : def; }
function ensureDirB(p){ if (!fsB.existsSync(p)) fsB.mkdirSync(p,{recursive:true}); }

function collectStringsFromJson(obj, bag) {
  if (obj == null) return;
  if (typeof obj === 'string') { bag.add(obj); return; }
  if (Array.isArray(obj)) { obj.forEach(v => collectStringsFromJson(v, bag)); return; }
  if (typeof obj === 'object') {
    for (const [k,v] of Object.entries(obj)) {
      // Prefer common namey keys
      if (typeof v === 'string' && /name|team|runner|selection|compet|tournament|course|player/i.test(k)) bag.add(v);
      collectStringsFromJson(v, bag);
    }
  }
}

function collectStringsFromHtml(text) {
  const bag = new Set();
  // crude extraction: anything between >...< that contains letters and spaces and is reasonably short
  const re = />\s*([^<>]{2,80}?)\s*</g;
  let m; while ((m = re.exec(text))) {
    const s = m[1].trim();
    if (/\d/.test(s) && !/[A-Za-z]/.test(s)) continue; // skip numeric-only
    if (s.length < 2) continue;
    bag.add(s);
  }
  return bag;
}

function normaliseB(s){ return s ? s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim() : ''; }

if (require.main === module) {
  (async function(){
    const bookie = aVal('bookie');
    const sport = aVal('sport','football');
    const kind = aVal('kind','team');
    const file = aVal('file');
    if (!bookie || !file) { console.error('Usage: --bookie=<name> --sport=<football|racing|golf> --kind=<team|competition|horse|course|player|tournament> --file=<snapshot.json|html>'); process.exit(1); }

    const outDir = pathB.join('data','collected','bookmakers', bookie);
    ensureDirB(outDir);

    let strings = new Set();
    const raw = fsB.readFileSync(file,'utf8');
    try {
      const json = JSON.parse(raw);
      const bag = new Set();
      collectStringsFromJson(json, bag);
      strings = bag;
    } catch {
      strings = collectStringsFromHtml(raw);
    }

    // Filter silly or too-generic tokens
    const bad = new Set(['home','away','draw','winner','odds','boost','specials','coupons','league','team','teams','players','races','race']);
    const rows = [];
    const seen = new Set();
    for (const s of strings) {
      const n = normaliseB(s);
      if (!n || n.length < 2) continue;
      if (bad.has(n)) continue;
      const key = `${kind}|${n}`;
      if (seen.has(key)) continue; seen.add(key);
      rows.push({ source: `bookmaker:${bookie}`, sport, kind, raw: s, context: { file } });
    }

    const stamp = new Date().toISOString().slice(0,10);
    const outFile = pathB.join(outDir, `${stamp}.json`);
    fsB.writeFileSync(outFile, JSON.stringify(rows, null, 2));
    console.log(`[bookie_collect] ${bookie} ${rows.length} rows -> ${outFile}`);
  })().catch(e => { console.error(e); process.exit(1); });
}