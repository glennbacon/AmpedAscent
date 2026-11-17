// Mobile (touch) screenshot: node tools/shotm.mjs out.png "query" wait
import { createRequire } from 'node:module';
// Playwright is not a project dependency: use a local install if present, else the machine-wide one.
let require = createRequire(import.meta.url);
try { require.resolve('playwright'); } catch { require = createRequire(process.env.PLAYWRIGHT_DIR ?? '/opt/node-tools/node_modules/'); }
const { chromium, devices } = require('playwright');
const [out, query = '', wait = '3000', land = '1'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const dev = land === '1' ? devices['iPhone 13 landscape'] : devices['iPhone 13'];
const ctx = await browser.newContext({ ...dev, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto(`http://localhost:5173/?${query}`, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
console.log(errs.join('\n'));
await browser.close();
