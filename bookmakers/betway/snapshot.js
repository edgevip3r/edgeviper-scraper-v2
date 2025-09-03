// Snapshot Betway Boosts (Football) using Playwright.
// META-FIRST: capture /betway-boosts/boosts response; no expand/scroll unless needed as fallback.
// - Handles consent quickly.
// - Waits for the API; if not seen, tries a lightweight Football header click once.
// - Saves HTML for debugging and META for the parser.
//
// Contract: export default async ({ book, config, bookCfg, outRoot, debug }) => { htmlPath, screenshotPath, metaPath }
import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { chromium } from 'playwright';

function tsParts(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return { dateDir: `${y}-${m}-${day}`, stamp: `${y}-${m}-${day}_${hh}-${mm}-${ss}` };
}

async function quickConsent(page, debug=false) {
  const sels = [
    '#onetrust-accept-btn-handler',
    '#accept-recommended-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#CybotCookiebotDialogBodyButtonAccept',
    'button:has-text("Accept all")',
    'button:has-text("Accept All")',
    'button:has-text("Allow All")',
    'button:has-text("Allow all")',
  ];
  for (const s of sels) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible()) {
        debug && console.log('[consent] click', s);
        await el.click({ timeout: 1200 });
        await page.waitForTimeout(200);
        break;
      }
    } catch {}
  }
}

export default async function snapshotBetway({ book, config, bookCfg, outRoot, debug }) {
  const url = (bookCfg?.baseUrls && bookCfg.baseUrls[0]) || 'https://betway.com/gb/en/sports/cat/betway-boosts';
  const { dateDir, stamp } = tsParts();
  const outDir = path.resolve(outRoot, book, dateDir);
  await fs.mkdir(outDir, { recursive: true });

  const htmlPath = path.join(outDir, `${stamp}_boosts.html`);
  const pngPath  = path.join(outDir, `${stamp}_boosts.png`);
  const metaPath = path.join(outDir, `${stamp}_meta.json`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled','--no-sandbox']
  });
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 }
  });
  const page = await context.newPage();

  let wroteMeta = false;
  page.on('response', async (resp) => {
    try {
      const u = resp.url();
      if (/betway-boosts\/boosts/i.test(u) && !wroteMeta) {
        const body = await resp.text();
        const headers = resp.headers();
        const status = resp.status();
        const rec = { capturedAt: new Date().toISOString(), url: u, status, headers, body };
        await fs.writeFile(metaPath, JSON.stringify(rec, null, 2), 'utf8');
        wroteMeta = true;
        if (debug) console.log('[snapshot:betway] saved meta from', u);
      }
    } catch {}
  });

  try {
    if (debug) console.log(`[snapshot:betway] goto ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

    await quickConsent(page, debug);

    // Give app a beat to fire initial requests
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    // Wait for the boosts API to show up
    let apiSeen = false;
    try {
      const resp = await page.waitForResponse(r => /betway-boosts\/boosts/i.test(r.url()), { timeout: 7000 });
      apiSeen = !!resp;
    } catch {}

    // Fallback once: try to nudge by clicking the Football header
    if (!apiSeen) {
      if (debug) console.log('[snapshot:betway] boosts API not seen yet; trying football header click');
      try {
        const titles = page.locator('header[data-testid="table-header"] span[data-testid="table-header-title"]');
        const n = await titles.count();
        for (let i = 0; i < n; i++) {
          const txt = (await titles.nth(i).innerText()).trim();
          if (/football/i.test(txt)) {
            const header = titles.nth(i).locator('xpath=ancestor::header[@data-testid="table-header"]');
            try { await header.scrollIntoViewIfNeeded(); } catch {}
            await header.click({ timeout: 1500, force: true }).catch(() => {});
            break;
          }
        }
        // wait again briefly for API
        await page.waitForResponse(r => /betway-boosts\/boosts/i.test(r.url()), { timeout: 5000 }).then(() => { apiSeen = true; }).catch(() => {});
      } catch {}
    }

    // Save HTML (+ optional screenshot) for debugging
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');
    if (config?.snapshots?.saveScreenshot) {
      try { await page.screenshot({ path: pngPath, fullPage: true }); } catch {}
    }
    if (debug) console.log(`[snapshot:betway] wrote ${htmlPath}${config?.snapshots?.saveScreenshot ? ' & screenshot' : ''}${wroteMeta ? ' & meta' : ''}`);

    return { htmlPath, screenshotPath: fss.existsSync(pngPath) ? pngPath : null, metaPath: wroteMeta && fss.existsSync(metaPath) ? metaPath : null };
  } finally {
    await context.close();
    await browser.close();
  }
}
