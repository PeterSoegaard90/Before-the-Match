// Tager et skærmbillede af en side (headless Chromium med WebGL via SwiftShader).
// Brug: node tests/shot.mjs <url> <ud.png> [ventetid-ms] [bredde] [højde]
import { chromium } from 'playwright';

const [url, out, wait = '4000', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }).catch(() => console.log('timeout waiting for __ready'));
await page.waitForTimeout(+wait);
const info = await page.evaluate(() => (window.__info ? JSON.stringify(window.__info().render) : null));
if (info) console.log('render info', info);
await page.screenshot({ path: out });
await browser.close();
console.log('skrev', out);
