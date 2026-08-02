# 贡献指南

感谢你对 usagetoken 项目的关注！本文档描述了参与贡献的流程和规范。

## 如何贡献

### 报告问题

- 在 [Gitee Issues](https://gitee.com/mujiaming/usage-token/issues) 中搜索是否已有相同问题
- 如果没有，创建新 Issue，请包含：
  - 问题描述和复现步骤
  - 操作系统和 Node.js 版本
  - 相关命令和输出（如有敏感信息请脱敏）

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 确保通过所有测试：`npm test`
4. 提交代码，遵循下方提交规范
5. 提交 Pull Request

### 开发环境

```bash
git clone https://gitee.com/mujiaming/usage-token.git
cd usage-token
npm install
npm run build
npm test
```

要求：
- Node.js ≥ 20
- TypeScript 5.8+
- 无运行时依赖（保持零依赖设计）

## 代码规范

### TypeScript 风格

- 使用 ESM（`"type": "module"`）
- 严格模式（`tsconfig.json` 中 `strict: true`）
- 优先使用 `interface` 而非 `type` 定义对象形状
- 避免使用 `any`，必要时使用 `unknown` 并做类型收窄

### 数据源适配器

如果要新增数据源适配器，需要：

1. 在 `src/sources/` 下新建文件，实现 `UsageSource` 接口
2. 在 `src/sources/index.ts` 中注册
3. 在 `test/adapters.test.ts` 中添加测试
4. 更新 README 数据源表格

适配器需要处理：
- 本地路径发现（支持环境变量覆盖）
- 日志文件读取（JSON / JSONL / SQLite）
- token 字段解析（input / output / cacheCreation / cacheRead）
- 成本计算（通过 `calculateRecordCost`）

### 测试

- 使用 Node 内置 `node --test`
- 测试文件放在 `test/` 目录，命名 `*.test.ts`
- 所有新功能必须附带测试
- 运行 `npm test` 确保全部通过

## 提交信息规范

使用 Conventional Commits 格式：

```
<type>(<scope>): <description>
```

### Type

| 类型 | 说明 |
|---|---|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码格式（不影响功能） |
| `refactor` | 重构（非新功能、非修复） |
| `test` | 测试相关 |
| `chore` | 构建、工具链等杂项 |

### 示例

```
feat(dashboard): add session view tab to dashboard
fix(blocks): correct gap block boundary calculation
docs(readme): update data source table
test(adapters): add kimi source test cases
```

## 兼容性要求

- JSON 输出需与 `ccusage 20.0.19` 保持字段兼容
- 新增字段不应破坏现有 JSON 结构
- 提交前运行兼容性检查：

```bash
npm run diff:ccusage -- daily weekly monthly session
```

## 分支策略

- `master` — 稳定发布分支
- `feature/*` — 功能开发分支
- `fix/*` — Bug 修复分支

Pull Request 默认合并到 `master`。

## 许可证

提交的代码将遵循项目的 [MIT License](LICENSE)。
