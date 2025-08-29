// bookmakers/williamhill/snapshot.js
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createBrowserContext } from '../../lib/antibot/browserFactory.js';
import { runSteps } from '../../lib/antibot/navigator.js';
import cfg from '../../config/global.json' with { type: 'json' };
import wh from '../../data/bookmakers/williamhill.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function snapshotWilliamHill() {
  const startedAt = new Date();
  const outRoot = path.resolve(__dirname, '../../', cfg.snapshots.outputDir || './snapshots');
  const dayDir = path.join(outRoot, 'williamhill', startedAt.toISOString().slice(0, 10));
  await ensureDir(dayDir);

  const stamp = tsSlug(startedAt);
  const baseName = `${stamp}_price-boosts`;
  const htmlPath = path.join(dayDir, `${baseName}.html`);
  const metaPath = path.join(dayDir, `${baseName}.meta.json`);
  const pngPath  = path.join(dayDir, `${baseName}.png`);

  const ctx = await createBrowserContext({
    headless: true,
    timezoneId: cfg.antibot?.timezone || 'Europe/London',
    locale: 'en-GB'
  });

  let finalUrl = wh.baseUrls?.[0] || '';
  try {
    const page = await ctx.newPage();

    // Handy screenshot saver for navigator steps when used
    const onScreenshot = async (p, label) => {
      const pth = path.join(dayDir, `${baseName}.${safe(label)}.png`);
      await p.screenshot({ path: pth, fullPage: true });
      return pth;
    };

    await runSteps(page, wh.navigate?.steps || [], {
      baseUrls: wh.baseUrls || [],
      consentSelectors: wh.consentSelectors || [],
      onScreenshot
    });

    // Always take a final full-page PNG (screenshots enabled in MVP)
    await page.screenshot({ path: pngPath, fullPage: true });

    // Save HTML
    const html = await page.content();
    await fsp.writeFile(htmlPath, html, 'utf8');

    finalUrl = page.url();

    // Save META
    const meta = {
      bookie: 'williamhill',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      url: finalUrl,
      baseUrl: wh.baseUrls?.[0] || null,
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight })),
      timezone: cfg.antibot?.timezone || 'Europe/London',
      consentSelectorsTried: wh.consentSelectors || [],
      steps: wh.navigate?.steps?.map(s => s.action) || [],
      ok: true
    };
    await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    return { htmlPath, metaPath, screenshotPath: pngPath };
  } catch (err) {
    // Persist a failure meta for debugging
    const fail = {
      bookie: 'williamhill',
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      url: finalUrl,
      error: String(err && err.message ? err.message : err)
    };
    try { await fsp.writeFile(metaPath, JSON.stringify(fail, null, 2), 'utf8'); } catch {}
    throw err;
  } finally {
    await ctx.close().catch(() => {});
  }
}

// helpers
async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}
function tsSlug(d) {
  const pad = (n) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}-${m}-${day}_${hh}-${mm}-${ss}`;
}
function safe(s = '') {
  return String(s).replace(/[^a-z0-9_.-]+/gi, '-').slice(0, 40);
}

export default snapshotWilliamHill;