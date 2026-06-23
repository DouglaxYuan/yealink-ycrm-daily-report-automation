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
const outDir = process.env.YCRM_DAILY_REPORT_OUT_DIR || path.join(repoRoot, "work", "ycrm_daily_reports");
const chromeExe = process.env.YCRM_CHROME_EXE || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const targetUrl = "https://ycrm.yealink-inc.com/portal/evection/record";

await fs.mkdir(outDir, { recursive: true });

const launchOptions = {
  headless: false,
  viewport: { width: 1440, height: 900 },
  locale: "zh-CN",
  slowMo: 10,
  args: ["--disable-blink-features=AutomationControlled"],
};
if (fsSync.existsSync(chromeExe)) launchOptions.executablePath = chromeExe;

const context = await chromium.launchPersistentContext(profileDir, launchOptions);
const page = context.pages()[0] || await context.newPage();
page.setDefaultTimeout(30000);

async function ycrmFetch(request) {
  return await page.evaluate(async (req) => {
    const response = await fetch(req.url, {
      method: req.method || "GET",
      headers: { "content-type": "application/json", ...(req.headers || {}) },
      body: req.body == null ? undefined : JSON.stringify(req.body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {}
    return {
      status: response.status,
      ok: response.ok,
      url: response.url,
      json,
      text: json ? undefined : text,
    };
  }, request);
}

function compactRow(row) {
  const simpleKeys = Object.keys(row).filter((key) => /Simple$/.test(key) && row[key]);
  const simpleFields = {};
  for (const key of simpleKeys) simpleFields[key] = row[key];
  return {
    dailyReportId: row.dailyReportId,
    dailyReportNo: row.dailyReportNo,
    baseType: row.baseType,
    workType: row.workType,
    visitDate: row.visitDate,
    createTime: row.createTime,
    updateTime: row.updateTime,
    customerName: row.customerName || row.osAgentCustomerName,
    projectName: row.projectName,
    projectId: row.projectId,
    reportTarget: row.reportTargeSimple || row.reportTarget,
    unfollowedMatter: row.reportUnFollowedMatterSimple || row.reportUnFollowedMatter,
    actualPerformance: row.reportActualPerformanceSimple || row.reportActualPerformance,
    risk: row.reportRickSimple || row.reportRick,
    businessProgress: row.businessProgressSimple || row.businessProgress,
    technicalProgress: row.technicalProgressSimple || row.technicalProgress,
    completeSummary: row.osReportCompleteSummSimple || row.osReportCompleteSumm,
    competitorSituation: row.osReportCompetitorSituSimple || row.osReportCompetitorSitu,
    productRequirement: row.osReportProductReqSimple || row.osReportProductReq,
    activityProgress: row.osActivityProgressSimple || row.osActivityProgress,
    customerAttendance: row.osCustomerAttendanceSimple || row.osCustomerAttendance,
    customerQuality: row.osCustomerQualitySimple || row.osCustomerQuality,
    partnersCommunication: row.osPartnersCommunicationSimple || row.osPartnersCommunication,
    techExchangeAndReport: row.techExchangeAndReportSimple || row.techExchangeAndReport,
    informationGathering: row.informationGatheringSimple || row.informationGathering,
    otherExplain: row.otherExplainSimple || row.otherExplain,
    simpleFields,
  };
}

await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => {});
await page.waitForTimeout(8000);

const limit = 100;
const baseRequest = {
  sceneBaseId: 1431,
  sceneCode: "SCENE_NAME_ALL",
  sceneName: "全部",
  module: "DAILY_MODULE_DAILY",
  skip: 0,
  limit,
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
};

const rows = [];
const pages = [];
const seen = new Set();
for (let skip = 0; skip <= 900; skip += limit) {
  const body = { ...baseRequest, skip, limit };
  const response = await ycrmFetch({
    method: "POST",
    url: "/ycrm/daily-report-basic-management/page/data",
    body,
  });
  const pageRows = response.json?.data?.data || [];
  pages.push({
    skip,
    limit,
    status: response.status,
    ret: response.json?.ret,
    rowCount: pageRows.length,
  });
  for (const row of pageRows) {
    const key = row.dailyReportId || row.dailyReportNo || JSON.stringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(row);
  }
  if (pageRows.length < limit) break;
}

const compactRows = rows.map(compactRow);
const result = {
  generatedAt: new Date().toISOString(),
  currentUrl: page.url(),
  title: await page.title().catch(() => ""),
  pages,
  rowCount: rows.length,
  rawRows: rows,
  reports: compactRows,
};

await fs.writeFile(path.join(outDir, "daily_reports_raw.json"), JSON.stringify(result, null, 2), "utf8");
await fs.writeFile(path.join(outDir, "daily_reports_compact.json"), JSON.stringify({
  generatedAt: result.generatedAt,
  rowCount: result.rowCount,
  pages,
  reports: compactRows,
}, null, 2), "utf8");

console.log(JSON.stringify({
  generatedAt: result.generatedAt,
  currentUrl: result.currentUrl,
  title: result.title,
  rowCount: result.rowCount,
  pages,
  outputDir: outDir,
}, null, 2));

await context.close();
