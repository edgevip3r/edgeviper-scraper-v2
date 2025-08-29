// lib/antibot/consent.js

/**
 * Clicks a cookie/consent button if present.
 * Tries provided selectors on the main frame, then on any iframes.
 * Non-fatal: returns false if nothing was clicked.
 *
 * @param {import('playwright').Page} page
 * @param {string[]} selectors
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true if a click happened
 */
export async function acceptConsent(page, selectors = [], timeoutMs = 8000) {
  const perTry = Math.max(500, Math.floor(timeoutMs / Math.max(1, selectors.length)));

  // 1) Try on the main frame
  for (const sel of selectors) {
    const ok = await tryClick(page, sel, perTry);
    if (ok) return true;
  }

  // 2) Try on iframes (common for OneTrust/CMP)
  const frames = page.frames();
  for (const frame of frames) {
    if (frame === page.mainFrame()) continue;
    for (const sel of selectors) {
      const ok = await tryClick(frame, sel, perTry);
      if (ok) return true;
    }
  }

  return false;
}

async function tryClick(target, selector, timeoutMs) {
  try {
    const el = await target.waitForSelector(selector, { timeout: timeoutMs, state: 'visible' });
    if (!el) return false;
    await el.click({ delay: 20 });
    // small settle
    await target.waitForTimeout(300);
    return true;
  } catch {
    return false;
  }
}