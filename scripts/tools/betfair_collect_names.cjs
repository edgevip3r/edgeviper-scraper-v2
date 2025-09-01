// =============================================================
// File: scripts/tools/betfair_collect_names.cjs
// Purpose: Pull names from Betfair Exchange for the next X days and
//          write observed raw strings to data/collected/betfair/YYYY-MM-DD.json
// Notes:
//  - CommonJS (.cjs) so it works even if your repo has "type":"module".
//  - Uses built-in fetch (Node 18+). If on older Node, upgrade.
//  - Set env: BETFAIR_APP_KEY, BETFAIR_SESSION_TOKEN
//  - Sports/eventTypeIds you can pass: football=1, horse racing=7, golf=8 (check your Betfair docs)
//  - We only collect strings; we do NOT store prices here.
// CLI examples:
//    node scripts/tools/betfair_collect_names.cjs --days=7 --eventTypeId=1 --markets=MATCH_ODDS,COMPETITION_WINNER,TOP_GOALSCORER
// =============================================================

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.betfair.com/exchange/betting/rest/v1.0';

function argVal(name, def) {
  const pref = `--${name}=`;
  const hit = process.argv.find(a => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : def;
}

function ensureDir(p) { if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); }

function isoNowPlusDays(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

async function bfPost(method, body) {
  const appKey = process.env.BETFAIR_APP_KEY;
  const sess = process.env.BETFAIR_SESSION_TOKEN;
  if (!appKey || !sess) {
    throw new Error('Missing BETFAIR_APP_KEY or BETFAIR_SESSION_TOKEN in env');
  }
  const url = `${API_BASE}/${method}/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Application': appKey,
      'X-Authentication': sess,
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text().catch(()=> '');
    throw new Error(`${method} failed: ${res.status} ${res.statusText} :: ${text}`);
  }
  return res.json();
}

function normalise(s) {
  return s ? s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^\p{L}\p{N}]+/gu,' ').replace(/\s+/g,' ').trim() : '';
}

async function main() {
  const days = parseInt(argVal('days', '5'), 10);
  const eventTypeId = argVal('eventTypeId', '1'); // default football
  const markets = (argVal('markets', 'MATCH_ODDS,COMPETITION_WINNER,TOP_GOALSCORER')||'').split(',').map(s=>s.trim()).filter(Boolean);
  const outDir = path.join('data','collected','betfair');
  ensureDir(outDir);

  const from = new Date().toISOString();
  const to = isoNowPlusDays(days);

  const body = {
    filter: {
      eventTypeIds: [String(eventTypeId)],
      marketStartTime: { from, to },
      marketTypeCodes: markets,
      inPlayOnly: false
    },
    marketProjection: ['RUNNER_DESCRIPTION','COMPETITION','EVENT'],
    sort: 'FIRST_TO_START',
    maxResults: 200
  };

  console.log(`[betfair_collect] Requesting market catalogues for eventTypeId=${eventTypeId}, days=${days}`);
  const cats = await bfPost('listMarketCatalogue', body);

  const rows = [];
  for (const m of cats || []) {
    const competition = m.competition && m.competition.name || undefined;
    const event = m.event && m.event.name || undefined;
    const marketType = m.marketName || m.marketType;
    // Teams typically appear in event.name like "Team A v Team B" for MATCH_ODDS
    if (event && / v | vs | v\. /i.test(event)) {
      const parts = event.split(/\s+v\.?\s+|\s+vs\.?\s+/i);
      if (parts.length === 2) {
        rows.push({ source:'betfair', sport:'football', kind:'team', raw: parts[0], context:{ marketType, competition, event } });
        rows.push({ source:'betfair', sport:'football', kind:'team', raw: parts[1], context:{ marketType, competition, event } });
      }
    }
    // Competition
    if (competition) rows.push({ source:'betfair', sport: 'football', kind:'competition', raw: competition, context:{ marketType, event } });

    // Outrights runners contain team/player names
    if (Array.isArray(m.runners)) {
      for (const r of m.runners) {
        if (r.runnerName) {
          // we cannot be sure if team/player; store as generic 'unknown' and let matcher decide using masters
          rows.push({ source:'betfair', sport:'football', kind:'unknown', raw: r.runnerName, context:{ marketType, competition, event } });
        }
      }
    }
  }

  // dedupe by (kind,raw)
  const seen = new Set();
  const deduped = rows.filter(r => {
    const key = `${r.kind}|${normalise(r.raw)}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });

  const stamp = new Date().toISOString().slice(0,10);
  const outFile = path.join(outDir, `${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(deduped, null, 2));
  console.log(`[betfair_collect] Wrote ${deduped.length} rows -> ${outFile}`);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}