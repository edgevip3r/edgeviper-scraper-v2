// =============================================
// FILE: pipelines/run.snapshot.js  (ESM, book‑agnostic, writes LATEST.json)
// =============================================
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv){
  const out = {}; for (const a of argv.slice(2)){ const m=a.match(/^--([^=]+)(?:=(.*))?$/); if(m) out[m[1]] = m[2]===undefined?true:m[2]; } return out;
}
const args = parseArgs(process.argv);
const bookKey = String(args.book||'').trim().toLowerCase();
const debug = !!args.debug;
if(!bookKey){
  console.error('Usage: node pipelines/run.snapshot.js --book=<book> [--debug]');
  process.exit(1);
}

function cap(s){return s? s[0].toUpperCase()+s.slice(1):s}
async function loadSnapshot(book){
  const modPath = `../bookmakers/${book}/snapshot.js`;
  let mod; try{ mod = await import(modPath);}catch(e){
    console.error(`[snapshot] cannot import ${modPath}:`, e?.message||e); process.exit(1);
  }
  const candidates = ['default','snapshot','run','plugin'];
  for(const k of candidates){ const fn = mod?.[k]; if(typeof fn==='function') return fn; }
  console.error('[snapshot] no callable export found in', modPath); process.exit(1);
}

function ensureDir(p){ fs.mkdirSync(p, {recursive:true}); }
function writeLatestPointer(book, htmlPath){
  if(!htmlPath) return null;
  const dir = path.dirname(htmlPath);
  const latestDir = path.resolve(__dirname, '..', 'snapshots', book);
  ensureDir(latestDir);
  const ptrPath = path.join(latestDir, 'LATEST.json');
  const payload = { book, htmlPath, dir, at: new Date().toISOString() };
  fs.writeFileSync(ptrPath, JSON.stringify(payload,null,2), 'utf8');
  return ptrPath;
}

(async () => {
  try{
    const fn = await loadSnapshot(bookKey);
    const res = await fn({ debug });

    // Normalise result
    let htmlPath=null, screenshotPath=null, metaPath=null, outDir=null, ok=true;
    if(typeof res === 'string'){
      htmlPath = path.resolve(res);
    } else if (res && typeof res==='object'){
      htmlPath = res.htmlPath ? path.resolve(res.htmlPath) : null;
      screenshotPath = res.screenshotPath ? path.resolve(res.screenshotPath) : null;
      metaPath = res.metaPath ? path.resolve(res.metaPath) : null;
      outDir = res.outDir ? path.resolve(res.outDir) : (htmlPath?path.dirname(htmlPath):null);
      ok = res.ok !== false;
    }

    if(!htmlPath || !fs.existsSync(htmlPath)){
      console.error('[snapshot] failed: no htmlPath produced');
      console.log(JSON.stringify({ ok:false, book:bookKey, htmlPath:null, screenshotPath:null, metaPath:null }));
      process.exit(2);
    }

    const latestPtr = writeLatestPointer(bookKey, htmlPath);
    if(debug) console.log(`[snapshot:${bookKey}] html=${htmlPath}` + (latestPtr?` | LATEST→ ${latestPtr}`:''));

    console.log(JSON.stringify({ ok:true, book:bookKey, htmlPath, screenshotPath, metaPath }));
  }catch(e){
    console.error('[snapshot] failed:', e?.message||e);
    console.log(JSON.stringify({ ok:false, book:bookKey, htmlPath:null, screenshotPath:null, metaPath:null }));
    process.exit(1);
  }
})();