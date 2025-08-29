// pipelines/run.all.js
// Orchestrate: snapshot → parse → classify → value_publish
// Usage examples:
//   node pipelines/run.all.js --book=williamhill --debug --dry-run
//   node pipelines/run.all.js --book=pricedup --file="snapshots/pricedup/pu.html" --debug
//   node pipelines/run.all.js --book=williamhill --type=WIN_AND_BTTS --threshold=1.08 --enforce --debug

import { spawn } from 'child_process';
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---- args ----
const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const m = a.match(/^--([^=]+)(?:=(.*))?$/);
  if (!m) return [];
  const k = m[1]; const v = (m[2] === undefined ? true : m[2]);
  return [k, v];
}).filter(Boolean));

const book       = args.book;
const htmlFile   = args.file || null;                // provide .html to skip snapshot
const typeFilter = args.type || null;                // e.g., ALL_TO_WIN | WIN_AND_BTTS
const debug      = !!args.debug;
const dryRun     = !!(args['dry-run'] || args.dryrun);
const enforce    = !!args.enforce;
const threshold  = args.threshold ? Number(args.threshold) : null;

if (!book) {
  console.error('Usage: node pipelines/run.all.js --book=<williamhill|pricedup> [--file=<html>] [--type=ALL_TO_WIN|WIN_AND_BTTS] [--debug] [--dry-run] [--enforce] [--threshold=1.05]');
  process.exit(1);
}

// ---- helpers ----
function runNode(scriptRel, passArgs = []) {
  const script = path.resolve(__dirname, scriptRel);
  return new Promise((resolve, reject) => {
    const ps = spawn(process.execPath, [script, ...passArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ps.stdout.on('data', d => { out += d.toString(); if (debug) process.stdout.write(d); });
    ps.stderr.on('data', d => { err += d.toString(); process.stderr.write(d); });
    ps.on('close', code => {
      if (code === 0) resolve({ code, out, err });
      else reject(Object.assign(new Error(`step failed: ${scriptRel} (code ${code})`), { code, out, err, script: scriptRel }));
    });
  });
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

async function findLatest(dir, rx) {
  let best = null; let bestTime = 0;
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) {
      const sub = await findLatest(full, rx);
      if (sub && sub.mtimeMs > bestTime) { best = sub; bestTime = sub.mtimeMs; }
    } else if (rx.test(it.name)) {
      const st = await fs.stat(full);
      if (st.mtimeMs > bestTime) { best = { path: full, mtimeMs: st.mtimeMs }; bestTime = st.mtimeMs; }
    }
  }
  return best;
}

function pickFromStdout(regex, text) {
  const m = text.match(regex);
  return m ? m[1] : null;
}

// ---- step 1: snapshot (or use provided html) ----
async function stepSnapshot() {
  if (htmlFile) {
    const resolved = path.resolve(process.cwd(), htmlFile);
    if (!(await exists(resolved))) throw new Error(`Provided --file not found: ${resolved}`);
    if (debug) console.log(`[run-all] using provided HTML: ${resolved}`);
    return resolved;
  }
  const pass = [`--book=${book}`];
  if (debug) pass.push('--debug');
  const { out } = await runNode('./run.snapshot.js', pass);

  // try to parse an explicit path if your snapshot prints it; else, find newest .html under ./snapshots/<book>/
  const explicit = pickFromStdout(/wrote\s+html\s*->\s*(.+\.html)\s*$/mi, out);
  if (explicit && fss.existsSync(explicit)) return explicit;

  const root = path.resolve(process.cwd(), 'snapshots', book);
  const latest = await findLatest(root, /\.html$/i);
  if (!latest) throw new Error(`No HTML snapshot found under ${root}`);
  if (debug) console.log(`[run-all] latest HTML: ${latest.path}`);
  return latest.path;
}

// ---- step 2: parse → .rawoffers.json ----
async function stepParse(htmlPath) {
  const pass = [`--book=${book}`, `--file=${htmlPath}`];
  if (debug) pass.push('--debug');
  const { out } = await runNode('./run.parse.js', pass);

  // parse "wrote -> <path.rawoffers.json>"
  let rawoffers = pickFromStdout(/wrote\s*.+->\s*(.+\.rawoffers\.json)\s*$/mi, out);
  if (rawoffers && fss.existsSync(rawoffers)) return rawoffers;

  // fallback: look next to HTML for newest *.rawoffers.json
  const dir = path.dirname(htmlPath);
  const latest = await findLatest(dir, /\.rawoffers\.json$/i);
  if (!latest) throw new Error('parse produced no .rawoffers.json (and none found nearby)');
  return latest.path;
}

// ---- step 3: classify → .offers.json ----
async function stepClassify(rawoffersPath) {
  const pass = [`--book=${book}`, `--in=${rawoffersPath}`];
  if (typeFilter) pass.push(`--type=${typeFilter}`);
  if (debug) pass.push('--debug');
  const { out } = await runNode('./run.classify.js', pass);

  // parse "wrote -> <path.offers.json>"
  let offers = pickFromStdout(/wrote\s*->\s*(.+\.offers\.json)\s*$/mi, out);
  if (offers && fss.existsSync(offers)) return offers;

  // fallback: replace extension
  const guess = rawoffersPath.replace(/\.rawoffers\.json$/i, '.offers.json');
  if (fss.existsSync(guess)) return guess;

  // or newest *.offers.json near rawoffers
  const dir = path.dirname(rawoffersPath);
  const latest = await findLatest(dir, /\.offers\.json$/i);
  if (!latest) throw new Error('classify produced no .offers.json (and none found nearby)');
  return latest.path;
}

// ---- step 4: value+publish ----
async function stepValuePublish(offersPath) {
  const pass = [`--book=${book}`, `--in=${offersPath}`];
  if (debug) pass.push('--debug');
  if (dryRun) pass.push('--dry-run');
  if (enforce) pass.push('--enforce');
  if (threshold != null && !Number.isNaN(threshold)) pass.push(`--threshold=${threshold}`);
  const { out } = await runNode('./run.value_publish.js', pass);

  // try to parse a compact JSON summary if present
  // (our run.publish prints {"ok":true,"written":N} in some modes; value_publish prints posted/skipped in text)
  const m = out.match(/"written"\s*:\s*(\d+)/);
  const written = m ? Number(m[1]) : null;
  return { out, written };
}

// ---- main ----
(async () => {
  const t0 = Date.now();
  console.log(`[run-all] book=${book} ${typeFilter ? `type=${typeFilter}` : ''} ${dryRun ? '(dry-run)' : ''} ${debug ? '(debug)' : ''}`);

  const htmlPath      = await stepSnapshot();
  const rawoffersPath = await stepParse(htmlPath);
  const offersPath    = await stepClassify(rawoffersPath);
  const publishRes    = await stepValuePublish(offersPath);

  const ms = Date.now() - t0;
  console.log(`[run-all] done in ${(ms/1000).toFixed(1)}s`);
  console.log(`[run-all] html=${htmlPath}`);
  console.log(`[run-all] rawoffers=${rawoffersPath}`);
  console.log(`[run-all] offers=${offersPath}`);
  if (publishRes.written != null) console.log(`[run-all] written=${publishRes.written}`);
})().catch(e => {
  console.error('[run-all] FAILED:', e.message);
  if (e.out)  console.error('--- stdout ---\n' + e.out);
  if (e.err)  console.error('--- stderr ---\n' + e.err);
  process.exit(1);
});