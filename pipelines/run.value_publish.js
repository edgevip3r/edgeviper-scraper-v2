// pipelines/run.value_publish.js
// Type-routed value + publish:
// - loads latest *.offers.json (or --in)
// - groups by typeId, dynamically imports bettypes/<TYPE>/{mapper,pricer}.js
// - maps all offers to Betfair marketIds, fetches books once, prices via type pricer
// - filters/dedupes, writes to Bet Tracker, logs skips
//
// Usage:
//   node pipelines/run.value_publish.js --book=<alias|canonical> [--in=...offers.json]
//     [--debug] [--dry-run] [--enforce] [--threshold=1.05] [--persist]

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import crypto from 'crypto';
import { format } from 'date-fns';
import config from '../config/global.json' with { type: 'json' };
import { resolveBookKey } from '../lib/books/resolveBook.js';
import { listMarketBook } from '../lib/betfair/client.js';
import { publishRows } from '../lib/publish/sheets.bettracker.js';
import { google } from 'googleapis';
import { skipLogInit, skipLogWrite, skipLogFlush } from '../lib/log/skiplog.js';

function args(argv){const o={};for(const a of argv.slice(2)){const m=a.match(/^--([^=]+)(?:=(.*))?$/);if(m)o[m[1]]=m[2]??true}return o}
const a = args(process.argv);
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const inPathArg  = a.in ? path.resolve(a.in) : null;
const rawBook    = (a.book || '').toString();
const debug      = !!a.debug || a.debug === '' || a.debug === 'true';
const dryRun     = !!a['dry-run'] || a['dry-run'] === '' || a['dry-run'] === 'true';
const enforce    = !!a.enforce || a.enforce === '' || a.enforce === 'true';
const persist    = !!a.persist || a.persist === '' || a.persist === 'true';
const thresholdArg = a.threshold ? Number(a.threshold) : null;

const THRESHOLD   = Number.isFinite(thresholdArg) ? thresholdArg : (config.filters?.threshold ?? 1.05);
const MIN_LIQ     = config.filters?.minLiquidity ?? 20;
const MAX_SPREAD  = config.filters?.maxSpreadPct ?? 20;
const SHEET_ID    = process.env.BET_TRACKER_SHEET_ID;
const TAB         = config.posting?.sheetTab || 'Bet Tracker';
if (!SHEET_ID) { console.error('BET_TRACKER_SHEET_ID is not set.'); process.exit(1); }
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set (service-account JSON path).'); process.exit(1);
}

const DISPLAY_NAME = { williamhill: 'William Hill', pricedup: 'PricedUp' };

// ---------- small utils ----------
function toNum(x){if(x==null||x==='')return null;const n=Number(x);return Number.isFinite(n)?n:null}
function fmtNum(x){if(x==null)return'n/a';if(!Number.isFinite(Number(x)))return String(x);return Number(x).toFixed(3)}
function latestKoIso(legs=[]){const t=legs.map(l=>l.koIso?Date.parse(l.koIso):NaN).filter(Number.isFinite);return t.length?new Date(Math.max(...t)).toISOString():null}
function fmtUKDateTime(iso){if(!iso)return'';const d=new Date(iso);return d.toLocaleString('en-GB',{timeZone:'Europe/London',hour12:false})}
function fmtUKDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // Date only, Europe/London
  return d.toLocaleDateString('en-GB', { timeZone: 'Europe/London' });
}
// --- per-bettype overrides loader (threshold / minLiquidity / maxSpreadPct) ---
function loadTypeRules(typeId) {
  try {
    if (!typeId) return {};
    const p = path.resolve(__dirname, '..', 'bettypes', typeId, 'price.rules.json');
    if (!fss.existsSync(p)) return {};
    const j = JSON.parse(fss.readFileSync(p, 'utf8'));
    return (j && typeof j === 'object' && j.overrides && typeof j.overrides === 'object') ? j.overrides : {};
  } catch {
    return {};
  }
}
function makeUidLoose({ typeId, bookie, text }){const day=format(new Date(),'yyyy-MM-dd');const basis=`${typeId}|${bookie}|${text}|${day}`.toLowerCase();return crypto.createHash('sha1').update(basis).digest('hex')}
async function listExistingUIDs(sheetId, tab){
  const auth=new google.auth.GoogleAuth({scopes:['https://www.googleapis.com/auth/spreadsheets.readonly']});
  const sheets=google.sheets({version:'v4',auth});
  const res=await sheets.spreadsheets.values.get({spreadsheetId:sheetId,range:`${tab}!AA:AA`}).catch(()=>null);
  const values=res?.data?.values||[];const set=new Set();for(const row of values){const v=(row&&row[0]!=null)?String(row[0]).trim():'';if(v)set.add(v)}return set;
}
async function readJsonOrExplain(file){
  const text=await fs.readFile(file,'utf8').catch(()=>null);
  if(text==null)throw new Error(`Cannot read file: ${file}`);
  try{return JSON.parse(text)}catch{const st=await fs.stat(file).catch(()=>null);const size=st?.size??'unknown';throw new Error(`Malformed JSON in ${file} (size=${size} bytes)`) }
}
async function findLatestOffers(bookKey){
  const root=path.resolve(__dirname,'..','snapshots',bookKey);
  let latest=null; async function walk(dir){let ents;try{ents=await fs.readdir(dir,{withFileTypes:true})}catch{return}
    for(const e of ents){const p=path.join(dir,e.name);
      if(e.isDirectory())await walk(p);
      else if(e.isFile()&&/\.offers\.json$/i.test(e.name)){const st=await fs.stat(p);if(!latest||st.mtimeMs>latest.mtimeMs)latest={path:p,mtimeMs:st.mtimeMs}}}}
  await walk(root); return latest?.path||null;
}
function rel(p){try{return path.relative(path.resolve(__dirname,'..'),p)}catch{return p}}
function pascal(s){return String(s||'').split(/[^a-z0-9]+/i).filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join('')}
async function loadTypeModule(typeId, file){ // file = 'mapper' | 'pricer'
  const modPath = path.resolve(__dirname,'..','bettypes',typeId,`${file}.js`);
  if(!fss.existsSync(modPath)) throw new Error(`Missing type module: bettypes/${typeId}/${file}.js`);
  const mod = await import(pathToFileURL(modPath).href);
  // tolerate default or named export
  return mod.default || mod[file] || mod[`${file}${pascal(typeId)}`] || mod;
}

// ---------- main ----------
(async () => {
  try {
    if (!rawBook && !inPathArg) { console.error('[value+publish] Provide --book=<key> or --in=<offers.json>.'); process.exit(1); }

    // Resolve book (for latest-offers lookup, display name)
    let canonical = null;
    if (rawBook) {
      const r = await resolveBookKey(rawBook);
      canonical = r.canonical;
    } else {
      const m = inPathArg.match(/[\\\/]snapshots[\\\/]([^\\\/]+)[\\\/]/i);
      canonical = m?.[1] || null;
      if (!canonical) throw new Error('Cannot infer book key from --in path.');
    }

    const offersPath = inPathArg || await findLatestOffers(canonical);
    if (!offersPath) { console.error('[value+publish] No .offers.json found. Provide --in=... or run classify first.'); process.exit(1); }

    const data = await readJsonOrExplain(offersPath);
    const allOffers = Array.isArray(data.offers) ? data.offers : [];
    if (debug) console.log(`[value+publish] using ${rel(offersPath)} with ${allOffers.length} offers | book=${canonical}`);

    // Init skip log
    await skipLogInit({ sheetId: process.env.SKIPPED_SHEET_ID || SHEET_ID, tab: 'Skipped' });

    // ---- GROUP BY TYPE & MAP ----
    const byType = new Map();
    for (const o of allOffers) {
      if (!o?.typeId) continue;
      if (!byType.has(o.typeId)) byType.set(o.typeId, []);
      byType.get(o.typeId).push(o);
    }
    if (byType.size === 0) { console.log('[value+publish] nothing to process.'); process.exit(0); }

    // map results per offer index
    const mappedForOffer = new Map(); // offer -> { mapped, unmatched }
    const marketIdSet    = new Set();

    for (const [typeId, offers] of byType.entries()) {
      // dynamic mapper
      const mapper = await loadTypeModule(typeId, 'mapper');
      for (const o of offers) {
        const res = await mapper.map(o, { debug, bookie: canonical });
        mappedForOffer.set(o, res);
        for (const m of res.mapped || []) if (m.marketId) marketIdSet.add(m.marketId);

        // log unmatched
        for (const u of (res.unmatched || [])) {
          skipLogWrite({
            stage: 'map', bookie: DISPLAY_NAME[canonical] || canonical, typeHint: typeId,
            reasonCode: u.reason || 'UNMATCHED', reasonDetail: u.triedName ? `tried="${u.triedName}"` : '',
            actionable: 'yes',
            sourceUrl: o.sourceUrl || '', snapshotRef: offersPath,
            textRaw: o.textOriginal || o.text || '', oddsRaw: o.boostedOddsFrac || '',
            textClean: (o.text || '').trim(), legsExtracted: (o.legs || []).map(L=>L.team||'').join(' | '),
            mapDebug: JSON.stringify(u).slice(0,500), uidOffer: makeUidLoose({ typeId:o.typeId, bookie:canonical, text:o.text||'' }), uidSource: ''
          });
        }

        if (debug) {
          const unmatchedStr = (res.unmatched||[]).map(x => `${x.team}:${x.reason}`).join(' | ') || 'none';
          console.log(`[map:${typeId}] "${o.text}" -> mapped=${(res.mapped||[]).length}/${(o.legs||[]).length}; unmatched: ${unmatchedStr}`);
        }
      }
    }

    // ---- FETCH MARKET BOOKS ONCE ----
    const marketIds = Array.from(marketIdSet);
    if (debug) console.log(`[price] fetching market books for ${marketIds.length} markets`);
    const books = [];
    const batchSize = 200;
    for (let i = 0; i < marketIds.length; i += batchSize) {
      const slice = marketIds.slice(i, i + batchSize);
      if (!slice.length) continue;
      const pageBooks = await listMarketBook(slice, { priceData: ['EX_BEST_OFFERS'] });
      books.push(...(pageBooks || []));
    }
    if (debug) console.log(`[price] fetched ${books.length} market books`);

    // ---- PRICE PER TYPE ----
    const pricedOffers = [];
    for (const [typeId, offers] of byType.entries()) {
      const pricer = await loadTypeModule(typeId, 'pricer');

      for (const o of offers) {
        const mapRes = mappedForOffer.get(o) || { mapped: [], unmatched: [] };

        // price via type pricer
        const priced = await pricer.price({ offer: o, mappedLegs: mapRes.mapped || [], books }, { debug, bookie: canonical });

        // Compose final record
        const out = {
          ...o,
          legs: priced.pricedLegs || o.legs || [],
          fairOddsDec: priced.fairOddsDec ?? null,
          diagnostics: priced.diagnostics || {}
        };

        // DEBUG line
        if (debug) {
          const midsStr = (priced.pricedLegs||[]).map(L => (L?.pricing?.mid!=null ? Number(L.pricing.mid).toFixed(3) : 'n/a')).join(' | ');
          const rating = (toNum(o.boostedOddsDec) && toNum(out.fairOddsDec)) ? (toNum(o.boostedOddsDec)/toNum(out.fairOddsDec)) : null;
          console.log(`[offer:${typeId}] ${o.text} | boosted=${fmtNum(o.boostedOddsDec)} | mids=[ ${midsStr} ] | fair=${fmtNum(out.fairOddsDec)} | rating=${rating?(rating*100).toFixed(2)+'%':'n/a'}`);
        }

        pricedOffers.push(out);
      }
    }

    if (persist) {
      const base = offersPath.replace(/\.offers\.json$/i, '');
      const pricedOutPath = base + '.priced.json';
      await fs.writeFile(pricedOutPath, JSON.stringify({ offers: pricedOffers }, null, 2), 'utf8');
      if (debug) console.log(`[persist] wrote -> ${rel(pricedOutPath)}`);
    }

    // ---- DEDUPE + FILTER + PUBLISH ----
    const existingUIDs = await listExistingUIDs(SHEET_ID, TAB);
    if (debug) console.log(`[dedupe] existing UIDs on "${TAB}": ${existingUIDs.size}`);

    const today = format(new Date(), 'dd/MM/yyyy');
    let posted=0, dupSkipped=0, belowThreshold=0, liqSkipped=0, spreadSkipped=0, unpriced=0;

    const rows = [];
    for (const o of pricedOffers) {
      const betText = o.textOriginal || o.text || '';
      const typeId  = o.typeId || 'UNKNOWN';
      const bookieCol = DISPLAY_NAME[canonical] || canonical;

      const uid = makeUidLoose({ typeId, bookie: bookieCol, text: betText });
      const boosted = toNum(o.boostedOddsDec);
      const fair    = toNum(o.fairOddsDec);
      const rating  = (boosted && fair) ? boosted / fair : null;

      const legs = Array.isArray(o.legs) ? o.legs : [];
      const liqs = legs.map(L => Number.isFinite(L?.pricing?.liq) ? L.pricing.liq : 0);
      const minLiquidity = liqs.length ? Math.min(...liqs) : 0;
      const spreads = legs.map(L => Number.isFinite(L?.pricing?.spreadPct) ? L.pricing.spreadPct : null).filter(x => x != null);
      const maxSpreadPct = spreads.length ? Math.max(...spreads) : null;

		const ovr = loadTypeRules(typeId); // { threshold?, minLiquidity?, maxSpreadPct? }
		const effThreshold = Number.isFinite(+ovr.threshold)    ? +ovr.threshold    : THRESHOLD;
		const effMinLiq    = Number.isFinite(+ovr.minLiquidity) ? +ovr.minLiquidity : MIN_LIQ;
		const effMaxSpread = Number.isFinite(+ovr.maxSpreadPct) ? +ovr.maxSpreadPct : MAX_SPREAD;

		const minLiqNum    = Number(minLiquidity) || 0;
		const maxSpreadNum = (maxSpreadPct == null ? null : Number(maxSpreadPct));

		const isDup    = existingUIDs.has(uid);
		const threshOk = (rating != null) && (rating >= effThreshold);
		const liqOk    = minLiqNum >= effMinLiq;
		const spreadOk = (maxSpreadNum == null) || (maxSpreadNum <= effMaxSpread);

      if (debug) {
        console.log(
          `[decide:${typeId}] ${betText} | boosted=${fmtNum(boosted)} | fair=${fmtNum(fair)} | rating=${rating?(rating*100).toFixed(2)+'%':'n/a'} | ` +
          `liqMin=${minLiquidity} | spreadMax=${maxSpreadPct!=null?maxSpreadPct.toFixed(1)+'%':'n/a'} | ` +
          (isDup ? 'skip dedupe' :
            (enforce && rating==null) ? 'skip unpriced' :
            (enforce && !threshOk)    ? `skip < threshold ${THRESHOLD}` :
            (enforce && !liqOk)       ? `skip < minLiquidity ${MIN_LIQ}` :
            (enforce && !spreadOk)    ? `skip > maxSpreadPct ${MAX_SPREAD}` : 'post')
        );
      }

      if (isDup) { dupSkipped++; skipLogWrite({stage:'dedupe',bookie:bookieCol,typeHint:typeId,reasonCode:'DUPLICATE',reasonDetail:uid,actionable:'no',sourceUrl:o.sourceUrl||'',snapshotRef:offersPath,textRaw:betText,oddsRaw:o.boostedOddsFrac||'',textClean:betText,legsExtracted:legs.map(L=>L.team||'').join(' | '),mapDebug:'',uidOffer:uid,uidSource:'sheet:AA'}); continue; }
      if (enforce && rating==null){ unpriced++; skipLogWrite({stage:'filter',bookie:bookieCol,typeHint:typeId,reasonCode:'UNPRICED',reasonDetail:'one or more legs had no mid',actionable:'yes',sourceUrl:o.sourceUrl||'',snapshotRef:offersPath,textRaw:betText,oddsRaw:o.boostedOddsFrac||'',textClean:betText,legsExtracted:legs.map(L=>L.team||'').join(' | '),mapDebug:JSON.stringify(legs.map(L=>({team:L.team,mid:L?.pricing?.mid}))).slice(0,300),uidOffer:uid,uidSource:''}); continue; }
      if (enforce && !threshOk){ belowThreshold++; skipLogWrite({stage:'filter',bookie:bookieCol,typeHint:typeId,reasonCode:'BELOW_THRESHOLD',reasonDetail:`rating=${(rating*100||0).toFixed(2)}% < ${(THRESHOLD*100).toFixed(0)}%`,actionable:'no',sourceUrl:o.sourceUrl||'',snapshotRef:offersPath,textRaw:betText,oddsRaw:o.boostedOddsFrac||'',textClean:betText,legsExtracted:legs.map(L=>L.team||'').join(' | '),mapDebug:'',uidOffer:uid,uidSource:''}); continue; }
      if (enforce && !liqOk){ liqSkipped++; skipLogWrite({stage:'filter',bookie:bookieCol,typeHint:typeId,reasonCode:'LOW_LIQUIDITY',reasonDetail:`minLiq=${minLiquidity} < ${MIN_LIQ}`,actionable:'maybe',sourceUrl:o.sourceUrl||'',snapshotRef:offersPath,textRaw:betText,oddsRaw:o.boostedOddsFrac||'',textClean:betText,legsExtracted:legs.map(L=>L.team||'').join(' | '),mapDebug:'',uidOffer:uid,uidSource:''}); continue; }
      if (enforce && !spreadOk){ spreadSkipped++; skipLogWrite({stage:'filter',bookie:bookieCol,typeHint:typeId,reasonCode:'WIDE_SPREAD',reasonDetail:`maxSpread=${(maxSpreadPct||0).toFixed(1)}% > ${MAX_SPREAD}%`,actionable:'maybe',sourceUrl:o.sourceUrl||'',snapshotRef:offersPath,textRaw:betText,oddsRaw:o.boostedOddsFrac||'',textClean:betText,legsExtracted:legs.map(L=>L.team||'').join(' | '),mapDebug:'',uidOffer:uid,uidSource:''}); continue; }

      const sport = o.sport || 'Football';
      const event = (legs.length <= 1) ? (legs[0]?.label || 'Single') : 'Multi';
      const settleDate = fmtUKDate(latestKoIso(legs));
      const url = o.sourceUrl || '';
      const colL = config.posting?.prefillP ? 'P' : '';

      rows.push([
        today,     // A Date
        '',        // B
        bookieCol, // C
        sport,     // D
        event,     // E
        betText,   // F
        settleDate,// G
        boosted ?? '', // H Odds
        fair ?? '',    // I Fair
        '', '',        // J,K
        colL,          // L ("P")
        '',            // M
        url,           // N
        '', '', '', '', '', '', '', '', '', '', '', // O..Z placeholders
        uid            // AA
      ]);
      posted++;
    }

    const res = await publishRows(rows, { sheetId: SHEET_ID, tab: TAB, dryRun });
    await skipLogFlush({ dryRun });

    console.log('[value+publish]', JSON.stringify({
      offersIn: allOffers.length,
      posted, dupSkipped, belowThreshold, liqSkipped, spreadSkipped, unpriced,
      threshold: THRESHOLD, minLiquidity: MIN_LIQ, maxSpreadPct: MAX_SPREAD,
      enforced: !!enforce, dryRun: !!dryRun, sheetTab: TAB,
      updatedRange: res.updatedRange || null
    }, null, 2));
  } catch (err) {
    console.error('[value+publish] failed:', err?.message || err);
    process.exit(1);
  }
})();