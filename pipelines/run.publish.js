// pipelines/run.publish.js
// Publishes *.offers.json to Bet Tracker (A..AA), with debug and de-dupe vs column AA.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { format } from 'date-fns';
import config from '../config/global.json' with { type: 'json' };
import { publishRows } from '../lib/publish/sheets.bettracker.js';
import { google } from 'googleapis';

function args(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const a = args(process.argv);
const inPathArg = a.in ? path.resolve(a.in) : null;
const bookHint = (a.book || '').toLowerCase();
const debug = !!a.debug || a.debug === '' || a.debug === 'true';
const dryRun = !!a['dry-run'] || a['dry-run'] === '' || a['dry-run'] === 'true';
const enforce = !!a.enforce || a.enforce === '' || a.enforce === 'true';
const thresholdArg = a.threshold ? Number(a.threshold) : null;

if (!process.env.BET_TRACKER_SHEET_ID) {
  console.error('BET_TRACKER_SHEET_ID is not set.');
  process.exit(1);
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('GOOGLE_APPLICATION_CREDENTIALS is not set (service-account JSON path).');
  process.exit(1);
}

const SHEET_ID = process.env.BET_TRACKER_SHEET_ID;
const TAB = config.posting?.sheetTab || 'Bet Tracker';
const THRESHOLD = thresholdArg ?? (config.filters?.threshold ?? 1.05);
const BOOK_NAME_MAP = { williamhill: 'William Hill', pricedup: 'PricedUp' };

try {
  const offersPath = inPathArg || await findLatestOffers(bookHint);
  if (!offersPath) {
    console.error('No .offers.json found. Provide --in=... or run classify first.');
    process.exit(1);
  }
  const data = JSON.parse(await fs.readFile(offersPath, 'utf8'));
  const offers = Array.isArray(data.offers) ? data.offers : [];
  if (!offers.length) {
    console.log('[publish] No offers to publish.');
    process.exit(0);
  }

  const bookieFromPath = BOOK_NAME_MAPFromPath(offersPath);
  const bookieCol = BOOK_NAME_MAP[bookHint] || BOOK_NAME_MAP[bookieFromPath] || (bookieFromPath || 'Unknown');

  // Pull existing UIDs (for de-dupe across the tab)
  const existingUIDs = await listExistingUIDs(SHEET_ID, TAB);
  if (debug) {
    console.log(`[debug] using ${offersPath} with ${offers.length} offers; bookie="${bookieCol}"`);
    console.log(`[debug] existing UIDs on sheet: ${existingUIDs.size}`);
  }

  // Build rows and compute debug stats
  const today = format(new Date(), 'dd/MM/yyyy');
  const rows = [];
  let posted = 0, dupSkipped = 0, belowThreshold = 0, unpriced = 0;

  for (const o of offers) {
    const betText = o.textOriginal || o.text || '';
    const uid = makeUidLoose({ typeId: o.typeId, bookie: bookieCol, text: betText });
    const boosted = toNum(o.boostedOddsDec);
    const fair = toNum(o.fairOddsDec);       // present only after pricing phase is wired
    const rating = (boosted && fair) ? (boosted / fair) : null;
    const legs = Array.isArray(o.legs) ? o.legs : [];
    const legsMids = Array.isArray(o.legs) ? o.legs.map(L => L.mid ?? null) : [];

    // Decision flags
    const isDup = existingUIDs.has(uid);
    const meetsThreshold = (rating != null) ? (rating >= THRESHOLD) : false;

    // Debug line per offer
    if (debug) {
      const parts = [
        `[offer] ${betText}`,
        `boosted=${fmtNum(boosted)}`,
        `fair=${fmtNum(fair)}`,
        `rating=${rating ? (rating * 100).toFixed(2) + '%' : 'n/a'}`,
        `legs_mids=${legsMids.length ? legsMids.map(fmtNum).join(' | ') : 'n/a'}`
      ];
      if (isDup) parts.push('[skip dedupe]');
      else if (enforce && rating != null && !meetsThreshold) parts.push(`[skip < threshold ${THRESHOLD}]`);
      else if (enforce && rating == null) parts.push('[skip unpriced]');
      else parts.push('[post]');
      console.log(parts.join(' | '));
    }

    // Accounting (but only skip for dedupe always; threshold only when enforced)
    if (isDup) { dupSkipped++; continue; }
    if (enforce && rating == null) { unpriced++; continue; }
    if (enforce && rating != null && !meetsThreshold) { belowThreshold++; continue; }

    const sport = o.sport || 'Football';
    const event = (legs.length <= 1) ? (legs[0]?.label || 'Single') : 'Multi';
    const settleDate = ''; // KO mapping later
    const url = o.sourceUrl || '';
    const colL = config.posting?.prefillP ? 'P' : '';

    rows.push([
      today,        // A Date
      '',           // B
      bookieCol,    // C Bookie
      sport,        // D Sport
      event,        // E Event
      betText,      // F Bet Text
      settleDate,   // G Settle Date
      boosted ?? '',// H Odds (boosted)
      fair ?? '',   // I Fair Odds
      '', '',       // J,K
      colL,         // L = "P" (prefill)
      '', '',       // M,N-1
      url,          // N URL
      '', '', '', '', '', '', '', '', '', '', '', // O..Z
      uid           // AA UID
    ]);
    posted++;
  }

  // Publish (or dry run)
  const res = await publishRows(rows, { sheetId: SHEET_ID, tab: TAB, dryRun });
  const updatedRange = res.updatedRange || null;

  // Summary
  console.log('[summary]', JSON.stringify({
    sheetTab: TAB,
    updatedRange,
    offersFound: offers.length,
    posted,
    dupSkipped,
    belowThreshold,
    unpriced,
    threshold: THRESHOLD,
    enforced: !!enforce,
    dryRun: !!dryRun
  }, null, 2));
} catch (err) {
  console.error('[publish] failed:', err?.message || err);
  process.exit(1);
}

// --- helpers ---

function BOOK_NAME_MAPFromPath(p) {
  const m = p.match(/[\\\/]snapshots[\\\/]([^\\\/]+)[\\\/]/i);
  return m?.[1]?.toLowerCase() || null;
}

async function findLatestOffers(bookieHint) {
  const root = path.resolve(__dirname, '..', 'snapshots');
  let latest = null;
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        // If at root level and a bookie hint is given, only traverse that one
        if (dir === root && bookieHint && e.name.toLowerCase() !== bookieHint) continue;
        await walk(p);
      } else if (e.isFile() && /\.offers\.json$/i.test(e.name)) {
        const st = await fs.stat(p);
        if (!latest || st.mtimeMs > latest.mtimeMs) latest = { path: p, mtimeMs: st.mtimeMs };
      }
    }
  }
  await walk(root);
  return latest?.path || null;
}

function makeUidLoose({ typeId, bookie, text }) {
  const day = format(new Date(), 'yyyy-MM-dd');
  const basis = `${typeId}|${bookie}|${text}|${day}`.toLowerCase();
  return crypto.createHash('sha1').update(basis).digest('hex');
}

function toNum(x) {
  if (x == null || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function fmtNum(x) {
  if (x == null) return 'n/a';
  if (!Number.isFinite(Number(x))) return String(x);
  return Number(x).toFixed(3);
}

// Read all values from AA column to build a UID set
async function listExistingUIDs(sheetId, tab) {
  const auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const range = `${tab}!AA:AA`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range }).catch(() => null);
  const values = res?.data?.values || [];
  const set = new Set();
  for (const row of values) {
    const v = (row && row[0] != null) ? String(row[0]).trim() : '';
    if (v) set.add(v);
  }
  return set;
}