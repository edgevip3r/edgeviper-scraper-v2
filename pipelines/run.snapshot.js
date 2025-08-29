// pipelines/run.snapshot.js
// Orchestrates a single snapshot for a given book via convention-based dynamic loading.
//
// Usage:
//   node pipelines/run.snapshot.js --book=<alias|canonical> [--debug]
//
// Expects a plugin at: bookmakers/<book>/snapshot.js exporting default/snapshot/snapshot<Book>().

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import cfg from '../config/global.json' with { type: 'json' };
import { resolveBookKey } from '../lib/books/resolveBook.js';

function args(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+?)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] ?? true;
  }
  return out;
}
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const a = args(process.argv);
const debug = a.debug === '' || a.debug === 'true' || a.debug === true;

const rawBook = String(a.book || '').trim();
if (!rawBook) {
  console.error('Usage: node pipelines/run.snapshot.js --book=<bookKey>');
  process.exit(1);
}

(async () => {
  try {
    const { canonical } = await resolveBookKey(rawBook);

    const plugin = await loadSnapshotPlugin(canonical);
    if (!plugin) {
      console.error(`[snapshot:${canonical}] no snapshot plugin found in bookmakers/${canonical}/snapshot.js`);
      process.exit(1);
    }

    const bookCfgPath = path.resolve(__dirname, '..', 'data', 'bookmakers', `${canonical}.json`);
    const bookCfg = fss.existsSync(bookCfgPath)
      ? JSON.parse(await fs.readFile(bookCfgPath, 'utf8'))
      : { name: canonical, baseUrls: [] };

    const outRoot = path.resolve(__dirname, '..', cfg.snapshots?.outputDir || './snapshots');
    await fs.mkdir(outRoot, { recursive: true });

    const result = await plugin({
      book: canonical,
      config: cfg,
      bookCfg,
      outRoot,
      debug
    });

    const { htmlPath, screenshotPath, metaPath } = result || {};
    console.log(JSON.stringify({
      ok: !!htmlPath,
      book: canonical,
      htmlPath: rel(htmlPath),
      screenshotPath: rel(screenshotPath),
      metaPath: rel(metaPath)
    }, null, 2));
  } catch (err) {
    console.error('[snapshot] failed:', err?.message || err);
    process.exit(1);
  }
})();

async function loadSnapshotPlugin(bookKey) {
  const modPath = path.resolve(__dirname, '..', 'bookmakers', bookKey, 'snapshot.js');
  if (!fss.existsSync(modPath)) return null;
  const mod = await import(pathToFileURL(modPath).href);
  const pascal = bookKey.split(/[^a-z0-9]+/i).filter(Boolean).map(w => w[0].toUpperCase()+w.slice(1)).join('');
  return mod.default || mod.snapshot || mod[`snapshot${pascal}`] || null;
}

function rel(p) {
  if (!p) return null;
  try { return path.relative(path.resolve(__dirname, '..'), p); } catch { return p; }
}