// Snapshot StarSports DailySpecials (Football) using Playwright.
// Resilient navigation: avoid 'networkidle' gate; use domcontentloaded + explicit waits.
// Pure JS (no TS casts).
// URL: https://starsports.bet/sport-special/DailySpecials

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

/**
 * @param {Object} opts
 * @param {string} opts.book
 * @param {object} opts.config
 * @param {object} opts.bookCfg
 * @param {string} opts.outRoot
 * @param {boolean} opts.debug
 */
export default async function snapshotStarSports({ book, config, bookCfg, outRoot, debug }) {
  const url = (bookCfg?.baseUrls && bookCfg.baseUrls[0]) || 'https://starsports.bet/sport-special/DailySpecials';

  const { dateDir, stamp } = tsParts();
  const outDir = path.resolve(outRoot, book, dateDir);
  await fs.mkdir(outDir, { recursive: true });

  const htmlPath = path.join(outDir, `${stamp}_boosts.html`);
  const pngPath  = path.join(outDir, `${stamp}_boosts.png`);

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

  try {
    if (debug) console.log(`[snapshot:starsports] goto ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });

    // Accept possible redirect to the same domain variant
    try { await page.waitForURL(/starsports\.bet/i, { timeout: 15000 }); } catch {}

    // Cookiebot consent
    const consentSelectors = [
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button:has-text("Allow all")',
      '#CybotCookiebotDialogBodyButtonAccept',
      'button:has-text("Accept")',
      '#CybotCookiebotDialogBodyButtonDecline'
    ];
    for (const sel of consentSelectors) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 })) {
          if (debug) console.log(`[snapshot:starsports] consent click ${sel}`);
          await el.click({ timeout: 1500 });
          break;
        }
      } catch {}
    }

    await page.waitForTimeout(800);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for any core selectors
    const coreSelectors = [
      'div[class*="EventRowHeader"]',
      'li[class*="SelectionsGroupLiItem"]',
      'div[class*="SelectionsGroupName"]'
    ];
    let ready = false;
    for (const sel of coreSelectors) {
      try { await page.waitForSelector(sel, { timeout: 15000 }); ready = true; break; } catch {}
    }
    if (!ready) await page.waitForTimeout(1500);

    // Expand collapsed groups (pure JS)
    const expanded = await page.evaluate(() => {
      const headers = Array.from(document.querySelectorAll('div[class*="MarketHeaderContent"], h4[class*="MarketHeaderContent"]'));
      let clicks = 0;
      for (const h of headers) {
        const aria = h.getAttribute('aria-expanded');
        const parent = h && h.parentElement ? h.parentElement.parentElement : null;
        const wrap = parent ? parent.querySelector('div[class*="SelectionsGroupWrap"]') : null;
        const styleDisplay = wrap && wrap.style ? wrap.style.display : null;
        const hidden = wrap && (wrap.getAttribute('hidden') !== null || styleDisplay === 'none');
        if (aria === 'false' || hidden) {
          if (h && typeof h.click === 'function') h.click();
          clicks++;
        }
      }
      return clicks;
    }).catch(() => 0);
    if (debug) console.log(`[snapshot:starsports] expanded groups: ${expanded}`);

    // Scroll to bottom
    let lastHeight = 0;
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(400);
      const h = await page.evaluate(() => document.body.scrollHeight);
      if (h === lastHeight) break;
      lastHeight = h;
    }

    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');

    if (config?.snapshots?.saveScreenshot) {
      try { await page.screenshot({ path: pngPath, fullPage: true }); } catch {}
    }
    if (debug) console.log(`[snapshot:starsports] wrote ${htmlPath}${config?.snapshots?.saveScreenshot ? ' & screenshot' : ''}`);

    return { htmlPath, screenshotPath: fss.existsSync(pngPath) ? pngPath : null, metaPath: null };
  } finally {
    await context.close();
    await browser.close();
  }
}
