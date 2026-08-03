#!/usr/bin/env node
/**
 * Headless load + screenshot for the Vite dev server.
 * Usage: node scripts/browser-smoke.mjs [url] [out.png]
 * Exit 0 on success, 1 on navigation failure, 2 if console errors.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const url = process.argv[2] || "http://127.0.0.1:8080/";
const outPng = process.argv[3] || join(root, "screenshots", "smoke.png");
const timeoutMs = Number(process.env.BROWSER_SMOKE_TIMEOUT_MS || 45000);

mkdirSync(dirname(outPng), { recursive: true });

const consoleErrors = [];
const pageErrors = [];

const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(String(err?.message || err)));

  const resp = await page.goto(url, { waitUntil: "networkidle", timeout: timeoutMs });
  const status = resp?.status() ?? 0;
  await page.waitForTimeout(1000);

  const title = await page.title();
  const hasCanvas = (await page.locator("canvas").count()) > 0;
  await page.screenshot({ path: outPng, fullPage: false });

  console.log(
    JSON.stringify(
      {
        ok: status >= 200 && status < 400,
        status,
        title,
        hasCanvas,
        outPng,
        consoleErrors,
        pageErrors,
      },
      null,
      2,
    ),
  );

  if (status < 200 || status >= 400) process.exit(1);
  if (pageErrors.length) process.exit(2);
} finally {
  await browser.close();
}
