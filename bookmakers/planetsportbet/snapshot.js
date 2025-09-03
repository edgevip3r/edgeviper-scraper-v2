// Snapshot PlanetSportBet RocketBoosts (Football) using Playwright.
// Signature matches pipelines/run.snapshot.js expectations (book-agnostic).

import fs from 'fs/promises';
import fss from 'fs';
import path from 'path';
import { chromium } from 'playwright';

/** timestamp parts + date folder */
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

/**
 * @param {Object} opts
 * @param {string} opts.book
 * @param {object} opts.config
 * @param {object} opts.bookCfg
 * @param {string} opts.outRoot
 * @param {boolean} opts.debug
 */
export default async function snapshotPlanetSportBet({ book, config, bookCfg, outRoot, debug }) {
  const url = (bookCfg?.baseUrls && bookCfg.baseUrls[0]) || 'https://planetsportbet.com/sport-special/RocketBoosts';

  const { dateDir, stamp } = tsParts();
  const outDir = path.resolve(outRoot, book, dateDir);
  await fs.mkdir(outDir, { recursive: true });

  const htmlPath = path.join(outDir, `${stamp}_boosts.html`);
  const pngPath  = path.join(outDir, `${stamp}_boosts.png`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 }
  });
  const page = await context.newPage();

  try {
    if (debug) console.log(`[snapshot:planetsportbet] goto ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

    // Cookiebot consent (same as NRG/PU)
    const consentSelectors = [
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button:has-text("Allow all")',
      '#CybotCookiebotDialogBodyButtonAccept',
      'button:has-text("Accept")',
      '#CybotCookiebotDialogBodyButtonDecline'
    ];
    for (const sel of consentSelectors) {
      const el = page.locator(sel);
      try {
        if (await el.first().isVisible()) {
          if (debug) console.log(`[snapshot:planetsportbet] consent click ${sel}`);
          await el.first().click({ timeout: 2000 });
          break;
        }
      } catch {}
    }

    // Wait for boosts to render
    await page.waitForTimeout(800);
    await page.waitForSelector('li[class*="SelectionsGroupLiItem"], [class*="SelectionsGroupName"]', { timeout: 15000 });

    // Expand collapsed sections
    const expanded = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('div[class*="MarketHeaderContent"], h4[class*="MarketHeaderContent"]'));
      let clicks = 0;
      for (const h of headers) {
        const aria = h.getAttribute('aria-expanded');
        const wrap = h.parentElement?.parentElement?.querySelector('div[class*="SelectionsGroupWrap"]');
        const hidden = wrap && (wrap.getAttribute('hidden') !== null || wrap.style.display === 'none');
        if (aria === 'false' || hidden) {
          (h instanceof HTMLElement) && h.click();
          clicks++;
        }
      }
      return clicks;
    });
    if (debug) console.log(`[snapshot:planetsportbet] expanded groups: ${expanded}`);

    // Scroll to hydrate lazy content
    let lastHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === lastHeight) break;
      lastHeight = h;
    }

    // Save HTML (+ optional screenshot)
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');
    if (config?.snapshots?.saveScreenshot) {
      try { await page.screenshot({ path: pngPath, fullPage: true }); } catch {}
    }
    if (debug) console.log(`[snapshot:planetsportbet] wrote ${htmlPath}${config?.snapshots?.saveScreenshot ? ' & screenshot' : ''}`);

    return { htmlPath, screenshotPath: fss.existsSync(pngPath) ? pngPath : null, metaPath: null };
  } finally {
    await context.close();
    await browser.close();
  }
}
