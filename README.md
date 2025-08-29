# EdgeViper Scraper v2

Local-first, modular, **type-centric** sports boost scraper + valuer.  
MVP supports **William Hill** and **PricedUp**. Bet types: **ALL_TO_WIN** (live) and **WIN_AND_BTTS** (WH live; PU ready when they list some).

- Direct **value → publish** pipeline with de-dupe, skip logging, and **date-only** settle dates.
- Anti-bot measures centralized (no proxies yet).
- Modular bet types (recognisers, extractors, mappers, pricers) under `bettypes/`.
- Per-book snapshot + parser kept thin; no central “switch/case” per bookmaker.

---

# /// Prereqs /// #

- **Node 18+** (ESM)
- **Google Sheets** service account JSON (`GOOGLE_APPLICATION_CREDENTIALS`)
- **Betfair** cert auth for pricing:
  - `BETFAIR_APP_KEY`, `BETFAIR_USERNAME`, `BETFAIR_PASSWORD`
  - Either `BETFAIR_PFX` (+ `BETFAIR_PFX_PASSPHRASE`) **or** `BETFAIR_CERT` + `BETFAIR_KEY`

> Secrets live **outside** the repo (e.g., `C:\secrets\...`). The repo never stores creds.

---

# /// Environment /// #

Set these once per terminal session (PowerShell examples), or use a local `.env` if you prefer (don’t commit it):

`powershell
# Google
$env:GOOGLE_APPLICATION_CREDENTIALS = "C:\secrets\gsa.json"
$env:BET_TRACKER_SHEET_ID           = "<your bet tracker sheet id>"
$env:SKIPPED_SHEET_ID               = "<optional: separate Skipped tab sheet id>"

# Betfair
$env:BETFAIR_APP_KEY        = "<app key>"
$env:BETFAIR_USERNAME       = "<username>"
$env:BETFAIR_PASSWORD       = "<password>"
# Either a PFX...
$env:BETFAIR_PFX            = "C:\secrets\betfair\client.pfx"
$env:BETFAIR_PFX_PASSPHRASE = "<pfx passphrase>"
# ...or CERT+KEY
$env:BETFAIR_CERT           = "C:\secrets\betfair\client.crt"
$env:BETFAIR_KEY            = "C:\secrets\betfair\client.key"

# Optional
$env:LOG_LEVEL = "info"

** Global knobs live in config/global.json:

filters.threshold, minLiquidity, maxSpreadPct

Posting: sheetTab, prefillY, prefillP, spacingSeconds

De-dupe: windowHours

Snapshots: saveHtml, saveScreenshot

Normalize: teamAliasesPath

Logging: skipLogPath

---

# /// Commands & Flags /// #

** All CLIs are under pipelines/.

One-shot (snapshot → parse → classify → value+publish)

# William Hill
node pipelines/run.all.js --book=williamhill --debug --enforce --threshold=1.05

# PricedUp
node pipelines/run.all.js --book=pricedup    --debug --enforce --threshold=1.05

Individual phases (useful while iterating)
# Snapshot (saves HTML + optional screenshot under snapshots/<book>/<date>/)
node pipelines/run.snapshot.js  --book=williamhill --debug

# Parse (HTML → *.rawoffers.json)
node pipelines/run.parse.js     --book=williamhill --file="snapshots/williamhill/<date>/<file>.html" --debug

# Classify (rawoffers → offers with type + legs)
node pipelines/run.classify.js  --book=williamhill --debug

# Direct value+publish (uses latest *.offers.json)
node pipelines/run.value_publish.js --book=williamhill --debug --enforce --threshold=1.05

# Common flags

--book=<book>: williamhill, pricedup

--debug: verbose logs (mid prices, spreads, liquidity, reasons)

--dry-run: do not write to Sheets

--enforce: actually apply min-liquidity and spread rules (not just warn)

--threshold=<x.xx>: override cfg threshold per run

--persist: keep an on-disk audit of priced items

---

# /// Typical Workflows /// #

# Manual safe check (no writes):

node pipelines/run.all.js --book=williamhill --debug --dry-run --enforce --threshold=1.05


# Happy? Publish and keep audit files:

node pipelines/run.all.js --book=williamhill --debug --enforce --threshold=1.05 --persist


# PricedUp ALL_TO_WIN:

node pipelines/run.all.js --book=pricedup --debug --enforce --threshold=1.05

---

# /// Output (Sheet columns) /// #

A: Date (UK)

C: Bookie

D: Sport

E: Event — Multi for multi-legs; for future single-match types this is the match name

F: Bet Text

G: Settle Date — date only (UK), from latest KO of legs

H: Boosted Odds (book, decimal and/or frac)

I: Fair Odds (e.g., product of mids for ALL_TO_WIN)

L: P prefill (configurable)

N: URL (card link; falls back to the boosts page)

AA: UID (deterministic ID for de-dupe)

** De-dupe: if UID already exists in AA (within the configured window), the offer is skipped.

---

# /// Skip Log /// #

Two sinks:

1. Local JSONL under logs/skip-YYYY-MM-DD.jsonl

2. Skipped tab on your Sheet (if configured)

Reason codes include:

- MAP_* — e.g., NO_EVENT_MATCH, NO_RUNNER_MATCH, CATALOGUE_ERROR

- DEDUPE

- FILTER_* — BELOW_THRESHOLD, LOW_LIQUIDITY, WIDE_SPREAD, UNPRICED

---

# /// File Tree (high level) /// #

bettypes/
  ALL_TO_WIN/
  WIN_AND_BTTS/
  registry.json

bookmakers/
  williamhill/
    snapshot.js
    parser.js
  pricedup/
    snapshot.js
    parser.js

config/
  global.json
  book-aliases.json (optional per-book text quirks)

data/
  bookmakers/*.json           # per-book base URLs, navigation aids, text drops
  compiled/aliases.index.json # central team alias index (canonical = Betfair names)
  synonyms/*.json             # phrase & market synonyms for recognisers
  competitions.json           # (stub)
  teams/master.json           # (stub)

docs/
  ARCHITECTURE.md
  OFFER_TYPES.md

lib/
  antibot/                    # stealth, consent, UA/viewport, network policy
  betfair/                    # cert auth + JSON-RPC client
  books/resolveBook.js        # resolve alias → canonical book key
  fixtures/resolver.js        # (stub) future: fixture resolution
  log/                        # logger + skiplog
  map/betfair-football.js     # football mapping (MO, MO&BTTS) + disambiguation
  normalize/                  # team & competition normalizers
  price/                      # mid-price extraction, value math
  publish/sheets.bettracker.js# Google Sheets publish & Skipped appends
  text/                       # cleaners, odds parsing
  uid/makeUid.js              # deterministic UIDs

pipelines/
  run.snapshot.js
  run.parse.js
  run.classify.js
  run.value_publish.js
  run.all.js
  run.map_price.js    # reserved
  run.filter.js       # reserved
  run.publish.js      # reserved

---

# /// What the key files do /// #

bettypes/*/recognisers.json — patterns that identify a bet type from the bet text.

bettypes/*/extractor.js — takes a bet title and extracts the legs (teams).

bettypes/*/mapper.js — maps each leg to the correct Betfair market & selection.

ALL_TO_WIN: MATCH_ODDS → { team }

WIN_AND_BTTS: MATCH_ODDS_AND_BTTS → { team/Yes }

bettypes/*/pricer.js — fetches ladders and computes mid prices per leg; combines per rules.

bettypes/*/price.rules.json — combining rules (e.g., product-of-mids for ALL_TO_WIN) and type-specific filters (min liquidity, max spread) that override globals.

bookmakers/*/snapshot.js — Playwright/Puppeteer steps with centralized stealth; writes HTML (+ screenshot).

bookmakers/*/parser.js — find each boost card, extract title and fractional odds; run.parse.js turns these into normalized raw offers and injects a sourceUrl.

lib/map/betfair-football.js — catalogue search + selection matching; excludes obvious “U21”/reserves (with opt-in whitelist for exceptions like “Real Sociedad B”).

lib/publish/sheets.bettracker.js — appends to the next row where column A is empty, pre-fills L = P (configurable), writes UID to AA.

pipelines/run.value_publish.js — glue: read latest *.offers.json, map → price → filter → de-dupe → publish (+ skip log).

---

# /// Status by Book / Bet Type /// #

# William Hill

ALL_TO_WIN: ✅ live E2E

WIN_AND_BTTS: ✅ live E2E (mapped to Betfair MATCH_ODDS_AND_BTTS; liquidity/spread rules apply)

# PricedUp

ALL_TO_WIN: ✅ live E2E (parser + classifier + value→publish)

WIN_AND_BTTS: 🟨 classifier ready; mapping/pricing ready; waiting for live examples (their page hasn’t listed them consistently yet)

---

# /// Roadmap /// #

** 1 & 2 are equally as important

1. Add more bet types (e.g., Multi-game BTTS/O2.5, FH 0.5 multis, horse multiples, tennis multiples, singles like Team A to win & both teams to score or Team A win to nil and many more).

2. Add more books (drop a folder + JSON config; no central edits).

3. Scheduler + spacing + proxy support (phase 2).

4. Optional GCS snapshot archive for long-term audit.






















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