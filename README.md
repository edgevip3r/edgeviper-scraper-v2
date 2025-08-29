README.md (updated, paste-over)
# EdgeViper Scraper v2 (MVP)

Local-only, modular, **type-centric** scraper.  
Now live for **William Hill (ALL_TO_WIN)** end-to-end with **direct value→publish** (optional `--persist` audit).  
**Skip logging** is wired to your “Skipped” tab + JSONL fallback.

---

## Prereqs

- Node 18+ (ESM)
- Google service account JSON via `GOOGLE_APPLICATION_CREDENTIALS`
- Sheet IDs:
  - `BET_TRACKER_SHEET_ID` (main Bet Tracker)
  - optional `SKIPPED_SHEET_ID` (defaults to `BET_TRACKER_SHEET_ID`)
- Betfair cert auth (for pricing)
  - `BETFAIR_APP_KEY`, `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`
  - Either `BETFAIR_PFX`(+`BETFAIR_PFX_PASSPHRASE`) **or** `BETFAIR_CERT`+`BETFAIR_KEY`
  - Optional: `BETFAIR_REGION` (defaults `com`)

```bash
# PowerShell example
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secrets\gsa.json"
$env:BET_TRACKER_SHEET_ID           = "<your bet tracker sheet id>"
$env:SKIPPED_SHEET_ID               = "<same or other sheet id>"

$env:BETFAIR_APP_KEY        = "<app key>"
$env:BETFAIR_USERNAME       = "<username>"
$env:BETFAIR_PASSWORD       = "<password>"
$env:BETFAIR_PFX            = "C:\secrets\betfair\client.pfx"
$env:BETFAIR_PFX_PASSPHRASE = "<pfx pass>"

Workflow (manual, per book)

Snapshot → Parse → Classify
Produce ...offers.json (ALL_TO_WIN):

node pipelines/run.snapshot.js  --book=williamhill
node pipelines/run.parse.js     --book=williamhill
node pipelines/run.classify.js  --book=williamhill

node pipelines/run.snapshot.js  --book=pricedup
node pipelines/run.parse.js     --book=pricedup
node pipelines/run.classify.js  --book=pricedup

(Same for --book=pricedup once parser is in.)

Direct value→publish
Reads the latest *.offers.json, maps legs to Betfair, prices mids, filters, de-dupes vs AA, publishes to the next empty A row:

# dry-run with full debug (no writes to Bet Tracker; Skipped logs go to JSONL only)
node pipelines/run.value_publish.js --book=williamhill --debug --dry-run --enforce --threshold=1.05
node pipelines/run.value_publish.js --book=pricedup --debug --dry-run --enforce --threshold=1.05

# live publish (+ optional on-disk audit of priced data)
node pipelines/run.value_publish.js --book=williamhill --debug --enforce --threshold=1.05 --persist
node pipelines/run.value_publish.js --book=pricedup --debug --enforce --threshold=1.05 --persist

# run-all
node pipelines/run.all.js --book=williamhill --debug --enforce --threshold=1.05
node pipelines/run.all.js --book=pricedup --debug --enforce --threshold=1.05

Columns written (Bet Tracker)

A=Date | C=Bookie | D=Sport | E=Event | F=Bet Text | G=Settle Date (latest KO, UK) | H=Odds (boosted) | I=Fair Odds | L=P | N=URL | AA=UID

L is prefilled with P (configurable).

UID is sha1(type|book|text|YYYY-MM-DD); de-dupe checks AA on sheet.

Skipped (triage)

Appends to Skipped tab (and ./logs/skip-YYYY-MM-DD.jsonl):

map stage: unmatched legs (reasons include NO_EVENT_MATCH, NO_RUNNER_MATCH, CATALOGUE_ERROR).

dedupe stage: DUPLICATE.

filter stage: UNPRICED, BELOW_THRESHOLD, LOW_LIQUIDITY, WIDE_SPREAD.

Config

config/global.json (defaults):

{
  "filters": { "threshold": 1.05, "minLiquidity": 20, "maxSpreadPct": 20 },
  "posting":  { "sheetTab": "Bet Tracker", "prefillY": false, "prefillP": true, "spacingSeconds": 0 },
  "dedupe":   { "uidVersion": 1, "windowHours": 72 },
  "snapshots":{"outputDir": "./snapshots", "saveHtml": true, "saveScreenshot": true },
  "antibot":  { "enabled": true, "timezone": "Europe/London" },
  "normalize":{"teamAliasesPath": "./data/compiled/aliases.index.json" },
  "logging":  { "skipLogPath": "./logs/skip-YYYY-MM-DD.jsonl" }
}

Aliases (teams)

Central, catch-all file: data/compiled/aliases.index.json
Format: alias → Betfair runner name. Add as many aliases per team as needed. Keep canonical equal to Betfair’s runner string (e.g., "psg": "Paris St-G").
Per-book overlays (only if needed): data/bookmakers/<book>.aliases.json (same format).

The normaliser matches case-insensitively, strips accents/punctuation, and treats & as and. Still include true synonyms (e.g., man utd ↔ manchester united).

Betfair pricing (mids → fair odds)

Mapper searches MATCH_ODDS within a 120h window using multi-pass (canonical → raw → broad) and filters by aliases.

Mid per leg = midpoint of best back/lay, falls back to single side if only one is available.

Offer fair odds = product of leg mids (ALL_TO_WIN).

Guards: threshold, min top-of-book liquidity across legs, max spread % across legs.

Troubleshooting

CERT_AUTH_REQUIRED from Node: switch to our https-based auth (already in lib/betfair/auth.js) and verify the cert is uploaded to Betfair (client-auth EKU).

Malformed JSON in …offers.json: re-run classify or pass --in=...offers.json.

Unmatched legs: add aliases to the central file; re-run --debug to see which query (whichQuery) hit.

Roadmap

Add PricedUp parser (ALL_TO_WIN).

Minimal run.all.js chain.

Add WIN_AND_BTTS type.

Optional: --cleanup-days N to prune artifacts.

Later: scheduler, proxies, GCS snapshots, more bet types (horses, BTTS multis, O2.5 multis).