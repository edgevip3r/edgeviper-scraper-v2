// =============================================
// FILE: pipelines/run.parse.js  (ESM, book‑agnostic, per‑book parserInput via data/bookmakers/<book>.json)
// =============================================
import fs2 from 'node:fs';
import fsp2 from 'node:fs/promises';
import path2 from 'node:path';
import { fileURLToPath as f2 } from 'node:url';
import { fracToDec } from '../lib/text/odds.parse.js';

const __f2 = f2(import.meta.url);
const __d2 = path2.dirname(__f2);
function args2(argv){ const o={}; for(const a of argv.slice(2)){ const m=a.match(/^--([^=]+)(?:=(.*))?$/); if(m) o[m[1]] = m[2]===undefined?true:m[2]; } return o; }
const ARGS = args2(process.argv);
const BOOK = String(ARGS.book||'').trim().toLowerCase();
const DBG = !!ARGS.debug;
let HTML = ARGS.file ? path2.resolve(process.cwd(), String(ARGS.file)) : null;
if(!BOOK){
  let avail=[]; try{ avail = fs2.readdirSync(path2.resolve(__d2,'..','bookmakers'),{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name).sort(); }catch{}
  console.error('Usage: node pipelines/run.parse.js --book=<book> [--file="path\\to\\page.html"] [--debug]');
  if(avail.length) console.error('Available books:', avail.join(', '));
  process.exit(1);
}

function latestFromPtr(b){ try{ const p=path2.resolve(__d2,'..','snapshots',b,'LATEST.json'); if(!fs2.existsSync(p)) return null; const j=JSON.parse(fs2.readFileSync(p,'utf8')); const hp=j?.htmlPath; return hp && fs2.existsSync(hp) ? path2.resolve(hp):null; }catch{return null;} }
function latestByScan(b){ const root=path2.resolve(__d2,'..','snapshots',b); if(!fs2.existsSync(root)) return null; let best=null; const stack=[root]; while(stack.length){ const d=stack.pop(); let ents=[]; try{ ents=fs2.readdirSync(d,{withFileTypes:true}); }catch{continue;} for(const e of ents){ const full=path2.join(d,e.name); if(e.isDirectory()) stack.push(full); else if(e.isFile() && e.name.toLowerCase()==='page.html'){ let t=0; try{ t=fs2.statSync(full).mtimeMs; }catch{} if(!best||t>best.t) best={file:full,t}; } } } return best?best.file:null; }
if(!HTML){ HTML = latestFromPtr(BOOK) || latestByScan(BOOK); }
if(!HTML){ console.error('[parse] no HTML found. Provide --file or run snapshot first.'); process.exit(1); }

function readCfg(b){ try{ const p=path2.resolve(__d2,'..','data','bookmakers',`${b}.json`); return JSON.parse(fs2.readFileSync(p,'utf8')); }catch{return {};} }
function sourceUrlFromMeta(file){ const dir=path2.dirname(file); const meta=path2.join(dir,'meta.json'); if(fs2.existsSync(meta)){ try{ const j=JSON.parse(fs2.readFileSync(meta,'utf8')); return j?.url||null; }catch{} } return null; }
function outPathFor(html){ const dir=path2.dirname(html); const base=path2.basename(html).replace(/\.html?$/i,''); return path2.join(dir,`${base}.rawoffers.json`); }
function normTitle(t){ return String(t||'').replace(/\s+/g,' ').trim(); }
function toDec(it){ if(it.boostedOddsDec!=null) return Number(it.boostedOddsDec); if(it.oddsDec!=null) return Number(it.oddsDec); const f=it.boostedOddsFrac??it.oddsRaw??it.oddsFrac??null; if(f){ const d=fracToDec(f); return d==null?null:Number(d);} return null; }
function standardise(items, {bookKey, sourceUrlFallback, baseUrlFallback}){ const out=[]; for(const it of items){ const title=normTitle(it.text||it.title||it.name||''); const dec=toDec(it); if(!title||dec==null) continue; const url=it.url||it.sourceUrl||sourceUrlFallback||baseUrlFallback||null; out.push({ bookie:bookKey, sportHint: it.sportHint||'Football', text:title, textOriginal: it.textOriginal||it.title||title, boostedOddsFrac: it.boostedOddsFrac??it.oddsRaw??it.oddsFrac??null, boostedOddsDec: dec, url, sourceUrl:url }); } return out; }
async function readJsonFile(p){ const t=await fsp2.readFile(p,'utf8'); try{ return JSON.parse(t);}catch{ throw new Error(`Malformed JSON: ${p}`);} }
function unwrap(raw){ if(Array.isArray(raw)) return raw; if(Array.isArray(raw.rawOffers)) return raw.rawOffers; if(Array.isArray(raw.offers)) return raw.offers; if(Array.isArray(raw.raw)) return raw.raw; return []; }

async function loadParser(book){ const modPath=`../bookmakers/${book}/parser.js`; let mod; try{ mod=await import(modPath);}catch(e){ console.error(`[parse] cannot import parser at ${modPath}:`, e?.message||e); process.exit(1);} const names=['default','parser','parse',`parse${cap(book)}`]; for(const n of names){ const fn=mod?.[n]; if(typeof fn==='function') return fn; } console.error('[parse] parser export not found. Expected one of:', names.join(', ')); process.exit(1); }
function cap(s){return s? s[0].toUpperCase()+s.slice(1):s}

(async()=>{
  try{
    const parseFn = await loadParser(BOOK);
    const cfg = readCfg(BOOK);
    const parserInput = String(cfg?.parserInput||'html').toLowerCase(); // book-agnostic; no hard-coded names
    const baseUrlFallback = (cfg?.baseUrls && cfg.baseUrls[0]) || null;
    const sourceUrl = sourceUrlFromMeta(HTML);

    if(DBG) console.log(`[parse:${BOOK}] using htmlPath=${HTML} | input=${parserInput}`);

    let result;
    if(parserInput==='path'){
      result = await parseFn(HTML, { debug:DBG, bookKey:BOOK, htmlPath:HTML, sourceUrl, seenAtIso:new Date().toISOString() });
    } else {
      const html = await fsp2.readFile(HTML,'utf8');
      result = await parseFn(html, { debug:DBG, bookKey:BOOK, htmlPath:HTML, sourceUrl, seenAtIso:new Date().toISOString() });
    }

    let items;
    if(typeof result==='string'){
      const raw = await readJsonFile(result); items = unwrap(raw);
    } else if(result && typeof result==='object' && !Array.isArray(result) && typeof result.outPath==='string'){
      const raw = await readJsonFile(result.outPath); items = unwrap(raw);
    } else {
      items = unwrap(result);
    }

    const std = standardise(items, { bookKey:BOOK, sourceUrlFallback:sourceUrl, baseUrlFallback });
    const outPath = outPathFor(HTML);
    await fsp2.writeFile(outPath, JSON.stringify({ rawOffers: std }, null, 2), 'utf8');
    console.log(`[parse:${BOOK}] wrote ${std.length} raw offers → ${outPath}`);
    if(DBG) for(const r of std.slice(0,6)) console.log(' -', r.text, '|', r.boostedOddsFrac??'', '|', r.boostedOddsDec, '|', r.sourceUrl??'');
  }catch(e){ console.error('[parse] failed:', e?.message||e); process.exit(1); }
})();