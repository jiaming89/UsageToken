<div align="center">

# usagetoken

**本地编码 Agent Token 用量统计 CLI 工具**

一个独立的 Node/TypeScript CLI，用于采集本地各类编码 Agent 的 token 用量，提供个人仪表盘、团队上报和 5 小时计费窗口分析。

JSON 输出与 `ccusage 20.0.19` 保持字段兼容。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://img.shields.io/npm/v/usagetoken.svg)](https://www.npmjs.com/package/usagetoken)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![Platform](https://img.shields.io/badge/Platform-Win%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](#)

[GitHub 仓库](https://github.com/jiaming89/usage-token) · [Gitee 镜像](https://gitee.com/mujiaming/usage-token)

</div>

---

## 简介

`usagetoken` 扫描本地各类编码 Agent（Claude Code、Codex、Copilot、Gemini、Kimi 等 16+ 种）的会话日志，统一采集 token 用量数据，提供：

- **终端报表** — daily / weekly / monthly / session / blocks 五种维度
- **HTML 仪表盘** — 带视图切换、日期筛选、KPI 卡片、Token 构成图、智能洞察
- **独立 HTML 报告** — 任意命令加 `--html` 即可生成可视化页面
- **团队上报** — 本地仓库 + 团队/组织汇总服务器
- **5 小时计费窗口** — 追踪 Claude 风格的 block 消耗节奏和燃烧率预测

## 功能特性

- 支持 16+ 种编码 Agent 数据源，自动发现本地日志
- 个人仪表盘支持 5 个视图 Tab 切换（Daily / Weekly / Monthly / Session / Blocks）
- 日期范围筛选，所有图表联动更新
- Token 构成可视化（input / output / cacheRead / cacheCreate 环形图）
- 带坐标轴和数值标注的柱状图
- 模型和项目的占比进度条 + 效率对比（$/M tokens）
- 智能 Insights：成本突增检测、缓存节省、模型性价比、最忙日
- `--html` 选项：终端命令一键生成独立可视化 HTML 报告
- ccusage JSON 兼容，可无缝对接现有团队报表管线
- 纯本地优先，数据存储在 `~/.usagetoken/`

## 快速开始

### 安装

**方式一：npm 全局安装（推荐）**

```bash
npm install -g usagetoken
utoken
```

**方式二：从源码构建**

```bash
git clone https://github.com/jiaming89/usage-token.git
cd usage-token
npm install
npm run build
npm install -g .
utoken
```

> 如 GitHub 访问不便，可使用 Gitee 镜像：`git clone https://gitee.com/mujiaming/usage-token.git`。

### 个人使用

最简单的方式 —— 一条命令同步数据并打开仪表盘：

```bash
utoken
```

> 如果通过源码构建且未全局安装，请使用 `node dist/bin/utoken.js`。

`utoken` 命令会启动本机仪表盘服务并自动打开浏览器。默认显示最近 30 天，后台会立即刷新本地缓存，随后每 15 分钟检查一次日志更新。按 `Ctrl+C` 停止服务。

仪表盘可按日期范围筛选，包括全部历史；首次全历史缓存建立期间，页面会显示正在刷新状态。

仪表盘默认输出到 `~/.usagetoken/dashboard.html`。

### 终端报表

```bash
# 日报
usagetoken daily

# 周报（指定时区）
usagetoken weekly --timezone Asia/Shanghai

# 月报
usagetoken monthly

# 会话维度
usagetoken session --since 2026-07-01 --until 2026-07-31

# 5 小时计费窗口
usagetoken blocks
```

> 未全局安装时，将 `usagetoken` 替换为 `node dist/bin/usagetoken.js`。

### HTML 可视化报告

任意报表命令加 `--html` 即可生成独立 HTML 页面：

```bash
usagetoken daily --html        # → daily-report.html
usagetoken weekly --html       # → weekly-report.html
usagetoken monthly --html      # → monthly-report.html
usagetoken session --html      # → session-report.html
usagetoken blocks --html       # → blocks-report.html
```

HTML 报告包含 KPI 卡片、数据表格、成本进度条，样式与仪表盘统一。

## 命令一览

| 命令 | 说明 |
|---|---|
| `utoken` | 一键同步 + 打开仪表盘（个人推荐入口） |
| `sync` | 采集所有数据源的用量，写入本地仓库 |
| `dashboard` | 渲染 HTML 仪表盘到 `~/.usagetoken/dashboard.html` |
| `daily` | 按天汇总 token 用量 |
| `weekly` | 按周汇总 token 用量 |
| `monthly` | 按月汇总 token 用量 |
| `session` | 按会话汇总 token 用量 |
| `blocks` | 5 小时计费窗口分析（Claude 风格） |
| `upload-daily` | 上传每日汇总到团队服务器 |
| `serve` | 启动团队/组织汇总服务器 |

### 通用选项

| 选项 | 说明 |
|---|---|
| `--json` | 输出 ccusage 兼容的 JSON |
| `--html` | 生成独立 HTML 可视化报告 |
| `--since YYYY-MM-DD` | 起始日期 |
| `--until YYYY-MM-DD` | 截止日期 |
| `--timezone <IANA>` | 时区（如 `Asia/Shanghai`） |
| `--mode auto\|display\|calculate` | 成本计算模式 |
| `--offline` | 离线模式，跳过在线定价更新 |
| `--no-cost` | 不计算成本 |
| `--source <name>` | 仅统计指定数据源 |
| `--by-source` | 按数据源分行输出 |
| `--html-file <path>` | 自定义 HTML 输出路径 |
| `--store-dir <path>` | 自定义仓库目录 |

## 仪表盘功能

`utoken` / `dashboard` 命令生成的 HTML 仪表盘包含：

### 视图切换

顶部 Tab 栏支持 5 种视图，所有图表联动更新：

| 视图 | 内容 |
|---|---|
| **Daily** | 每日 token 趋势柱状图 + 每日明细表 |
| **Weekly** | 按周聚合的汇总数据 |
| **Monthly** | 按月聚合的汇总数据 |
| **Session** | 会话列表（ID / 来源 / token / 花费 / 时长） |
| **Blocks** | 5 小时计费窗口（起止 / token / 花费 / 燃烧率 / 状态） |

### 日期范围筛选

支持 From / To 日期选择器和 All time 快捷按钮，筛选后 KPI、图表、表格全部联动。

### KPI 卡片

- 总天数 / 总花费 / 总 token / 今日花费
- 缓存命中率（衡量使用效率）
- 会话数
- 环比变化箭头

### 可视化组件

- **Token 构成环形图** — input / output / cacheRead / cacheCreate 占比
- **带坐标轴柱状图** — Y 轴刻度 + 数值标注
- **模型/项目进度条** — 占比可视化 + $/M tokens 效率指标
- **智能 Insights** — 成本突增、缓存节省、模型性价比、最忙日自动检测

## 团队上报流程

### 1. 启动汇总服务器

```bash
usagetoken serve --host 127.0.0.1 --port 8787 --server-mode team
```

### 2. 上传每日汇总

```bash
usagetoken upload-daily --endpoint http://127.0.0.1:8787/usage/daily-batch
```

上传失败会本地排队，可稍后重试。

### 3. 服务器 API

| 端点 | 方法 | 说明 |
|---|---|---|
| `/` | GET | 团队仪表盘 HTML |
| `/api/rollups` | GET | 汇总数据 JSON |
| `/usage/daily-batch` | POST | 接收每日批量上报 |

### 本地配置

本地仓库和配置存储在 `~/.usagetoken/`：

```
~/.usagetoken/
├── config.json          # 用户身份、团队/组织元数据、上传设置
├── warehouse.json       # 用量仓库（usageRecords / sessionSummaries / dailyUserSummaries）
└── dashboard.html       # 仪表盘
```

## 数据源

支持自动发现以下编码 Agent 的本地日志：

| 数据源 | 本地路径 | 解析方式 |
|---|---|---|
| Claude | `~/.claude` | 专用解析器 |
| Codex | `~/.codex` | 专用解析器 |
| Copilot | `~/.copilot/session-state/*/events.jsonl` | OpenTelemetry |
| OpenCode | `~/.opencode` | SQLite |
| Goose | `~/.goose` | SQLite |
| Hermes | `~/.hermes` | SQLite |
| Kilo | `~/.kilo` | SQLite |
| Antigravity | — | SQLite |
| Amp | `~/.local/share/amp` | JSON |
| Droid | `~/.factory/sessions` | JSON |
| Codebuff | `~/.config/manicode*/projects` | JSON |
| Pi | `~/.pi/agent/sessions` | JSON |
| OpenClaw | `~/.openclaw` | JSONL |
| Gemini | `~/.gemini/tmp` | JSON |
| Kimi | `~/.kimi` | JSONL |
| Qwen | `~/.qwen` | JSONL |

默认合并所有数据源。使用 `--source <name>` 筛选单个数据源，或 `--by-source` 按数据源分行输出。

## 开发

### 构建

```bash
npm install
npm run build
npm test
```

构建脚本跨平台，会将运行时定价资产复制到 `dist/`。

### 技术栈

- TypeScript 5.8 + Node.js ≥ 20
- 零运行时依赖
- SQLite 适配器使用 Node 内置的 `node:sqlite`（可选支持 `better-sqlite3`）
- 测试使用 Node 内置 `node --test`

### ccusage 兼容性验证

```bash
npm run diff:ccusage -- daily weekly monthly session
CCUSAGE_ROOT=/path/to/ccusage npm run diff:ccusage -- blocks
```

diff 脚本会构建 `usagetoken`，用匹配的 JSON 选项运行两个 CLI，规范化排序和浮点噪声后报告字段级差异。

## 项目结构

```
usage-token/
├── bin/
│   ├── usagetoken.ts      # CLI 入口
│   └── utoken.ts          # utoken 快捷命令入口
├── src/
│   ├── bin/
│   │   ├── usagetoken.ts  # CLI 主逻辑
│   │   └── cc.ts          # cc 命令逻辑
│   ├── cli.ts             # 命令解析与分发
│   ├── types.ts           # 类型定义
│   ├── core/
│   │   ├── summary.ts     # daily/weekly/monthly/session 汇总
│   │   ├── blocks.ts      # 5 小时计费窗口
│   │   ├── pricing.ts     # 模型定价
│   │   └── date.ts        # 日期工具
│   ├── sources/           # 数据源适配器（16+ 种）
│   ├── output/
│   │   ├── table.ts       # 终端表格渲染
│   │   └── html-report.ts # HTML 报告渲染
│   ├── product/
│   │   ├── dashboard.ts   # 仪表盘渲染（个人 + 团队）
│   │   ├── store.ts       # 本地仓库读写
│   │   ├── warehouse.ts   # 仓库数据结构
│   │   ├── config.ts      # 产品配置
│   │   └── server.ts      # 团队服务器
│   ├── compat/
│   │   └── ccusage.ts     # ccusage 兼容层
│   └── upload.ts          # 上传逻辑
├── test/                  # 测试
├── scripts/
│   ├── build.mjs          # 构建脚本
│   └── diff-ccusage.ts    # 兼容性 diff
└── tsconfig.json
```

## 打包

npm 包白名单仅包含编译后的运行时文件：

- `dist/bin`
- `dist/src`
- `README.md`
- `LICENSE`

`src/`、`test/`、`scripts/`、`dist/test/` 等开发文件不会打包进 CLI。

## 许可证

[MIT License](LICENSE) © 2026 mujiaming

本项目使用 `ccusage` 作为 JSON 格式、聚合行为和定价快照的兼容性参照。`ccusage` 同样采用 MIT 许可证。
