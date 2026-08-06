import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 760 } });
p.on('console', m => console.log(m.text()));
p.on('pageerror', e => console.log('ERR ' + e.message));
await p.goto(process.argv[2], { waitUntil: 'networkidle' });
await p.waitForTimeout(1200);
await p.screenshot({ path: process.argv[3], fullPage: true });
await b.close();
