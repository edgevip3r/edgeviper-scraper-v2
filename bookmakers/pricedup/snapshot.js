// Snapshot PricedUp boosts (football) using Playwright.
// Signature matches pipelines/run.snapshot.js expectations.
// - Navigates to baseUrls[0] from data/bookmakers/pricedup.json
// - Handles Cookiebot consent
// - Expands collapsed sections and "More" groups
// - Scrolls to bottom to ensure content is hydrated
// - Saves HTML (+ optional screenshot via config.snapshots.saveScreenshot)

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

/** Click all "More" expanders in PricedUp lists. */
async function expandAllMoreSections(page, { maxPasses = 6, debug = true } = {}) {
  for (let pass = 1; pass <= maxPasses; pass++) {
    const moreLocator = page
      .locator('div[class*="MoreLessGroup"] :is(button[class*="LinkMoreLessWrapper"], a[class*="LinkMoreLessWrapper"])')
      .filter({ hasText: /\bMore\b/i });

    const count = await moreLocator.count().catch(() => 0);
    if (debug) console.log(`[snapshot:pricedup] pass ${pass}: ${count} "More" button(s) found`);
    if (count === 0) break;

    for (let i = 0; i < count; i++) {
      const btn = moreLocator.nth(i);
      try {
        await btn.scrollIntoViewIfNeeded();
        await btn.waitFor({ state: 'visible', timeout: 2000 });
        await btn.click();
        // Allow React to render extra rows
        await page.waitForTimeout(250);
      } catch (err) {
        console.warn('[snapshot:pricedup] expand click failed:', err?.message || err);
      }
    }

    // Let any network/rendering settle, then loop again to catch newly revealed "More" buttons
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(250);
  }
}

/** Expand collapsed market groups whose content is hidden. */
async function expandCollapsedGroups(page, { debug = true } = {}) {
  const expanded = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('div[class*="MarketHeaderContent"], h4[class*="MarketHeaderContent"]'));
    let clicks = 0;
    for (const h of headers) {
      const aria = h.getAttribute('aria-expanded');
      const wrap = h.parentElement?.parentElement?.querySelector('div[class*="SelectionsGroupWrap"]');
      const hidden = wrap && (wrap.getAttribute('hidden') !== null || (wrap instanceof HTMLElement && wrap.style.display === 'none'));
      if (aria === 'false' || hidden) {
        if (h instanceof HTMLElement) h.click();
        clicks++;
      }
    }
    return clicks;
  });
  if (debug) console.log(`[snapshot:pricedup] expanded groups: ${expanded}`);
}

/** Basic auto-scroll to hydrate lazy content. */
async function autoScroll(page, { steps = 10, delayMs = 400 } = {}) {
  let lastHeight = 0;
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(delayMs);
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === lastHeight) break;
    lastHeight = h;
  }
}

export default async function snapshotPricedUp({ book, config, bookCfg, outRoot, debug }) {
  const url = (bookCfg?.baseUrls && bookCfg.baseUrls[0]) || 'https://www.pricedup.com/boosts/football';
  const { dateDir, stamp } = tsParts();
  const outDir = path.resolve(outRoot, book, dateDir);
  await fs.mkdir(outDir, { recursive: true });
  const htmlPath = path.join(outDir, `${stamp}_boosts.html`);
  const pngPath = path.join(outDir, `${stamp}_boosts.png`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();

  try {
    if (debug) console.log(`[snapshot:pricedup] goto ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

    // --- Cookiebot consent ---
    const consentSelectors = [
      '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
      'button:has-text("Allow all")',
      '#CybotCookiebotDialogBodyButtonAccept',
      'button:has-text("Accept")',
      '#CybotCookiebotDialogBodyButtonDecline',
    ];
    for (const sel of consentSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible().catch(() => false)) {
        if (debug) console.log(`[snapshot:pricedup] consent click ${sel}`);
        await el.click({ timeout: 2000 }).catch(() => {});
        break;
      }
    }

    // --- Wait for boosts to render (generic tokens) ---
    await page.waitForTimeout(800);
    await page.waitForSelector('li[class*="SelectionsGroupLiItem"], [class*="SelectionsGroupName"]', { timeout: 15000 });

    // Optional baseline count
    const before = await page.locator('li[class*="SelectionsGroupLiItem"]').count().catch(() => 0);

    // --- Expand collapsed groups & "More" expanders ---
    await expandCollapsedGroups(page, { debug });
    await expandAllMoreSections(page, { maxPasses: 6, debug });

    // --- Scroll to bottom (hydrate any lazy items), then try expand again ---
    await autoScroll(page, { steps: 10, delayMs: 400 });
    await expandAllMoreSections(page, { maxPasses: 2, debug });

    // --- Final card count ---
    const after = await page.locator('li[class*="SelectionsGroupLiItem"]').count().catch(() => before);
    if (debug) console.log(`[snapshot:pricedup] rows before: ${before} | after expand: ${after}`);

    // --- Save HTML (+ optional screenshot) ---
    const html = await page.content();
    await fs.writeFile(htmlPath, html, 'utf8');

    if (config?.snapshots?.saveScreenshot) {
      await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});
    }

    if (debug) console.log(`[snapshot:pricedup] wrote ${htmlPath}${config?.snapshots?.saveScreenshot ? ' & screenshot' : ''}`);
    return { htmlPath, screenshotPath: fss.existsSync(pngPath) ? pngPath : null, metaPath: null };
  } finally {
    await context.close();
    await browser.close();
  }
}