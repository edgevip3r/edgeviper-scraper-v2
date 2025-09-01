// =============================================================
// File: scripts/tools/aliases_match_and_compile.cjs
// Purpose: Take collected names (from data/collected/**), auto-match against
//          masters where confident, write overlays into data/aliases/**, and
//          produce a review CSV for ambiguous ones.
// CLI examples:
//    node scripts/tools/aliases_match_and_compile.cjs --collected=data/collected --min=0.86 --auto=0.94 --dry-run=false
// Notes:
//  - We NEVER invent aliases; only values present in collected files are considered.
//  - High confidence (>= auto) → written to the appropriate overlay file.
//  - Medium (>= min && < auto) → appended to review/aliases_pending.csv
//  - Low (< min) → ignored (reported summary only)
// =============================================================

const fsM = require('fs');
const pathM = require('path');

function arg(name, def){ const p=`--${name}=`; const h=process.argv.find(a=>a.startsWith(p)); return h? h.slice(p.length): def; }
function flag(name){ return process.argv.includes(`--${name}`); }
function ensureDirM(p){ if (!fsM.existsSync(p)) fsM.mkdirSync(p,{recursive:true}); }

const DATA_DIR = 'data';
const MASTER_DIR = pathM.join(DATA_DIR,'master');
const LEGACY_TEAMS = pathM.join(DATA_DIR,'teams','master.json');
const ALIASES_DIR = pathM.join(DATA_DIR,'aliases');

function stripDiacs(s){ return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,''); }
function norm(s){ return s? stripDiacs(s).toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim():''; }

function loadMasters(){
  const rows=[];
  const push=(r)=>{ if(!r||!r.id||!r.name) return; rows.push({id:r.id,name:r.name,kind:kindFromId(r.id),sport:sportFromId(r.id),country:r.country}); };
  if (fsM.existsSync(LEGACY_TEAMS)) { try { const arr=JSON.parse(fsM.readFileSync(LEGACY_TEAMS,'utf8')); if(Array.isArray(arr)) arr.forEach(push);} catch{} }
  if (fsM.existsSync(MASTER_DIR)) {
    (function walk(dir){
      for (const e of fsM.readdirSync(dir)){
        const full=pathM.join(dir,e); const st=fsM.statSync(full);
        if (st.isDirectory()) walk(full);
        else if (e.toLowerCase().endsWith('.json')) { try { const arr=JSON.parse(fsM.readFileSync(full,'utf8')); if(Array.isArray(arr)) arr.forEach(push);} catch{} }
      }
    })(MASTER_DIR);
  }
  return rows;
}

function kindFromId(id){ const k=id.split(':')[0]; return k; }
function sportFromId(id){ const k=id.split(':')[0]; if(['team','player','competition'].includes(k)) return 'football'; if(['horse','jockey','trainer','course'].includes(k)) return 'racing'; if(['tournament','tour'].includes(k)||id.startsWith('player:golf')) return 'golf'; return undefined; }

function loadCollected(root){
  const rows=[]; if(!root||!fsM.existsSync(root)) return rows;
  (function walk(dir){ for(const e of fsM.readdirSync(dir)){ const f=pathM.join(dir,e); const st=fsM.statSync(f); if(st.isDirectory()) walk(f); else if(e.toLowerCase().endsWith('.json')){ try{ const arr=JSON.parse(fsM.readFileSync(f,'utf8')); if(Array.isArray(arr)) rows.push(...arr);}catch{}} } })(root);
  return rows;
}

// Jaro-Winkler similarity (0..1)
function jaroWinkler(s1, s2){
  if (s1 === s2) return 1;
  const m = Math.floor(Math.max(s1.length, s2.length)/2)-1;
  let matches=0, transpositions=0;
  const s1Matches=new Array(s1.length).fill(false);
  const s2Matches=new Array(s2.length).fill(false);
  for(let i=0;i<s1.length;i++){
    const start=Math.max(0,i-m), end=Math.min(i+m+1,s2.length);
    for(let j=start;j<end;j++) if(!s2Matches[j] && s1[i]===s2[j]){ s1Matches[i]=true; s2Matches[j]=true; matches++; break; }
  }
  if(matches===0) return 0;
  let k=0; for(let i=0;i<s1.length;i++) if(s1Matches[i]){ while(!s2Matches[k]) k++; if(s1[i]!==s2[k]) transpositions++; k++; }
  transpositions/=2;
  const jaro=(matches/s1.length + matches/s2.length + (matches-transpositions)/matches)/3;
  // Winkler
  let l=0; while(l<Math.min(4,s1.length,s2.length) && s1[l]===s2[l]) l++;
  return jaro + l*0.1*(1-jaro);
}

function cleanForCompare(s, kind){
  let x = norm(s);
  // Football-specific suffix stripping
  if (kind==='team' || kind==='competition' || kind==='player'){
    x = x.replace(/\b(fc|cf|afc|c f|c\.f\.)\b/g,'').replace(/\bclub de\b/g,'').replace(/\s+/g,' ').trim();
  }
  return x;
}

function aliasPathFor(source, kind, sport){
  const base = source.startsWith('bookmaker:') ? pathM.join(ALIASES_DIR,'bookmakers', source.split(':')[1]) : pathM.join(ALIASES_DIR,'betfair');
  const map = {
    'team': 'team.json',
    'competition:football': 'competition.football.json',
    'player:football': 'player.football.json',
    'horse': 'horse.json',
    'course': 'course.racing.json',
    'player:golf': 'player.golf.json',
    'tournament:golf': 'tournament.golf.json'
  };
  let key = kind;
  if (kind==='player' || kind==='competition' || kind==='tournament') key = `${kind}:${sport}`;
  const file = map[key] || `${kind}.json`;
  return pathM.join(base, file);
}

function writeOverlay(source, kind, sport, raw, id, dryRun){
  const file = aliasPathFor(source, kind, sport);
  if (dryRun) return { file, wrote:false };
  const dir = pathM.dirname(file);
  if (!fsM.existsSync(dir)) fsM.mkdirSync(dir, { recursive: true });
  let obj = {};
  if (fsM.existsSync(file)) { try{ obj = JSON.parse(fsM.readFileSync(file,'utf8')) || {}; }catch{ obj={}; } }
  if (!obj[raw]) {
    obj[raw] = id;
    // stable key order
    const sorted = Object.fromEntries(Object.keys(obj).sort((a,b)=>a.localeCompare(b)).map(k=>[k,obj[k]]));
    fsM.writeFileSync(file, JSON.stringify(sorted, null, 2)+"\n", 'utf8');
    return { file, wrote:true };
  }
  return { file, wrote:false, already:true };
}

function writePendingCSV(rows){
  const revDir = pathM.join('review'); ensureDirM(revDir);
  const file = pathM.join(revDir, 'aliases_pending.csv');
  const header = 'source,kind,sport,raw,suggestedId,score,competition,bookie,example\n';
  if (!fsM.existsSync(file)) fsM.writeFileSync(header,'utf8');
  const esc = v => {
    if (v==null) return '';
    const s = String(v).replace(/"/g,'""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = rows.map(r => [r.source, r.kind, r.sport, r.raw, r.suggestedId||'', r.score!=null? r.score.toFixed(3):'', r.competition||'', r.bookie||'', r.example||''].map(esc).join(','));
  fsM.appendFileSync(file, lines.join('\n')+'\n','utf8');
  return file;
}

if (require.main === module) {
  (async function(){
    const collectedDir = arg('collected','data/collected');
    const min = parseFloat(arg('min','0.86'));   // queue threshold
    const auto = parseFloat(arg('auto','0.94')); // auto-accept threshold
    const dryRun = flag('dry-run');

    const masters = loadMasters();
    if (!masters.length) { console.error('No masters found. Populate data/teams/master.json or data/master/*.json'); process.exit(2); }

    // Bucket masters by kind for faster compare
    const byKind = new Map();
    for (const m of masters){ const k=m.kind; if(!byKind.has(k)) byKind.set(k, []); byKind.get(k).push(m); }

    const collected = loadCollected(collectedDir);
    if (!collected.length){ console.log('No collected rows. Run collectors first.'); return; }

    const pending=[]; let accepted=0, skipped=0, low=0;

    for (const r of collected){
      let kind = r.kind; let sport = r.sport;
      if (kind==='unknown') {
        // try to infer from masters by best score
        const guesses = ['team','player','competition','horse','course','tournament'];
        let best={score:0, kind:'team', id:null};
        for (const g of guesses){
          const cand = (byKind.get(g)||[]);
          for (const m of cand){
            const s = jaroWinkler(cleanForCompare(r.raw,g), cleanForCompare(m.name,g));
            if (s>best.score){ best={score:s, kind:g, id:m.id}; }
          }
        }
        kind = best.kind;
        if (!sport) sport = sportFromId(best.id) || 'football';
      }

      const candidates = byKind.get(kind)||[];
      // exact normalised match first
      const rn = cleanForCompare(r.raw, kind);
      let bestId=null, bestScore=0;
      for (const m of candidates){
        const score = jaroWinkler(rn, cleanForCompare(m.name, kind));
        if (score>bestScore){ bestScore=score; bestId=m.id; }
      }

      if (bestScore>=auto) {
        const res = writeOverlay(r.source, kind, sport, r.raw, bestId, dryRun);
        if (res.already) skipped++; else accepted++;
      } else if (bestScore>=min) {
        pending.push({ source:r.source, kind, sport, raw:r.raw, suggestedId:bestId, score:bestScore, competition: r.context && r.context.competition, bookie: r.source.startsWith('bookmaker:')? r.source.split(':')[1]: '', example: r.context && (r.context.event || r.context.file || '') });
      } else {
        low++;
      }
    }

    let pendingFile=null; if (pending.length) pendingFile = writePendingCSV(pending);

    console.log(`[aliases_match] accepted=${accepted} skipped(existing)=${skipped} queued=${pending.length} low=${low}`);
    if (pendingFile) console.log(`[aliases_match] review CSV -> ${pendingFile}`);
    if (!dryRun) console.log('[aliases_match] Next: run compile:  node scripts/tools/aliases_compile.js build');
  })().catch(e=>{ console.error(e); process.exit(1); });
}