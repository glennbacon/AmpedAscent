// Screenshot helper: node tools/shot.mjs <out.png> "<query>" [waitMs] [width] [height]
import { createRequire } from 'node:module';
// Playwright is not a project dependency: use a local install if present, else the machine-wide one.
let require = createRequire(import.meta.url);
try { require.resolve('playwright'); } catch { require = createRequire(process.env.PLAYWRIGHT_DIR ?? '/opt/node-tools/node_modules/'); }
const { chromium } = require('playwright');
const [out, query = '', wait = '2500', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:5173/?${query}`, { waitUntil: 'load' });
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const frames = await page.evaluate(() => window.__frames ?? -1);
console.log(`frames=${frames}`, logs.slice(0, 12).join('\n'));
await browser.close();
