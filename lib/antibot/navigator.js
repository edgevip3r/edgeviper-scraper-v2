// lib/antibot/navigator.js
import { acceptConsent } from './consent.js';

/**
 * Run a small, declarative sequence of actions against a Playwright page.
 * Supports: goto, consent, waitForText, waitForSelector, scrollToBottom, clickWhileAppears, sleep, screenshot.
 *
 * @param {import('playwright').Page} page
 * @param {Array<Object>} steps - list of step objects (see handlers below)
 * @param {Object} opts
 * @param {string[]} [opts.baseUrls] - used when a step provides { urlRef: <index> }
 * @param {function}  [opts.onScreenshot] - async (page, label) => path or void
 */
export async function runSteps(page, steps = [], opts = {}) {
  const { baseUrls = [], onScreenshot } = opts || {};
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] || {};
    const label = s.label || `${i}:${s.action || 'unknown'}`;
    try {
      switch ((s.action || '').toLowerCase()) {
        case 'goto': {
          const url = s.url ?? (Number.isInteger(s.urlRef) ? baseUrls[s.urlRef] : undefined);
          if (!url) throw new Error('goto: url (or urlRef) required');
          await page.goto(url, { waitUntil: s.waitUntil || 'domcontentloaded', timeout: s.timeoutMs ?? 30000 });
          break;
        }
        case 'consent': {
          const selectors = s.selectors || opts.consentSelectors || [];
          if (selectors.length) await acceptConsent(page, selectors, s.timeoutMs ?? 8000);
          break;
        }
        case 'waitfortext': {
          if (!s.any || !Array.isArray(s.any) || !s.any.length) throw new Error('waitForText: any[] required');
          await waitForTextAny(page, s.any, s.timeoutMs ?? 15000);
          break;
        }
        case 'waitforselector': {
          if (!s.selector) throw new Error('waitForSelector: selector required');
          await page.waitForSelector(s.selector, { timeout: s.timeoutMs ?? 15000, state: s.state || 'visible' });
          break;
        }
        case 'scrolltobottom': {
          await scrollToBottom(page, {
            tickMs: s.tickMs ?? 400,
            untilNoChangeMs: s.untilNoChangeMs ?? 800,
            maxTicks: s.maxTicks ?? 200
          });
          break;
        }
        case 'clickwhileappears': {
          if (!s.selector) throw new Error('clickWhileAppears: selector required');
          await clickWhileAppears(page, s.selector, {
            max: s.max ?? 10,
            delayMs: s.delayMs ?? 600,
            waitAfterMs: s.waitAfterMs ?? 600
          });
          break;
        }
        case 'sleep': {
          await page.waitForTimeout(s.ms ?? 500);
          break;
        }
        case 'screenshot': {
          if (typeof onScreenshot === 'function') {
            await onScreenshot(page, s.name || label);
          } else {
            await page.screenshot({ path: s.path || undefined, fullPage: !!s.fullPage });
          }
          break;
        }
        default: {
          throw new Error(`Unknown action: ${s.action}`);
        }
      }
    } catch (err) {
      err.message = `[navigator step ${label}] ${err.message}`;
      throw err;
    }
  }
}

/** Wait until any of the provided strings appears in the page text (case-insensitive). */
export async function waitForTextAny(page, needles, timeoutMs = 15000) {
  const lower = needles.map((s) => String(s).toLowerCase());
  await page.waitForFunction(
    (targets) => {
      const txt = (document.body?.innerText || '').toLowerCase();
      return targets.some((t) => txt.includes(t));
    },
    lower,
    { timeout: timeoutMs }
  );
}

/** Smoothly scroll to bottom until height stops changing for a quiet window. */
export async function scrollToBottom(page, { tickMs = 400, untilNoChangeMs = 800, maxTicks = 200 } = {}) {
  let prev = await page.evaluate(() => document.body.scrollHeight);
  let stableFor = 0;
  for (let i = 0; i < maxTicks; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(tickMs);
    const now = await page.evaluate(() => document.body.scrollHeight);
    if (now === prev) {
      stableFor += tickMs;
      if (stableFor >= untilNoChangeMs) break;
    } else {
      stableFor = 0;
      prev = now;
    }
  }
}

/** Click a button as long as it keeps appearing (e.g., “Show more”). */
export async function clickWhileAppears(page, selector, { max = 10, delayMs = 600, waitAfterMs = 600 } = {}) {
  let clicks = 0;
  for (; clicks < max; clicks++) {
    const el = await page.$(selector);
    if (!el) break;
    try {
      await el.click({ delay: 20 });
    } catch {
      break;
    }
    await page.waitForTimeout(waitAfterMs);
    // small scroll bump helps lazy loaders
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.5)));
    await page.waitForTimeout(delayMs);
  }
  return clicks;
}

export default runSteps;