# Yealink YCRM Daily Report Automation

## 中文说明

这是一个面向亿联员工的 YCRM 日报自动化脚本包。它使用 Playwright 复用授权浏览器会话，抓取 YCRM 日报列表和字段内容，分析日报写法结构，并提供一个脱敏后的提交流程模板，方便 Agent 根据授权用户的真实场景生成或校验日报。

公开版本没有包含真实日报、客户名称、手机号、邮件、截图或登录态。`submit_daily_report.template.mjs` 只是安全模板，需要使用者按自己有权限的 YCRM 接口补充提交路径和字段映射。

### 解决的问题

亿联销售、售前和交付同事经常需要整理拜访记录、项目进展、风险和待跟进事项。日报写作口径不一致会影响复盘和协同。本仓库帮助员工快速拉取历史日报样式、统计常用字段和内容长度，并让 Agent 能用统一格式辅助生成日报草稿。

### 技术架构

- Node.js 18+。
- Playwright Chromium 持久化登录态。
- `scripts/fetch_daily_reports.mjs` 负责在 YCRM 日报页面发起授权接口请求并保存 JSON。
- `scripts/analyze_daily_report_style.mjs` 对本地日报 JSON 做字段和写法分析。
- `scripts/submit_daily_report.template.mjs` 是脱敏提交模板，只接收本地 payload 和显式配置的接口路径。

### 运行 URL

- YCRM 日报页面：`https://ycrm.yealink-inc.com/portal/evection/record`
- 默认输出目录：`work/ycrm_daily_reports/`

### 环境和用户信息

运行者需要：

- 亿联内网或 VPN。
- 有权限访问 YCRM 日报模块的账号。
- Chrome 或 Playwright Chromium。
- 可选的本地 payload 文件，例如 `examples/daily_report_payload.example.json`。

推荐环境变量：

```powershell
$env:YCRM_PROFILE_DIR=".ycrm-chrome-profile"
$env:YCRM_CHROME_EXE="C:\Program Files\Google\Chrome\Application\chrome.exe"
$env:YCRM_DAILY_REPORT_URL="https://ycrm.yealink-inc.com/portal/evection/record"
$env:YCRM_DAILY_REPORT_OUT_DIR="work/ycrm_daily_reports"
```

提交模板还需要显式设置：

```powershell
$env:YCRM_DAILY_REPORT_SUBMIT_API="/ycrm/your-authorized-submit-api"
```

### 快速开始

```powershell
npm install
npx playwright install chromium
node scripts/fetch_daily_reports.mjs
node scripts/analyze_daily_report_style.mjs
node scripts/submit_daily_report.template.mjs examples/daily_report_payload.example.json
```

### 给 Agent 的快速导入提示

建议让 Agent 先执行抓取和分析，不要直接提交：

```text
使用 yealink-ycrm-daily-report-automation。先运行 fetch_daily_reports.mjs 读取授权范围内的日报样例，再运行 analyze_daily_report_style.mjs 总结写法。需要提交日报时，只能使用 submit_daily_report.template.mjs 和用户提供的 payload；不要上传或提交真实客户数据、浏览器 profile、截图和原始导出。
```

### 开源协议

MIT License。公开版本只覆盖本仓库中的脱敏脚本和文档。

## English

This repository provides YCRM daily-report automation helpers for Yealink employees. It uses Playwright to reuse an authorized browser session, fetch daily-report records, analyze report-writing patterns, and provide a sanitized submission template for agent-assisted drafts.

The public version does not include real reports, customer names, phone numbers, emails, screenshots, or login state. The submission script is only a template and requires the user to provide an authorized API path and field mapping.

### What Problem It Solves

Sales, presales, and delivery teams need consistent visit notes, project progress updates, risks, and follow-up actions. This toolkit helps employees inspect historical report style and lets agents draft reports with a more consistent structure.

### Architecture

- Node.js 18+.
- Playwright Chromium persistent session.
- `fetch_daily_reports.mjs` fetches authorized daily-report JSON from the YCRM page.
- `analyze_daily_report_style.mjs` summarizes local report data.
- `submit_daily_report.template.mjs` accepts a local payload and an explicitly configured submit API.

### Browser URL

- YCRM daily report page: `https://ycrm.yealink-inc.com/portal/evection/record`
- Default output folder: `work/ycrm_daily_reports/`

### Agent Import

Ask the agent to run fetch first, analyze style second, and only use the submit template with a user-provided payload. The agent must not commit browser profiles, screenshots, raw exports, or real customer data.

### License

MIT License.
