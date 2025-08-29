// lib/antibot/browserFactory.js
import { chromium } from 'playwright';

/**
 * Centralised Playwright browser/context with light stealth defaults.
 * No proxies required; if you later set PROXY_URL we’ll pass it through.
 */
export async function createBrowserContext(opts = {}) {
  const {
    headless = true,
    proxyUrl = process.env.PROXY_URL || '',
    timezoneId = 'Europe/London',
    locale = 'en-GB',
    viewport = { width: 1366, height: 900 },
    userAgent = pickUA('desktop'),
  } = opts;

  const browser = await chromium.launch({
    headless,
    proxy: proxyUrl ? { server: proxyUrl } : undefined,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
      '--lang=en-GB',
    ],
  });

  const context = await browser.newContext({
    viewport,
    timezoneId,
    locale,
    userAgent,
  });

  // Light stealth: webdriver flag, window.chrome, permissions quirk, plugins/hardware hints.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Minimal window.chrome surface
    if (!window.chrome) window.chrome = { runtime: {} };

    // Permissions: make notifications look denied (common on desktops)
    const originalQuery = navigator.permissions?.query?.bind(navigator.permissions);
    if (originalQuery) {
      navigator.permissions.query = (parameters) => {
        if (parameters && parameters.name === 'notifications') {
          return Promise.resolve({ state: 'denied' });
        }
        return originalQuery(parameters);
      };
    }

    // Plugins/fake concurrency (soften extreme values)
    try {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'] });
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    } catch {}
  });

  // Default headers for all pages in this context
  await context.setExtraHTTPHeaders({
    'Accept-Language': 'en-GB,en;q=0.9',
    'Upgrade-Insecure-Requests': '1',
    DNT: '1',
  });

  async function newPage() {
    const page = await context.newPage();
    // Small jitter in viewport height helps some sites that key off exact sizes
    const vh = viewport.height + Math.floor(Math.random() * 21) - 10; // ±10px
    await page.setViewportSize({ width: viewport.width, height: Math.max(720, vh) });
    return page;
  }

  return {
    browser,
    context,
    newPage,
    close: async () => {
      try { await context.close(); } catch {}
      try { await browser.close(); } catch {}
    },
  };
}

// Simple UA picker (extendable later; keep it small for MVP)
function pickUA(kind = 'desktop') {
  if (kind === 'mobile') {
    return 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
  }
  // Desktop Chrome on Windows (very common & stable)
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
}

export default createBrowserContext;