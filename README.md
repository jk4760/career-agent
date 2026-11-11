# NextCareer

> 原 Career Agent，v0.5 起更名 NextCareer（Git 仓库名 `career-agent` 不变）。

个人求职一站式平台：AI 定时采集匹配岗位 → Web Portal 管理（岗位流 / 素材库 / 问题库 / AI 助手面板 / 偏好设置），后续接飞书机器人做每日推送与反馈闭环。

当前为 **M2**：前端 + Hono API + Postgres（Docker Compose 一键起全站），单服务器部署。

## 技术栈

- 前端：Vite + React 18 + TypeScript + Tailwind CSS v4 + shadcn/ui（Base UI 版）+ react-router（`web/`）
- 后端：TypeScript + Hono（Node 22）+ drizzle-orm + zod（`api/`）
- 数据库：PostgreSQL 16（Docker 容器；schema 单一事实来源为 `db/schema.ts`，迁移由 drizzle-kit 生成）
- 部署：Docker Compose 三服务（db / api / web），nginx 托管静态文件 + 转发 `/api/*` + 全站 Basic Auth
- 附件存储：服务器本地磁盘卷（容器卷 `/var/lib/nextcareer/uploads`）

## 运行

要求 **Node.js ≥ 22**（本机开发）与 Docker。

### 本机一键起全站（与线上同构）

```bash
cp .env.example .env   # 填 DB_PASSWORD / AUTH_USER / AUTH_PASS
docker compose up -d --build
npm run seed           # 或：docker compose exec -T api npx tsx src/seed.ts
```

打开 `http://localhost`，输入 Basic Auth 凭据即可。

### 本机开发（前端热更新）

```bash
docker compose up -d db api   # 只起 db + api
npm run dev --prefix web      # vite dev，/api 自动代理到 localhost:3001
```

### 环境变量（`.env`，绝不入库）

| 变量 | 含义 |
|---|---|
| `DB_PASSWORD` | Postgres 容器密码（仅 compose 内网使用，5432 不对公网开放） |
| `AUTH_USER` / `AUTH_PASS` | 全站 Basic Auth 凭据（nginx 容器启动时生成 htpasswd） |
| `WEB_PORT` | web 对外端口，默认 80（可选） |

## 架构

```
浏览器 ──HTTP──▶ web 容器（nginx :80，Basic Auth）
                   ├─ /      → 前端静态文件（SPA fallback → /index.html）
                   └─ /api/*  → api 容器 :3001（Hono）
api ──▶ db 容器（Postgres，仅内网可达，不暴露端口）
api ──▶ uploads 卷（附件原文件，按 materialId 分目录）
```

```
db/schema.ts             # drizzle schema（单一事实来源；schema.sql 仅历史存档）
db/seed.sql              # 种子数据（幂等，固定 UUID）
db/backup.sh             # pg_dump 备份脚本（保留最近 12 份）
api/src/                 # Hono 入口 + routes/（jobs/materials/questions/preferences/facets/attachments）+ db.ts + storage.ts
web/src/lib/
  ├── repository.ts          # Repository 接口（16 个方法，签名冻结）
  ├── apiRepository.ts       # M2：API 实现（fetch → /api/*）
  └── aiSettingsLocal.ts     # AI 对话配置：localStorage（豁免条款保留）
```

### 数据访问层（可替换设计）

页面只依赖 `Repository` 接口，通过 Context 注入。M2 已用 `apiRepository`（Postgres）替换内存实现；`getAISettings` / `saveAISettings` 按豁免条款仍走浏览器 localStorage，不走路由。

### 持久化说明

- 素材库、岗位、问题、偏好 → Postgres（服务器）
- **AI 对话配置（含 API Key）→ 浏览器 localStorage**（仅本机本浏览器，不提交任何服务器；M5 起迁后端代理）
- 附件原文件 → 服务器磁盘卷（元信息在 `materials.attachments` JSONB）

## 备份与恢复

- `db/backup.sh`：`pg_dump -Fc` 导出到 `backups/nextcareer-YYYY-MM-DD.dump`，自动保留最近 12 份
- 服务器 cron（每月 1 日凌晨 3 点）：`0 3 1 * * /opt/nextcareer/db/backup.sh >> /opt/nextcareer/backups/cron.log 2>&1`
- 恢复（把库删了从备份恢复）：

```bash
docker compose exec -T db psql -U nextcareer -c "DROP DATABASE nextcareer" -c "CREATE DATABASE nextcareer"
docker compose exec -T db pg_restore -U nextcareer -d nextcareer < backups/nextcareer-YYYY-MM-DD.dump
```

- 素材库是唯一的不可再生资产，建议定期把 `backups/` 额外拷贝到网盘或 GitHub 私有仓库（几十 KB 量级）

## 页面

| 路由 | 说明 |
|---|---|
| `/jobs` | 岗位流：状态筛选 tab、行式列表展开详情、感兴趣/不合适/已投递反馈（可附一句话 comment） |
| `/materials` | 素材库：facet chips + 搜索 + 项目树状大纲，markdown 渲染，文件导入（.md/.docx/.pdf）与附件下载，新建/编辑抽屉表单，删除二次确认 |
| `/questions` | 问题库：新增问题表单、详情区即编辑区、列表 hover 删除（二次确认），未关联计数提醒 |
| `/ai-settings` | AI 对话管理：API 地址 / API Key / 模型列表 chips，保存后面板模型下拉立即联动 |
| `/preferences` | 偏好设置：行业/职能/城市/薪资底线/包含排除关键词，保存即生效 |

右侧常驻 **AI 助手面板**：头部模型下拉 + 收起/展开（30px 竖条），消息气泡与输入区样式已定稿，真实对话能力 M5 上线。

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | Portal 骨架 | ✅ |
| M2 | Postgres + Hono API + Docker Compose 部署（本仓库当前状态） | ✅ |
| M3 | Python 采集脚本：岗位抓取、清洗、去重（dedup_key） | 未开始 |
| M4 | 匹配打分 + 飞书机器人推送 + 反馈回写偏好（动态权重）＋ **绑域名 + 免费 HTTPS 证书**（届时 `crypto.randomUUID` 原生可用，Basic Auth 凭据传输加密） | 未开始 |
| M5 | AI 助手真能力：LLM 后端代理 + 对话记忆 + 附件对象存储 | 未开始 |
