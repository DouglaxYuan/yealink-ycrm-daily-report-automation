import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

function loadPlaywright() {
  const localRequire = createRequire(import.meta.url);
  try {
    return localRequire("playwright");
  } catch {
    const bundledModules = path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules",
    );
    const bundledRequire = createRequire(path.join(bundledModules, "package.json"));
    return bundledRequire("playwright");
  }
}

const { chromium } = loadPlaywright();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = process.env.YCRM_PROFILE_DIR || path.join(repoRoot, ".ycrm-chrome-profile");
const chromeExe = process.env.YCRM_CHROME_EXE || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const dailyReportUrl = process.env.YCRM_DAILY_REPORT_URL || "https://ycrm.yealink-inc.com/portal/evection/record";
const apiPath = process.env.YCRM_DAILY_REPORT_SUBMIT_API || "";
const payloadPath = process.argv[2] || path.join(repoRoot, "examples", "daily_report_payload.example.json");

if (!apiPath) {
  throw new Error("Set YCRM_DAILY_REPORT_SUBMIT_API to the internal YCRM daily-report submit endpoint before running this template.");
}

const payload = JSON.parse(await fs.readFile(payloadPath, "utf8"));
const launchOptions = {
  headless: process.env.YCRM_HEADLESS === "1",
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  slowMo: 10,
  args: ["--disable-blink-features=AutomationControlled"],
};
if (fsSync.existsSync(chromeExe)) launchOptions.executablePath = chromeExe;

const context = await chromium.launchPersistentContext(profileDir, launchOptions);
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(30000);

try {
  await page.goto(dailyReportUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const response = await page.evaluate(async ({ apiPath: path, payload: body }) => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return { ok: res.ok, status: res.status, json, text: json ? undefined : text };
  }, { apiPath, payload });
  console.log(JSON.stringify(response, null, 2));
} finally {
  await context.close();
}
