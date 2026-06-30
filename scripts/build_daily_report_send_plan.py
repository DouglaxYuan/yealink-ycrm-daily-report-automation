from __future__ import annotations

from datetime import datetime
from html import escape
import json
import re
import sys
from pathlib import Path
from typing import Any


DETAIL_RE = re.compile(r"/record/detail/([0-9a-fA-F]+)")
DEFAULT_SEND_GROUP = "vcs.cn.trip@yealink.com"


def main(argv: list[str]) -> int:
    input_path = Path(argv[1]) if len(argv) > 1 else Path("examples/daily_report_send_input.example.json")
    output_dir = Path(argv[2]) if len(argv) > 2 else Path("work/daily_report_send")
    plan = build_plan(input_path, output_dir)
    print(json.dumps(plan["summary"], ensure_ascii=False, indent=2))
    return 0


def build_plan(input_path: Path, output_dir: Path) -> dict[str, Any]:
    draft = _load_json(input_path)
    output_dir.mkdir(parents=True, exist_ok=True)
    report = _report_identity(draft)
    fields = _draft_fields(draft)
    blockers = _blockers(report, fields)
    actions = _actions(report, fields)
    plan = {
        "schemaVersion": 1,
        "mode": "daily_report_send_plan",
        "status": "blocked" if blockers else "ready_for_explicit_live_send",
        "createdAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "sourceInput": str(input_path),
        "report": report,
        "draftFields": fields,
        "dailyReportActions": actions,
        "blockers": blockers,
        "liveSendGate": {
            "gateStatus": "locked",
            "liveSendEnabled": False,
            "requiredRuntimeEnv": "YCRM_DAILY_REPORT_LIVE_SEND=1",
            "requiredUserApproval": "explicit approval in the active Codex thread before live save/send",
            "blockers": [
                "explicit_live_send_approval_missing",
                "runtime_live_send_env_missing",
            ],
        },
        "outputs": {
            "planJson": str(output_dir / "daily_report_send_plan.json"),
            "previewHtml": str(output_dir / "daily_report_send_preview.html"),
        },
        "summary": {
            "requiredDraftFieldsFilled": sum(1 for key in ["target", "actual", "follow"] if fields.get(key)),
            "hasReportId": bool(report.get("reportId")),
            "hasReportUrl": bool(report.get("reportUrl")),
            "plannedActions": len(actions),
            "writeAttempted": False,
            "saveAttempted": False,
            "sendAttempted": False,
            "liveSendEnabled": False,
        },
        "writeAttempted": False,
        "saveAttempted": False,
        "sendAttempted": False,
    }
    _write_json(output_dir / "daily_report_send_plan.json", plan)
    _write_preview(output_dir / "daily_report_send_preview.html", plan)
    return plan


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict):
        raise ValueError("Daily report send input must be a JSON object.")
    return payload


def _report_identity(draft: dict[str, Any]) -> dict[str, str]:
    report_url = _clean(draft.get("reportUrl") or draft.get("url") or draft.get("dailyReportUrl"))
    report_id = _clean(draft.get("reportId") or draft.get("dailyReportId"))
    if not report_id and report_url:
        match = DETAIL_RE.search(report_url)
        if match:
            report_id = match.group(1)
    if report_id and not report_url:
        report_url = f"https://ycrm.yealink-inc.com/portal/evection/record/detail/{report_id}"
    return {
        "reportUrl": report_url,
        "reportId": report_id,
        "reportNo": _clean(draft.get("reportNo") or draft.get("dailyReportNo")),
        "signInId": _clean(draft.get("signInId")),
        "reportDate": _clean(draft.get("reportDate") or draft.get("date")),
        "customerName": _clean(draft.get("customerName") or draft.get("customer")),
        "workType": _clean(draft.get("workType")),
    }


def _draft_fields(draft: dict[str, Any]) -> dict[str, str]:
    return {
        "sendGroup": _clean(draft.get("sendGroup") or draft.get("sendGroupText") or DEFAULT_SEND_GROUP),
        "participants": _clean(draft.get("participants") or draft.get("attendees") or draft.get("meetingPeople")),
        "target": _clean(draft.get("target") or draft.get("goal") or draft.get("reportTarget")),
        "actual": _clean(draft.get("actual") or draft.get("actualCompletion") or draft.get("actualPerformance")),
        "follow": _clean(draft.get("follow") or draft.get("followUp") or draft.get("unfollowedMatter")),
        "contactKeyword": _clean(draft.get("contactKeyword")),
    }


def _blockers(report: dict[str, str], fields: dict[str, str]) -> list[str]:
    blockers: list[str] = []
    if not report.get("reportId"):
        blockers.append("missing_report_id_or_detail_url")
    for key in ["target", "actual", "follow"]:
        if not fields.get(key):
            blockers.append(f"missing_required_field:{key}")
    if not fields.get("sendGroup"):
        blockers.append("missing_send_group")
    return blockers


def _actions(report: dict[str, str], fields: dict[str, str]) -> list[dict[str, Any]]:
    report_id = report.get("reportId") or "<reportId>"
    return [
        {
            "id": "login_check",
            "meaning": "Reuse a local authorized YCRM browser profile and verify login state.",
            "stateChanging": False,
        },
        {
            "id": "open_daily_report_detail",
            "meaning": "Open the target daily report detail page.",
            "url": f"https://ycrm.yealink-inc.com/portal/evection/record/detail/{report_id}",
            "stateChanging": False,
        },
        {
            "id": "verify_report_identity",
            "meaning": "Verify reportId, reportNo, signInId, and reportDate before editing.",
            "checks": {
                "reportId": report.get("reportId", ""),
                "reportNo": report.get("reportNo", ""),
                "signInId": report.get("signInId", ""),
                "reportDate": report.get("reportDate", ""),
            },
            "stateChanging": False,
        },
        {
            "id": "click_edit",
            "meaning": "Click the YCRM daily report edit button.",
            "buttonText": "编辑",
            "stateChanging": False,
        },
        {
            "id": "fill_report_fields",
            "meaning": "Fill send group, participants, target, actual completion, and follow-up fields.",
            "fields": fields,
            "stateChanging": True,
            "writeAttemptedInPlan": False,
        },
        {
            "id": "save_form",
            "meaning": "Click save only when the live-send gate is explicitly opened.",
            "buttonText": "保存",
            "stateChanging": True,
            "saveAttemptedInPlan": False,
        },
        {
            "id": "verify_form_complete",
            "meaning": "Read back the daily report; require form completion before sending.",
            "stateChanging": False,
        },
        {
            "id": "click_send",
            "meaning": "Click send only when the live-send gate is explicitly opened.",
            "buttonText": "发送",
            "stateChanging": True,
            "sendAttemptedInPlan": False,
        },
    ]


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_preview(path: Path, payload: dict[str, Any]) -> None:
    report = payload["report"]
    fields = payload["draftFields"]
    rows = "\n".join(
        f"<tr><td>{escape(item['id'])}</td><td>{escape(item['meaning'])}</td>"
        f"<td>{escape(str(item.get('stateChanging', False)))}</td></tr>"
        for item in payload["dailyReportActions"]
    )
    blockers = "".join(f"<li>{escape(item)}</li>" for item in payload["blockers"]) or "<li>none</li>"
    html = f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YCRM Daily Report Send Plan</title>
  <style>
    body {{ margin: 0; font-family: Segoe UI, Arial, sans-serif; background: #f6f8fb; color: #172033; }}
    main {{ max-width: 1080px; margin: 0 auto; padding: 24px; }}
    section {{ background: #fff; border: 1px solid #d8e0ea; border-radius: 8px; padding: 16px; margin: 14px 0; }}
    dl {{ display: grid; grid-template-columns: 180px 1fr; gap: 8px 12px; margin: 0; }}
    dt {{ font-weight: 700; color: #465568; }}
    dd {{ margin: 0; overflow-wrap: anywhere; }}
    table {{ width: 100%; border-collapse: collapse; }}
    th, td {{ border-bottom: 1px solid #d8e0ea; padding: 9px; text-align: left; vertical-align: top; }}
    th {{ background: #edf3f9; }}
    pre {{ white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; font-family: Segoe UI, Arial, sans-serif; }}
    .gate {{ color: #9a3412; font-weight: 700; }}
  </style>
</head>
<body>
<main>
  <h1>YCRM Daily Report Send Plan</h1>
  <p class="gate">Local preview only. writeAttempted=false, saveAttempted=false, sendAttempted=false.</p>
  <section>
    <h2>Report</h2>
    <dl>
      <dt>status</dt><dd>{escape(payload["status"])}</dd>
      <dt>reportUrl</dt><dd>{escape(report.get("reportUrl", ""))}</dd>
      <dt>reportId</dt><dd>{escape(report.get("reportId", ""))}</dd>
      <dt>reportNo</dt><dd>{escape(report.get("reportNo", ""))}</dd>
      <dt>signInId</dt><dd>{escape(report.get("signInId", ""))}</dd>
      <dt>reportDate</dt><dd>{escape(report.get("reportDate", ""))}</dd>
    </dl>
  </section>
  <section>
    <h2>Draft Fields</h2>
    <dl>
      <dt>sendGroup</dt><dd>{escape(fields.get("sendGroup", ""))}</dd>
      <dt>participants</dt><dd>{escape(fields.get("participants", ""))}</dd>
      <dt>target</dt><dd><pre>{escape(fields.get("target", ""))}</pre></dd>
      <dt>actual</dt><dd><pre>{escape(fields.get("actual", ""))}</pre></dd>
      <dt>follow</dt><dd><pre>{escape(fields.get("follow", ""))}</pre></dd>
    </dl>
  </section>
  <section>
    <h2>Blockers</h2>
    <ul>{blockers}</ul>
  </section>
  <section>
    <h2>Actions</h2>
    <table><thead><tr><th>ID</th><th>Meaning</th><th>State changing</th></tr></thead><tbody>{rows}</tbody></table>
  </section>
</main>
</body>
</html>
"""
    path.write_text(html, encoding="utf-8")


def _clean(value: Any) -> str:
    if value is None:
        return ""
    return str(value).replace("\r\n", "\n").replace("\r", "\n").strip()


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
