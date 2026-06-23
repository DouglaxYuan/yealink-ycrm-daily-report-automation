import fs from "node:fs";
import path from "node:path";

const input = JSON.parse(fs.readFileSync("work/ycrm_daily_reports/daily_reports_compact.json", "utf8"));
const reports = input.reports || [];

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function cnDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function countBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

function bulletCount(text) {
  const matches = cleanText(text).match(/(?:^|[。；;])\s*(?:\d+|[一二三四五六七八九十])、/g);
  return matches ? matches.length : 0;
}

const fields = [
  "reportTarget",
  "unfollowedMatter",
  "actualPerformance",
  "risk",
  "businessProgress",
  "technicalProgress",
  "completeSummary",
  "competitorSituation",
  "productRequirement",
  "activityProgress",
  "customerAttendance",
  "customerQuality",
  "partnersCommunication",
  "techExchangeAndReport",
  "informationGathering",
  "otherExplain",
];

const dated = reports
  .map((report) => ({ report, date: parseDate(report.visitDate || report.createTime) }))
  .filter((item) => item.date)
  .sort((a, b) => b.date - a.date);

const lengths = reports.map((report) => cleanText(report.actualPerformance).length).filter(Boolean);
const bulletCounts = reports.map((report) => bulletCount(report.actualPerformance)).filter((count) => count > 0);

const keywordList = [
  "方案", "项目", "客户", "渠道", "代理", "销售", "沟通", "跟进", "报价", "清单", "投标", "测试", "调试",
  "排查", "问题", "风险", "反馈", "需求", "预算", "点位", "拓扑", "会议室", "展厅", "赋能", "培训",
  "POC", "ProAV", "IWB", "天花", "音频", "摄像头", "麦克风", "终端", "无线", "部署", "演示", "拜访",
  "对接", "售前", "材料", "设计", "产品", "竞品", "商务", "技术", "响应", "招标", "试用", "验收",
];
const allText = reports.map((report) => fields.map((field) => cleanText(report[field])).join(" ")).join(" ");
const keywordCounts = keywordList
  .map((word) => [word, (allText.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi")) || []).length])
  .filter(([, count]) => count > 0)
  .sort((a, b) => b[1] - a[1]);

function nonEmptyFields(report) {
  return fields.filter((field) => cleanText(report[field])).map((field) => [field, cleanText(report[field])]);
}

function sampleReport(item) {
  const report = item.report || item;
  return {
    date: cnDate(report.visitDate || report.createTime),
    no: report.dailyReportNo,
    customer: report.customerName,
    target: cleanText(report.reportTarget),
    todo: cleanText(report.unfollowedMatter),
    performance: cleanText(report.actualPerformance),
    risk: cleanText(report.risk),
    extra: Object.fromEntries(nonEmptyFields(report).filter(([field]) => !["reportTarget", "unfollowedMatter", "actualPerformance", "risk"].includes(field))),
  };
}

const recentSamples = dated.slice(0, 30).map(sampleReport);
const midSamples = dated.slice(Math.floor(dated.length / 2), Math.floor(dated.length / 2) + 20).map(sampleReport);
const oldSamples = dated.slice(-20).map(sampleReport);
const longSamples = reports
  .map((report) => ({ report, len: cleanText(report.actualPerformance).length }))
  .sort((a, b) => b.len - a.len)
  .slice(0, 20)
  .map(({ report, len }) => ({ ...sampleReport(report), length: len }));

const summary = {
  generatedAt: new Date().toISOString(),
  sourceRows: reports.length,
  dateRange: {
    newest: dated[0] ? cnDate(dated[0].date) : "",
    oldest: dated.at(-1) ? cnDate(dated.at(-1).date) : "",
  },
  nonEmptyFieldCounts: fields.map((field) => [field, reports.filter((report) => cleanText(report[field])).length]),
  topCustomers: countBy(reports, (report) => report.customerName).slice(0, 30),
  topTargets: countBy(reports, (report) => cleanText(report.reportTarget)).slice(0, 30),
  workTypeCounts: countBy(reports, (report) => report.workType).slice(0, 20),
  baseTypeCounts: countBy(reports, (report) => report.baseType).slice(0, 20),
  actualPerformanceLength: {
    count: lengths.length,
    average: Math.round(lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length)),
    p25: percentile(lengths, 0.25),
    p50: percentile(lengths, 0.5),
    p75: percentile(lengths, 0.75),
    p90: percentile(lengths, 0.9),
    max: Math.max(...lengths, 0),
  },
  numberedItemCount: {
    count: bulletCounts.length,
    average: Number((bulletCounts.reduce((sum, value) => sum + value, 0) / Math.max(1, bulletCounts.length)).toFixed(2)),
    p50: percentile(bulletCounts, 0.5),
    p75: percentile(bulletCounts, 0.75),
    max: Math.max(...bulletCounts, 0),
  },
  keywords: keywordCounts.slice(0, 50),
};

const outDir = "work/ycrm_daily_reports";
fs.writeFileSync(path.join(outDir, "style_stats.json"), JSON.stringify(summary, null, 2), "utf8");
fs.writeFileSync(path.join(outDir, "style_samples.json"), JSON.stringify({
  recentSamples,
  midSamples,
  oldSamples,
  longSamples,
}, null, 2), "utf8");

console.log(JSON.stringify(summary, null, 2));
