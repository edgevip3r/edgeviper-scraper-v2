
// pipelines/run.classify.js — DEBUG-FIRST (defensive) build
// - Loads cfg via fs to avoid import-attributes issues
// - Adds explicit init logs
// - Wires football_multi_and detector
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { resolveBookKey } from '../lib/books/resolveBook.js';
import { composeFootballMultiAnd } from '../lib/classify/composer/football_multi_and.simple.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function loadCfg(){
  const p = path.resolve(__dirname, '..', 'config', 'global.json');
  try {
    const txt = await fs.readFile(p, 'utf8');
    const j = JSON.parse(txt);
    return j;
  } catch (e) {
    console.warn('[classify] WARN: cannot load config/global.json, defaulting features:', e?.message || e);
    return { features: { bettypesV2Default: 'off' }, bettypes: {} };
  }
}

function args(argv){
  const o={};
  for(const a of argv.slice(2)){
    const m=a.match(/^--([^=]+?)(?:=(.*))?$/);
    if(m) o[m[1]]=m[2]??true;
  }
  return o;
}

const a=args(process.argv);
const debug = a.debug===''||a.debug===true||a.debug==='true';
const fileArg=a.in?path.resolve(a.in):null;

(async()=>{
  try {
    const cfg = await loadCfg();
    const MODE = (process.env.EV_BETTYPES_V2 || (cfg?.features?.bettypesV2Default ?? 'off')).toLowerCase();

    if (debug) {
      console.log(`[classify:init] node=${process.version} cwd=${process.cwd()}`);
      console.log(`[classify:init] __dirname=${__dirname}`);
      console.log(`[classify:init] args:`, JSON.stringify(a));
      console.log(`[classify:init] MODE=${MODE}`);
    }

    if(!a.book && !fileArg){
      console.error('Usage: node pipelines/run.classify.js --book= [--in=...rawoffers.json] [--debug]');
      process.exit(1);
    }

    let bookKey;
    if(a.book){
      const r=await resolveBookKey(String(a.book));
      bookKey=r.canonical;
    } else {
      const m=fileArg.match(/[\\\/]snapshots[\\\/ ]([^\\\/ ]+)[\\\/]/i);
      if(!m) throw new Error('Cannot infer --book from --in path.');
      bookKey=m[1];
    }

    const inPath=fileArg||await findLatestRawOffers(bookKey);
    if (debug) console.log(`[classify:${bookKey}] resolved inPath=`, inPath || '(none)');

    if(!inPath){
      console.error(`[classify:${bookKey}] no *.rawoffers.json found.`);
      process.exit(1);
    }

    const raw = await readJson(inPath);
    const items = Array.isArray(raw.rawOffers)?raw.rawOffers:Array.isArray(raw.offers)?raw.offers:Array.isArray(raw.raw)?raw.raw:[];
    if (debug) console.log(`[classify:${bookKey}] items=${items.length}`);

    const regLegacy = Array.isArray(cfg?.bettypes?.registry)&&cfg.bettypes.registry.length? cfg.bettypes.registry : await loadRegistryFallback();
    const regV2 = Array.isArray(cfg?.bettypes?.registryV2)? cfg.bettypes.registryV2 : [];
    const ordered = (MODE==='off') ? regLegacy : [...regV2, ...regLegacy]; // V2 first
    const allIds = Array.from(new Set([...regV2, ...regLegacy]));

    if (debug) {
      console.log(`[classify] V2 MODE=${MODE}`);
      console.log(`[classify] regLegacy=${regLegacy.join(',')}`);
      console.log(`[classify] regV2=${regV2.join(',')}`);
    }

    const preloaded = await Promise.all(allIds.map(async(typeId)=>({ typeId, rec: await loadRecognisers(typeId, bookKey), extractor: await loadExtractor(typeId) })));
    const byId = new Map(preloaded.map(t=>[t.typeId, t]));

    if (debug) {
      for (const t of preloaded) {
        const posN = Array.isArray(t.rec?.positive) ? t.rec.positive.length : 0;
        const negN = Array.isArray(t.rec?.negative) ? t.rec.negative.length : 0;
        const hasEx = !!t.extractor;
        console.log(`[rec:${t.typeId}] pos=${posN} neg=${negN} extractor=${hasEx?'yes':'no'}`);
      }
    }

    const outputs=[];
    let inCount=0,outCount=0;

    for(const it of items){
      const titleOriginal=String(it.text||it.title||'').trim();
      const boostedOddsFrac = it.boostedOddsFrac ?? it.oddsRaw ?? null;
      const boostedOddsDec = it.boostedOddsDec ?? it.oddsDec ?? null;
      if(!titleOriginal || boostedOddsDec==null){
        if(debug) console.log('[skip:pre]', titleOriginal?'no-odds':'no-text');
        continue;
      }
      inCount++;

      // Detector: win+win+draw / win+win+win-to-nil
      const composed = composeFootballMultiAnd(
        {
          title: titleOriginal, text: titleOriginal, rawText: titleOriginal,
          teams: Array.isArray(it.teams)? it.teams: undefined,
          legs: Array.isArray(it.legs)? it.legs.map(t=>({team:t})): undefined,
          boostedOddsFrac, boostedOddsDec
        },
        { book: bookKey }
      );
      if (composed) {
        const srcUrl = it.sourceUrl || it.url || null;
        outputs.push({
          typeId: composed.typeId || 'FOOTBALL_MULTI_AND',
          bookie:(it.bookie||bookKey||'').toLowerCase(),
          sport: it.sportHint || 'Football',
          text: composed.text || titleOriginal,
          textOriginal: composed.textOriginal || titleOriginal,
          marketingPrefix: composed.marketingPrefix || '',
          boostedOddsFrac, boostedOddsDec,
          sourceUrl: srcUrl,
          legs: (Array.isArray(composed.legs)? composed.legs: []).map(L=>({ team:L.team, kind:L.kind }))
        });
        outCount++;
        if (debug) console.log('[emit:FOOTBALL_MULTI_AND.detector]', JSON.stringify({legs:(composed.legs||[]).length, title: titleOriginal}));
        continue;
      }

      const hits=[];
      for(const typeId of ordered){
        const T=byId.get(typeId);
        if(!T?.rec) continue;
        const { text: titleForMatch, marketingPrefix } = stripPrefix(titleOriginal, T.rec?.marketingPrefixPattern);
        if(!passesRecognisers(titleForMatch, T.rec)) continue;
        const ex = await classifySafe(T.extractor, titleForMatch, { bookKey, typeId });
        if(ex && (ex.match===true || (typeof ex.match==='number' && ex.match>0))){
          const legs = Array.isArray(ex.legs)? ex.legs : [];
          if(legs.length){
            hits.push({ typeId, legs, marketingPrefix: marketingPrefix||'' });
            if (debug) console.log(`[hit:${typeId}] legs=${legs.length} |`, preview(titleOriginal));
          }
        }
      }

      // De-dupe equivalences:
      if (hits.some(h => h.typeId === 'FOOTBALL_TEAM_WIN')) {
        for (let i = hits.length - 1; i >= 0; i--) if (hits[i].typeId === 'ALL_TO_WIN') hits.splice(i, 1);
      }
      if (hits.some(h => h.typeId === 'FOOTBALL_SGM_MO_BTTS')) {
        for (let i = hits.length - 1; i >= 0; i--) if (hits[i].typeId === 'WIN_AND_BTTS') hits.splice(i, 1);
      }

      if(hits.length===0) {
        if(debug) console.log('[skip:type]', preview(titleOriginal));
        continue;
      }

      if (MODE==='on' && hits.length>1){
        const prefix = hits.find(h=>h.marketingPrefix)?.marketingPrefix || '';
        const legs = deDupeLegs(flattenToContainerLegs(hits));
        outputs.push({
          typeId: 'FOOTBALL_MULTI_AND',
          bookie:(it.bookie||bookKey||'').toLowerCase(),
          sport: it.sportHint || 'Football',
          text: titleOriginal,
          textOriginal: titleOriginal,
          marketingPrefix: prefix,
          boostedOddsFrac, boostedOddsDec,
          sourceUrl: it.sourceUrl || it.url || null,
          legs
        });
        outCount++;
        if (debug) console.log('[emit:FOOTBALL_MULTI_AND]', JSON.stringify({legs: legs.length, title: titleOriginal}));
        continue;
      }

      const first = hits[0];
      outputs.push({
        typeId: first.typeId,
        bookie:(it.bookie||bookKey||'').toLowerCase(),
        sport: it.sportHint || 'Football',
        text: titleOriginal,
        textOriginal: titleOriginal,
        marketingPrefix: first.marketingPrefix,
        boostedOddsFrac, boostedOddsDec,
        sourceUrl: it.sourceUrl || it.url || null,
        legs: first.legs.map(t=>({ team:t }))
      });
      outCount++;
      if (debug) console.log(`[emit:${first.typeId}] legs=${first.legs.length} |`, preview(titleOriginal));
    }

    const outPath = inPath.replace(/\.rawoffers\.json$/i, '.offers.json');
    await fs.writeFile(outPath, JSON.stringify({ offers: outputs }, null, 2), 'utf8');
    console.log(`[classify:${bookKey}] in=${inCount} out=${outCount}`);
    console.log(`[classify:${bookKey}] wrote -> ${outPath}`);

  } catch (e) {
    console.error('[classify] failed:', e?.stack || e?.message || e);
    process.exit(1);
  }
})();

// ---- helpers ----
async function readJson(p){
  const t=await fs.readFile(p,'utf8');
  try{ return JSON.parse(t) }catch{ throw new Error(`Malformed JSON: ${p}`) }
}

async function findLatestRawOffers(bookKey){
  const root=path.resolve(__dirname,'..','snapshots',bookKey);
  if (!fss.existsSync(root)) return null;
  let latest=null;
  async function walk(d){
    let ents;
    try{ ents=await fs.readdir(d,{withFileTypes:true}) }catch{ return }
    for(const e of ents){
      const p=path.join(d,e.name);
      if(e.isDirectory()) await walk(p);
      else if(/\.rawoffers\.json$/i.test(e.name)){
        const st=await fs.stat(p);
        if(!latest||st.mtimeMs>latest.mtimeMs) latest={path:p,mtimeMs:st.mtimeMs};
      }
    }
  }
  await walk(root);
  return latest?.path||null;
}

async function loadRegistryFallback(){
  const p=path.resolve(__dirname,'..','bettypes','registry.json');
  try{
    const j=JSON.parse(await fs.readFile(p,'utf8'));
    return Array.isArray(j)&&j.length? j : ['ALL_TO_WIN'];
  }catch{ return ['ALL_TO_WIN']; }
}

async function loadRecognisers(typeId, bookKey){
  const baseDir=path.resolve(__dirname,'..','bettypes',typeId);
  const recPath=path.join(baseDir,'recognisers.json');
  let pos=[],neg=[],marketingPrefixPattern=null;
  if(fss.existsSync(recPath)){
    try{
      const j=JSON.parse(await fs.readFile(recPath,'utf8'));
      pos=Array.isArray(j.positive)?j.positive:[];
      neg=Array.isArray(j.negative)?j.negative:[];
      if(typeof j.marketingPrefixPattern==='string') marketingPrefixPattern=j.marketingPrefixPattern;
    }catch{}
  }
  const overlayDir=path.join(baseDir,'overlays');
  const overlayPaths=[
    path.join(overlayDir, `${bookKey}.json`),
    path.join(overlayDir, `${bookKey}.recognisers.json`)
  ];
  for(const op of overlayPaths){
    if(!fss.existsSync(op)) continue;
    try{
      const j=JSON.parse(await fs.readFile(op,'utf8'));
      if(Array.isArray(j.positive)) pos.push(...j.positive);
      if(Array.isArray(j.negative)) neg.push(...j.negative);
      if(typeof j.marketingPrefixPattern==='string' && !marketingPrefixPattern) marketingPrefixPattern=j.marketingPrefixPattern;
    }catch{}
  }
  return { positive: pos.map(toI), negative: neg.map(toI), marketingPrefixPattern };
}

async function loadExtractor(typeId){
  const p=path.resolve(__dirname,'..','bettypes',typeId,'extractor.js');
  if(!fss.existsSync(p)) return null;
  const mod=await import(pathToFileURL(p).href);
  return mod.default||mod;
}

function toI(s){
  try{ return new RegExp(s,'i') }
  catch{ return new RegExp(String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i') }
}

function passesRecognisers(text, rec){
  const t=String(text||'').replace(/\s+/g, ' ').trim();
  const pos=rec.positive?.some(rx=>rx.test(t));
  if(!pos) return false;
  const neg=rec.negative?.some(rx=>rx.test(t));
  return !neg;
}

function stripPrefix(s, pattern){
  if(!pattern) return { text:s, marketingPrefix:'' };
  try{
    const rx=new RegExp(pattern,'i');
    const m=String(s||'').match(rx);
    if(!m) return { text:s, marketingPrefix:'' };
    const full=m[0]||'';
    return { text: String(s||'').slice(full.length), marketingPrefix:full };
  }catch{
    return { text:s, marketingPrefix:'' };
  }
}

function classifySafe(extractor, title, ctx){
  try{ return extractor?.classify? extractor.classify(title, ctx) : null }
  catch { return null }
}

function preview(t){
  const s=String(t||'').trim();
  return s.length>100? s.slice(0,97)+'…':s;
}

function flattenToContainerLegs(hits){
  const out = [];
  for (const h of hits){
    const typeId = h.typeId;
    const legs = Array.isArray(h.legs) ? h.legs : [];
    if (typeId === 'ALL_TO_WIN' || typeId === 'FOOTBALL_TEAM_WIN'){
      for (const team of legs) out.push({ kind:'FOOTBALL_TEAM_WIN', params:{ team } });
    } else if (typeId === 'WIN_AND_BTTS' || typeId === 'FOOTBALL_SGM_MO_BTTS'){
      for (const team of legs) out.push({ kind:'FOOTBALL_SGM_MO_BTTS', params:{ team } });
    } else if (typeId === 'FOOTBALL_WIN_TO_NIL'){
      for (const team of legs) out.push({ kind:'FOOTBALL_WIN_TO_NIL', params:{ team } });
    } else if (typeId === 'FOOTBALL_TEAM_TO_DRAW' || typeId === 'MO_DRAW'){
      for (const team of legs) out.push({ kind:'MO_DRAW', params:{ team } });
    } else {
      if (legs.length) for (const team of legs) out.push({ kind:typeId, params:{ team } });
      else out.push({ kind:typeId, params:{ team:'' } });
    }
  }
  return out;
}

function deDupeLegs(legs){
  const seen = new Set();
  const out = [];
  for (const L of legs){
    const key = `${L.kind}|${(L.params?.team||'').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(L);
  }
  return out;
}
