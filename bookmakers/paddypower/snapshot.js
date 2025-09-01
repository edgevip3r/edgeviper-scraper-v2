// ESM module — compatible with package.json `"type":"module"`
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }
function nowParts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}` };
}
function writeJson(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8'); }
function loadJson(relPath) {
  const p = path.resolve(relPath);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function clickConsentIfPresent(page) {
  // Try a few common OneTrust buttons. Fail silently if absent.
  const selectors = [
    '#onetrust-accept-btn-handler',
    '#accept-recommended-btn-handler',
    '#onetrust-reject-all-handler',
    '.ot-pc-refuse-all-handler'
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel);
      if (await btn.first().isVisible({ timeout: 500 })) {
        await btn.first().click({ timeout: 1500 });
        // Small pause to let banner disappear
        await delay(300);
        break;
      }
    } catch {}
  }
}

async function snapshot(opts = {}) {
  const { debug = false } = opts;
  const cfg = loadJson('config/global.json');
  const routes = loadJson('bookmakers/paddypower/routes.json');
  const specialsUrl = routes && routes.specialsUrl;
  if (!specialsUrl) throw new Error('paddypower/routes.json is missing `specialsUrl`.');

  const { date, time } = nowParts();
  const baseDir = path.resolve((cfg && cfg.snapshots && cfg.snapshots.outputDir) || './snapshots');
  const outDir = path.join(baseDir, 'paddypower', date, `${time}`);
  ensureDir(outDir);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: (cfg && cfg.antibot && cfg.antibot.timezone) || 'Europe/London',
    viewport: { width: 1368, height: 882 },
  });
  const page = await context.newPage();

  const captured = { cmp: [], prices: [] };
  page.on('response', async (res) => {
    try {
      const url = res.url();
      if (/\/smspp\/content-managed-page\/v7/i.test(url)) {
        const json = await res.json().catch(() => null);
        if (json) captured.cmp.push({ url, json });
      }
      if (/\/fixedodds\/readonly\/v1\/getMarketPrices/i.test(url)) {
        const json = await res.json().catch(() => null);
        if (json) captured.prices.push({ url, json });
      }
    } catch { /* ignore */ }
  });

  await page.goto(specialsUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Handle cookie consent if present
  await clickConsentIfPresent(page);

  // Warm-up for Cloudflare and trigger lazy hydration
  await delay(1000);
  await page.evaluate(() => window.scrollBy(0, 600));
  await delay(350);
  await page.evaluate(() => window.scrollBy(0, 1200));
  await delay(1200);

  const htmlPath = path.join(outDir, 'page.html');
  const html = await page.content();
  fs.writeFileSync(htmlPath, html, 'utf8');

  let screenshotPath = null;
  if (cfg && cfg.snapshots && cfg.snapshots.saveScreenshot) {
    screenshotPath = path.join(outDir, 'page.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }

  let cmpCount = 0, pricesCount = 0;
  for (const { url, json } of captured.cmp) {
    const m = url.match(/cardsToFetch=([^&]+)/);
    const tag = m ? decodeURIComponent(m[1]) : 'cmp';
    writeJson(path.join(outDir, `content-managed-page.${tag}.${++cmpCount}.json`), json);
  }
  for (const { json } of captured.prices) {
    writeJson(path.join(outDir, `getMarketPrices.${++pricesCount}.json`), json);
  }

  const metaPath = path.join(outDir, 'meta.json');
  writeJson(metaPath, {
    book: 'paddypower',
    url: specialsUrl,
    at: new Date().toISOString(),
    counts: { cmp: cmpCount, prices: pricesCount }
  });

  if (debug) console.log(`[pp:snapshot] saved → ${outDir}`);

  await context.close();
  await browser.close();

  // Return an object to satisfy your runner's expectations
  return {
    ok: true,
    book: 'paddypower',
    htmlPath,
    screenshotPath,
    metaPath,
    outDir
  };
}

export default snapshot;
export { snapshot };
