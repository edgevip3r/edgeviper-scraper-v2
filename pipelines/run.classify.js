// pipelines/run.classify.js
// Classify RawOffer[] -> typed offers using plugin-based bet types.
//
// Usage:
//   node pipelines/run.classify.js --book=<alias|canonical> [--in=...rawoffers.json] [--debug]
//
// Output: writes alongside input: *.offers.json

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import cfg from '../config/global.json' with { type: 'json' };
import { resolveBookKey } from '../lib/books/resolveBook.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

function loadBookCfg(bookKey) {
  try {
    const p = path.resolve(__dirname, '..', 'data', 'bookmakers', `${bookKey}.json`);
    return JSON.parse(fss.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function args(argv){const o={};for(const a of argv.slice(2)){const m=a.match(/^--([^=]+?)(?:=(.*))?$/);if(m)o[m[1]]=m[2]??true}return o}
const a = args(process.argv);
const debug = a.debug === '' || a.debug === true || a.debug === 'true';
const fileArg = a.in ? path.resolve(a.in) : null;

(async () => {
  try {
    if (!a.book && !fileArg) {
      // dynamic hint (no hard-coded book names)
      let detected = [];
      try {
        const dir = path.resolve(__dirname, '..', 'bookmakers');
        detected = fss.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
      } catch {}
      const hint = detected.length ? `  Available: ${detected.join(', ')}` : '';
      console.error('Usage: node pipelines/run.classify.js --book=<bookKey> [--in=...rawoffers.json] [--debug]');
      if (hint) console.error(hint);
      process.exit(1);
    }

    // Resolve book key (or infer from --in path)
    let bookKey;
    if (a.book) {
      const { canonical } = await resolveBookKey(String(a.book));
      bookKey = canonical;
    } else {
      const m = fileArg.match(/[\\\/]snapshots[\\\/]([^\\\/]+)[\\\/]/i);
      if (!m) throw new Error('Cannot infer --book from --in path.');
      bookKey = m[1];
    }

    const _bookCfg = loadBookCfg(bookKey);
    const _baseUrlFallback = (_bookCfg?.baseUrls && _bookCfg.baseUrls[0]) || null;

    // Locate input
    const inPath = fileArg || await findLatestRawOffers(bookKey);
    if (!inPath) {
      console.error(`[classify:${bookKey}] no *.rawoffers.json found. Provide --in or run parse first.`);
      process.exit(1);
    }

    // Load raw items (accept several shapes)
    const raw = await readJson(inPath);
    const items =
      Array.isArray(raw.rawOffers) ? raw.rawOffers :
      Array.isArray(raw.offers)    ? raw.offers :
      Array.isArray(raw.raw)       ? raw.raw :
      [];

    // Load registry (from config or file)
    const registry = Array.isArray(cfg?.bettypes?.registry) && cfg.bettypes.registry.length
      ? cfg.bettypes.registry
      : await loadRegistryFallback();

    // Pre-load recognisers + extractors per type
    const types = await Promise.all(registry.map(async (typeId) => {
      const rec = await loadRecognisers(typeId, bookKey);
      const extractor = await loadExtractor(typeId);
      return { typeId, rec, extractor };
    }));

    let inCount = 0, outCount = 0;
    const typed = [];

    for (const it of items) {
      const title = String(it.text || it.title || '').trim();
      const { frac, dec } = getOdds(it);
      if (!title || dec == null) { if (debug) console.log('[skip:pre]', !title?'no-text':'no-odds', '|', preview(title)); continue; }
      inCount++;

      let matched = null;
      for (const T of types) {
        if (!T.rec) continue;
        if (!passesRecognisers(title, T.rec)) continue;

        // Extract legs via type extractor (or fallback)
        const extractor = T.extractor || fallbackExtractor(T.typeId);
        const ex = await extractor.classify(title, { bookKey, typeId: T.typeId, debug });
        if (ex && (ex.match === true || (typeof ex.match === 'number' && ex.match > 0))) {
          const legs = Array.isArray(ex.legs) ? ex.legs : [];
          if (legs.length === 0 && debug) console.log('[skip:legs=0]', T.typeId, '|', preview(title));
          else {
            const srcUrl =
              it.sourceUrl ||
              it.url ||
              _baseUrlFallback ||
              null;

            matched = {
              typeId: T.typeId,
              legs,
              text: title,
              textOriginal: it.textOriginal || title,
              boostedOddsFrac: it.boostedOddsFrac ?? it.oddsRaw ?? null,
              boostedOddsDec:  it.boostedOddsDec  ?? it.oddsDec ?? null,
              sourceUrl: srcUrl,
              sport: it.sportHint || 'Football',
              bookie: (it.bookie || bookKey || '').toLowerCase()
            };
          }
        }
        if (matched) break; // first hit wins
      }

      if (!matched) { if (debug) console.log('[skip:type]', preview(title)); continue; }

      typed.push({
        typeId: matched.typeId,
        bookie: matched.bookie,
        sport: matched.sport,
        text: matched.text,
        textOriginal: matched.textOriginal,
        boostedOddsFrac: matched.boostedOddsFrac,
        boostedOddsDec: matched.boostedOddsDec,
        sourceUrl: matched.sourceUrl,
        legs: matched.legs.map(t => ({ team: t }))
      });
      outCount++;
      if (debug) console.log(`[ok:${matched.typeId}] legs=${matched.legs.length} | odds=${matched.boostedOddsFrac}(${matched.boostedOddsDec}) |`, preview(matched.text));
    }

    const outPath = inPath.replace(/\.rawoffers\.json$/i, '.offers.json');
    await fs.writeFile(outPath, JSON.stringify({ offers: typed }, null, 2), 'utf8');

    console.log(`[classify:${bookKey}] in=${inCount} out=${outCount}`);
    console.log(`[classify:${bookKey}] wrote -> ${outPath}`);
  } catch (err) {
    console.error('[classify] failed:', err?.message || err);
    process.exit(1);
  }
})();

// ---------- helpers ----------

async function readJson(p){const t=await fs.readFile(p,'utf8');try{return JSON.parse(t)}catch{throw new Error(`Malformed JSON: ${p}`)}}

async function findLatestRawOffers(bookKey){
  const root = path.resolve(__dirname,'..','snapshots',bookKey);
  let latest=null;
  async function walk(d){let ents;try{ents=await fs.readdir(d,{withFileTypes:true})}catch{return}
    for(const e of ents){const p=path.join(d,e.name);
      if(e.isDirectory()) await walk(p);
      else if(e.isFile() && /\.rawoffers\.json$/i.test(e.name)){const st=await fs.stat(p); if(!latest||st.mtimeMs>latest.mtimeMs) latest={path:p,mtimeMs:st.mtimeMs}}
    }}
  await walk(root);
  return latest?.path||null;
}

async function loadRegistryFallback(){
  const p = path.resolve(__dirname,'..','bettypes','registry.json');
  if (!fss.existsSync(p)) return ['ALL_TO_WIN'];
  try { const j = JSON.parse(await fs.readFile(p,'utf8')); return Array.isArray(j)&&j.length? j : ['ALL_TO_WIN']; }
  catch { return ['ALL_TO_WIN']; }
}

async function loadRecognisers(typeId, bookKey){
  // central recognisers
  const baseDir = path.resolve(__dirname,'..','bettypes',typeId);
  const recPath = path.join(baseDir,'recognisers.json');
  let pos=[],neg=[];
  if (fss.existsSync(recPath)) {
    try {
      const j = JSON.parse(await fs.readFile(recPath,'utf8'));
      pos = Array.isArray(j.positive)? j.positive: [];
      neg = Array.isArray(j.negative)? j.negative: [];
    } catch {}
  } else if (typeId==='ALL_TO_WIN') {
    // default safety net
    pos=['all to win','both to win','double','treble','fourfold','to win$','wins$'];
    neg=['both teams to score','btts','over \\d+\\.5'];
  }
  // per-book overlay
  const overlayPath = path.join(baseDir,'overlays',`${bookKey}.json`);
  if (fss.existsSync(overlayPath)) {
    try {
      const j = JSON.parse(await fs.readFile(overlayPath,'utf8'));
      if (Array.isArray(j.positive)) pos.push(...j.positive);
      if (Array.isArray(j.negative)) neg.push(...j.negative);
    } catch {}
  }
  return {
    positive: pos.map(toRegexI),
    negative: neg.map(toRegexI)
  };
}

async function loadExtractor(typeId){
  const modPath = path.resolve(__dirname,'..','bettypes',typeId,'extractor.js');
  if (!fss.existsSync(modPath)) return null;
  const mod = await import(pathToFileURL(modPath).href);
  return mod.default || mod;
  function pathToFileURL(p){ return new URL('file://'+p.replace(/\\/g,'/')); }
}

function toRegexI(s){try{return new RegExp(s,'i')}catch{return new RegExp(escapeRegExp(String(s)),'i')}}
function escapeRegExp(s){return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}

function passesRecognisers(text, rec){
  const t = norm(text);
  const pos = rec.positive?.some(rx=>rx.test(t));
  if (!pos) return false;
  const neg = rec.negative?.some(rx=>rx.test(t));
  return !neg;
}

function norm(s){
  // keep '&' as-is so recognisers can match either '&' or 'and' explicitly
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function getOdds(it){
  const frac = it.boostedOddsFrac ?? it.oddsRaw ?? it.odds ?? null;
  let dec = it.boostedOddsDec ?? it.oddsDec ?? null;
  if (dec != null && !Number.isFinite(dec)) dec = null;
  return { frac, dec };
}

function preview(t){const s=String(t||'').trim();return s.length>100? s.slice(0,97)+'…' : s}