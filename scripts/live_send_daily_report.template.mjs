import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

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
    return createRequire(path.join(bundledModules, "package.json"))("playwright");
  }
}

if (process.env.YCRM_DAILY_REPORT_LIVE_SEND !== "1") {
  throw new Error("Live daily-report send is locked. Set YCRM_DAILY_REPORT_LIVE_SEND=1 only after explicit user approval.");
}

const planPath = process.argv[2] || "work/daily_report_send/daily_report_send_plan.json";
const plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
if (plan.liveSendGate?.liveSendEnabled !== true) {
  throw new Error("Plan liveSendGate.liveSendEnabled is false. Regenerate an approved live plan before sending.");
}
if (plan.status === "blocked" || (plan.blockers || []).length) {
  throw new Error(`Plan is blocked: ${(plan.blockers || []).join(", ")}`);
}

const { chromium } = loadPlaywright();
const profileDir = process.env.YCRM_PROFILE_DIR || ".ycrm-chrome-profile";
const chromeExe = process.env.YCRM_CHROME_EXE || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const labels = {
  edit: "编辑",
  save: "保存",
  send: "发送",
  sendGroup: "发送给群组",
  participants: "与会人员",
  target: "目标",
  actual: "实际完成情况",
  follow: "待跟进事项",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formItem(page, label) {
  return page.locator(".el-form-item:visible").filter({
    has: page.locator(".el-form-item__label:visible").filter({
      hasText: new RegExp(`^\\s*${escapeRegex(label)}\\s*$`),
    }),
  }).first();
}

async function clickExactButton(page, text) {
  return await page.evaluate((targetText) => {
    function visible(el) {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    }
    const candidates = [...document.querySelectorAll("button")].filter((el) => {
      const label = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
      return visible(el) && label === targetText;
    });
    const target = candidates[candidates.length - 1];
    if (!target) return { clicked: false, reason: `no visible exact button: ${targetText}` };
    target.click();
    return { clicked: true, count: candidates.length };
  }, text);
}

async function ycrmPost(page, url, body) {
  return await page.evaluate(async ({ fetchUrl, fetchBody }) => {
    const requestUrl = fetchUrl.startsWith("http") ? fetchUrl : `https://ycrm.yealink-inc.com${fetchUrl}`;
    const res = await fetch(requestUrl, {
      method: "POST",
      headers: { "content-type": "application/json;charset=UTF-8" },
      body: JSON.stringify(fetchBody),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`YCRM POST failed: ${res.status} ${text.slice(0, 300)}`);
    }
  }, { fetchUrl: url, fetchBody: body });
}

async function fetchLatestReports(page) {
  const json = await ycrmPost(page, "/ycrm/daily-report-basic-management/page/data", {
    sceneBaseId: 1431,
    sceneCode: "SCENE_NAME_ALL",
    sceneName: "全部",
    module: "DAILY_MODULE_DAILY",
    skip: 0,
    limit: 100,
    cfgFilterCustomSceneDetails: [],
    cfgFilterCustomExpressionDetails: [],
    searchKey: "",
    orderBys: [{ columnId: 937, order: -1 }],
    timeZone: "Asia/Shanghai",
    whetherNeedCfgFilter: false,
    statusList: [],
    recordTypeList: [],
    dateList: [],
    dateFilter: "daterange",
  });
  return json?.data?.data || [];
}

async function fillSelectByLabel(page, label, optionText) {
  const item = formItem(page, label);
  await item.locator("input.el-input__inner, .el-select").first().click({ timeout: 15000, force: true });
  await sleep(700);
  await page
    .locator(".el-select-dropdown:visible .el-select-dropdown__item:not(.is-disabled)")
    .filter({ hasText: optionText })
    .first()
    .click({ timeout: 15000 });
  await page.keyboard.press("Escape").catch(() => {});
}

async function fillTextByLabel(page, label, value) {
  const item = formItem(page, label);
  await item.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const target = item.locator("textarea.el-textarea__inner, input.el-input__inner").first();
  await target.fill(value, { timeout: 15000 });
}

async function fillRichByLabel(page, label, value) {
  const item = formItem(page, label);
  await item.scrollIntoViewIfNeeded({ timeout: 8000 }).catch(() => {});
  const editor = item.locator('[contenteditable="true"][role="textarea"], [contenteditable="true"], .ql-editor').first();
  await editor.click({ timeout: 15000 });
  await editor.fill(value, { timeout: 30000 }).catch(async () => {
    await editor.evaluate((el, text) => {
      el.innerText = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
  });
}

async function main() {
  const launchOptions = {
    headless: process.env.YCRM_HEADLESS === "1",
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
    slowMo: 60,
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (fs.existsSync(chromeExe)) launchOptions.executablePath = chromeExe;

  const context = await chromium.launchPersistentContext(profileDir, launchOptions);
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto(plan.report.reportUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
    const rows = await fetchLatestReports(page);
    const report = rows.find((row) => row.dailyReportId === plan.report.reportId);
    if (!report) throw new Error(`Daily report not found: ${plan.report.reportId}`);
    if (plan.report.reportNo && report.dailyReportNo !== plan.report.reportNo) {
      throw new Error(`Report number mismatch: expected ${plan.report.reportNo}, got ${report.dailyReportNo}`);
    }

    const edit = await clickExactButton(page, labels.edit);
    if (!edit.clicked) throw new Error(`Edit button not found: ${edit.reason}`);
    await sleep(1200);

    if (plan.draftFields.sendGroup) await fillSelectByLabel(page, labels.sendGroup, plan.draftFields.sendGroup);
    if (plan.draftFields.participants) await fillTextByLabel(page, labels.participants, plan.draftFields.participants);
    await fillRichByLabel(page, labels.target, plan.draftFields.target);
    await fillRichByLabel(page, labels.actual, plan.draftFields.actual);
    await fillRichByLabel(page, labels.follow, plan.draftFields.follow);

    const save = await clickExactButton(page, labels.save);
    if (!save.clicked) throw new Error(`Save button not found: ${save.reason}`);
    await sleep(5000);

    const refreshed = (await fetchLatestReports(page)).find((row) => row.dailyReportId === plan.report.reportId);
    if (!refreshed || refreshed.formIsComplete !== 1) throw new Error("Report is not complete after save; send blocked.");

    await page.goto(plan.report.reportUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(5000);
    const send = await clickExactButton(page, labels.send);
    if (!send.clicked) throw new Error(`Send button not found: ${send.reason}`);
    await sleep(3000);
    const confirm = await clickExactButton(page, labels.send);
    if (!confirm.clicked) throw new Error(`Confirm send button not found: ${confirm.reason}`);
    await sleep(5000);
  } finally {
    await context.close().catch(() => {});
  }
}

await main();
