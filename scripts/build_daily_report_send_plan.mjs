import fs from "node:fs";
import path from "node:path";

const DETAIL_RE = /\/record\/detail\/([0-9a-fA-F]+)/;
const DEFAULT_SEND_GROUP = "vcs.cn.trip@yealink.com";

const inputPath = process.argv[2] || "examples/daily_report_send_input.example.json";
const outputDir = process.argv[3] || "work/daily_report_send";
const plan = buildPlan(inputPath, outputDir);
console.log(JSON.stringify(plan.summary, null, 2));

function buildPlan(sourceInput, outDir) {
  const draft = JSON.parse(fs.readFileSync(sourceInput, "utf8"));
  fs.mkdirSync(outDir, { recursive: true });
  const report = reportIdentity(draft);
  const fields = draftFields(draft);
  const blockers = blockersFor(report, fields);
  const actions = plannedActions(report, fields);
  const plan = {
    schemaVersion: 1,
    mode: "daily_report_send_plan",
    status: blockers.length ? "blocked" : "ready_for_explicit_live_send",
    createdAt: new Date().toISOString(),
    sourceInput,
    report,
    draftFields: fields,
    dailyReportActions: actions,
    blockers,
    liveSendGate: {
      gateStatus: "locked",
      liveSendEnabled: false,
      requiredRuntimeEnv: "YCRM_DAILY_REPORT_LIVE_SEND=1",
      requiredUserApproval: "explicit approval in the active Codex thread before live save/send",
      blockers: [
        "explicit_live_send_approval_missing",
        "runtime_live_send_env_missing",
      ],
    },
    outputs: {
      planJson: path.join(outDir, "daily_report_send_plan.json"),
      previewHtml: path.join(outDir, "daily_report_send_preview.html"),
    },
    summary: {
      requiredDraftFieldsFilled: ["target", "actual", "follow"].filter((key) => fields[key]).length,
      hasReportId: Boolean(report.reportId),
      hasReportUrl: Boolean(report.reportUrl),
      plannedActions: actions.length,
      writeAttempted: false,
      saveAttempted: false,
      sendAttempted: false,
      liveSendEnabled: false,
    },
    writeAttempted: false,
    saveAttempted: false,
    sendAttempted: false,
  };
  fs.writeFileSync(path.join(outDir, "daily_report_send_plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outDir, "daily_report_send_preview.html"), previewHtml(plan), "utf8");
  return plan;
}

function reportIdentity(draft) {
  let reportUrl = clean(draft.reportUrl || draft.url || draft.dailyReportUrl);
  let reportId = clean(draft.reportId || draft.dailyReportId);
  if (!reportId && reportUrl) {
    const match = reportUrl.match(DETAIL_RE);
    if (match) reportId = match[1];
  }
  if (reportId && !reportUrl) {
    reportUrl = `https://ycrm.yealink-inc.com/portal/evection/record/detail/${reportId}`;
  }
  return {
    reportUrl,
    reportId,
    reportNo: clean(draft.reportNo || draft.dailyReportNo),
    signInId: clean(draft.signInId),
    reportDate: clean(draft.reportDate || draft.date),
    customerName: clean(draft.customerName || draft.customer),
    workType: clean(draft.workType),
  };
}

function draftFields(draft) {
  return {
    sendGroup: clean(draft.sendGroup || draft.sendGroupText || DEFAULT_SEND_GROUP),
    participants: clean(draft.participants || draft.attendees || draft.meetingPeople),
    target: clean(draft.target || draft.goal || draft.reportTarget),
    actual: clean(draft.actual || draft.actualCompletion || draft.actualPerformance),
    follow: clean(draft.follow || draft.followUp || draft.unfollowedMatter),
    contactKeyword: clean(draft.contactKeyword),
  };
}

function blockersFor(report, fields) {
  const blockers = [];
  if (!report.reportId) blockers.push("missing_report_id_or_detail_url");
  for (const key of ["target", "actual", "follow"]) {
    if (!fields[key]) blockers.push(`missing_required_field:${key}`);
  }
  if (!fields.sendGroup) blockers.push("missing_send_group");
  return blockers;
}

function plannedActions(report, fields) {
  const reportId = report.reportId || "<reportId>";
  return [
    {
      id: "login_check",
      meaning: "Reuse a local authorized YCRM browser profile and verify login state.",
      stateChanging: false,
    },
    {
      id: "open_daily_report_detail",
      meaning: "Open the target daily report detail page.",
      url: `https://ycrm.yealink-inc.com/portal/evection/record/detail/${reportId}`,
      stateChanging: false,
    },
    {
      id: "verify_report_identity",
      meaning: "Verify reportId, reportNo, signInId, and reportDate before editing.",
      checks: {
        reportId: report.reportId,
        reportNo: report.reportNo,
        signInId: report.signInId,
        reportDate: report.reportDate,
      },
      stateChanging: false,
    },
    {
      id: "click_edit",
      meaning: "Click the YCRM daily report edit button.",
      buttonText: "编辑",
      stateChanging: false,
    },
    {
      id: "fill_report_fields",
      meaning: "Fill send group, participants, target, actual completion, and follow-up fields.",
      fields,
      stateChanging: true,
      writeAttemptedInPlan: false,
    },
    {
      id: "save_form",
      meaning: "Click save only when the live-send gate is explicitly opened.",
      buttonText: "保存",
      stateChanging: true,
      saveAttemptedInPlan: false,
    },
    {
      id: "verify_form_complete",
      meaning: "Read back the daily report; require form completion before sending.",
      stateChanging: false,
    },
    {
      id: "click_send",
      meaning: "Click send only when the live-send gate is explicitly opened.",
      buttonText: "发送",
      stateChanging: true,
      sendAttemptedInPlan: false,
    },
  ];
}

function previewHtml(plan) {
  const rows = plan.dailyReportActions
    .map((item) => `<tr><td>${html(item.id)}</td><td>${html(item.meaning)}</td><td>${html(String(item.stateChanging))}</td></tr>`)
    .join("\n");
  const blockers = plan.blockers.map((item) => `<li>${html(item)}</li>`).join("") || "<li>none</li>";
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YCRM Daily Report Send Plan</title>
  <style>
    body { margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f6f8fb; color: #172033; }
    main { max-width: 1080px; margin: 0 auto; padding: 24px; }
    section { background: #fff; border: 1px solid #d8e0ea; border-radius: 8px; padding: 16px; margin: 14px 0; }
    dl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 12px; margin: 0; }
    dt { font-weight: 700; color: #465568; }
    dd { margin: 0; overflow-wrap: anywhere; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #d8e0ea; padding: 9px; text-align: left; vertical-align: top; }
    th { background: #edf3f9; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: Segoe UI, Arial, sans-serif; }
    .gate { color: #9a3412; font-weight: 700; }
  </style>
</head>
<body>
<main>
  <h1>YCRM Daily Report Send Plan</h1>
  <p class="gate">Local preview only. writeAttempted=false, saveAttempted=false, sendAttempted=false.</p>
  <section>
    <h2>Report</h2>
    <dl>
      <dt>status</dt><dd>${html(plan.status)}</dd>
      <dt>reportUrl</dt><dd>${html(plan.report.reportUrl)}</dd>
      <dt>reportId</dt><dd>${html(plan.report.reportId)}</dd>
      <dt>reportNo</dt><dd>${html(plan.report.reportNo)}</dd>
      <dt>signInId</dt><dd>${html(plan.report.signInId)}</dd>
      <dt>reportDate</dt><dd>${html(plan.report.reportDate)}</dd>
    </dl>
  </section>
  <section>
    <h2>Draft Fields</h2>
    <dl>
      <dt>sendGroup</dt><dd>${html(plan.draftFields.sendGroup)}</dd>
      <dt>participants</dt><dd>${html(plan.draftFields.participants)}</dd>
      <dt>target</dt><dd><pre>${html(plan.draftFields.target)}</pre></dd>
      <dt>actual</dt><dd><pre>${html(plan.draftFields.actual)}</pre></dd>
      <dt>follow</dt><dd><pre>${html(plan.draftFields.follow)}</pre></dd>
    </dl>
  </section>
  <section><h2>Blockers</h2><ul>${blockers}</ul></section>
  <section>
    <h2>Actions</h2>
    <table><thead><tr><th>ID</th><th>Meaning</th><th>State changing</th></tr></thead><tbody>${rows}</tbody></table>
  </section>
</main>
</body>
</html>
`;
}

function clean(value) {
  return value == null ? "" : String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function html(value) {
  return clean(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
