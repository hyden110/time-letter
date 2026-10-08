# 时间信笺（TimeLetter）Monorepo

微信小程序「时间信笺」——付费托管、到期准时投递电子/实体信笺。本仓库按交付计划分期实现，当前进度见下方「实现状态」。

## 目录结构

| 目录 | 说明 | 当前状态 |
|---|---|---|
| `apps/mini` | 微信小程序用户端（原生 + TypeScript） | 待设计稿冻结后开工 |
| `apps/h5` | 收件人 H5 查看页（Vite + React + TS，一次性 token 只读） | Sprint 1.2 |
| `apps/admin` | 管理后台（React + Ant Design） | 待设计稿冻结后开工 |
| `apps/api` | 后端服务（NestJS + PostgreSQL + Redis；BullMQ/node-cron 队列与定时任务） | 已开工 |
| `packages/shared` | 跨端共享领域规则（内容限制 / 日期规则 / 收件人校验与脱敏 / 费用 / 文案占位 key / 状态常量） | 已开工 |
| `docs` | 交付文档（短信模板变量清单等） | 已开工 |

## 快速开始

要求：Node ≥ 20、pnpm 10（`corepack enable`）、Docker（本地中间件，可选）。

```bash
pnpm install
pnpm run build      # 先构建 packages/shared（apps/api 依赖其产物）
pnpm run test       # vitest 全量单测 + 覆盖率（内存仓储，不依赖数据库）
pnpm run verify     # build + typecheck + test（不依赖数据库）
pnpm run infra:up   # 本地中间件：postgres / redis / mailpit（邮件沙箱 UI: http://localhost:8025）
pnpm run test:integration  # 真基础设施集成测试（需先 infra:up，连真实 PostgreSQL）
pnpm run migrate    # 建表/索引（幂等，需 DATABASE_URL）
```

## 本地启动（PostgreSQL 模式）

`pnpm run verify` 与单测默认走内存仓储（`STORAGE_MODE=memory`），不连数据库；要用真实 PostgreSQL 跑通全链路，按下面顺序执行。

```bash
pnpm run infra:up                                   # 起 postgres/redis/mailpit
export DATABASE_URL=postgres://timeletter:timeletter@localhost:5432/timeletter
export STORAGE_MODE=postgres
export LETTER_ENCRYPTION_KEY=$(openssl rand -hex 32) # 32 字节：64 位 hex 或 base64，缺失/格式错误直接拒绝启动
pnpm run migrate                                    # 建表 + 索引（幂等）
pnpm run build && node apps/api/dist/main.js        # 以 PG 模式启动
curl -i http://localhost:3000/health                # {"status":"ok","paymentEnabled":false,"storage":"postgres"}
pnpm run test:integration                           # 真 PG 全链路 + 唯一索引 + 密文落库
```

环境变量注入：`apps/api` 不自动读取 `.env`（未引入 dotenv）。本地用 `export` 或命令前缀，云上用 systemd/pm2/容器环境注入或 KMS；若确实需要 `.env` 自动加载，Node ≥ 20.6 的 `node --env-file=.env` 与引入 dotenv 二选一，避免出现两套配置来源。

⚠️ `pnpm run test:integration` 会在每个用例前 `TRUNCATE letters, recipients, consents, moderation_records, orders`，**只能对专用测试库运行**（云上请先建独立库，例如 `timeletter_test`，再把 `DATABASE_URL` 指过去）；启动时会在输出里打印目标库的 host/db 以便核对。

## 支付开关（关键约束）

- `PAYMENT_ENABLED` **默认 false**。false 时：预览接口返回 `cta=submit_custody`（前端展示「提交托管」），提交后订单 `amountCents=0`、`status=no_payment_required`，信笺状态直入 `in_custody`（保管中）。
- true 时：提交后订单进入 `pending_payment`，信笺 `pending_payment`（真实支付在后续 Sprint 接入；当前不写支付回调、不接商户号）。

## 开发期约定

- **用户身份**：请求头 `x-user-id` / `x-admin-id` 传递（临时约定，正式鉴权与登录态在 Sprint 1.3 接入）。
- **邮件**：mailpit 沙箱（SMTP `localhost:1025`，Web UI `http://localhost:8025`）。
- **短信**：mock provider，接口按 provider 抽象预留；所需模板变量清单见 `docs/sms-template-variables.md`。
- **法务/协议文案**：一律使用 `packages/shared` 的 `COPY_KEYS` 占位 key（如 `AGREE_PRIVACY_BODY`），实际文案由法务/产品提供后替换；本仓库不存放法律文本。
- **内容审核**：敏感词库为开发期最小样例（非生产词库）；微信内容安全 API 为 mock。
- **密钥**：开发期仅用环境变量（见 `.env.example`），禁止硬编码密钥；生产期走 KMS/独立密钥服务。

## 实现状态（Path A：数据 / 接口 / 规则层）

| 切片 | 状态 |
|---|---|
| 仓库基线（monorepo / docker compose / CI 最小流水线） | ✅ |
| US-002 内容 schema + 上限校验（2000字 / 9图 / 5MB / 60秒） | ✅ 数据层 |
| US-003 日期规则 + 2月29日顺延 | ✅ |
| US-004 收件人模型 + 邮箱必填 / 手机号选填校验 + PIPL 同意记录 | ✅ |
| US-005 预览数据组装（脱敏 + 费用 + 支付开关分支） | ✅ |
| US-024 内容安全审核（自动 + 人工兜底 + 抽检冻结） | ✅ |
| US-030 / US-032 协议同意与撤回（占位 key） | ✅ |
| 视觉层（小程序 / 管理后台页面） | ⏸ 待设计稿冻结 |
| PostgreSQL 仓储适配 + 迁移脚本 + 真库集成测试（`pnpm run test:integration`） | ✅ |
| US-009 信件正文静态加密（AES-256-GCM，密钥来自环境变量、启动即校验） | ✅ |
| US-009 保管编号唯一索引兜底 + 冲突重试 + 号段用尽终态 | ✅ |
| US-014 H5 一次性 token / 投递引擎与邮件实发 / Redis 队列消费 / 支付接入 | ⏸ 后续切片 |

## 持久化说明

仓储层接口抽象在 `apps/api/src/*/*.repository.ts`，两套实现可按 `STORAGE_MODE` 切换：

| 模式 | 实现 | 用途 |
|---|---|---|
| `memory`（默认） | `InMemory*Repository` | 单测 / e2e / 无数据库开发，`pnpm run verify` 走这条路径 |
| `postgres` | `apps/api/src/persistence/pg/Pg*Repository` | 本地与云上真跑，连接池在平台层 `apps/api/src/platform/pg-database.ts` |

- **DDL**：`apps/api/db/migrations/*.sql`（幂等，执行记录写 `schema_migrations`），入口 `apps/api/scripts/migrate.cjs`。
- **SQL 安全**：全部参数化 `$n` 占位符；动态 `UPDATE` 走白名单构造器 `apps/api/src/persistence/pg/pg-update.ts`，非白名单字段显式抛错，禁止字符串拼接。
- **保管编号唯一性**：由数据库部分唯一索引 `letters_custody_code_key`（`WHERE custody_code IS NOT NULL`）兜底，服务层捕获唯一冲突后换号重试（上限 8 次），号段用尽返回可重试错误；内存实现同语义，便于单测覆盖。
- **静态加密（US-009）**：信件正文由服务层用 AES-256-GCM 加密后入库，`letters.content` 只存密文信封 `{v,alg,iv,tag,ct}`；密钥取自环境变量 `LETTER_ENCRYPTION_KEY`，启动即校验，禁止硬编码、禁止明文写日志。换密钥会导致既有密文不可解，正式环境由 KMS 注入并妥善备份。
- 收件人信息一期不做静态加密（仅信笺正文）；管理员操作审计日志、登录态在 Sprint 1.3 接入；Redis 队列消费、投递引擎与 H5 一次性 token 在后续切片接入。
