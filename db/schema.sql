-- Career Agent 数据库 Schema（PostgreSQL 方言）
--
-- 设计原则：
-- 1. feedback_events 是追加式事件日志，不改写状态——状态永远由"最新一条事件"派生，
--    这是未来偏好学习的数据资产。
-- 2. materials 一行 = 一个可讲的故事（不是项目）。项目只是分组属性。
-- 3. ID 一律 UUID，不绑定任何业务分类；分类字段（capability）只服务筛选，不承担身份。
-- 4. tags[] 是自由标签；capability_l1/l2 是受控词表，两者不要混用。

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 岗位表：采集管道的落点
CREATE TABLE jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  company       TEXT NOT NULL,
  location      TEXT,
  salary_min    INTEGER,
  salary_max    INTEGER,
  currency      TEXT DEFAULT 'CNY',
  source        TEXT NOT NULL,               -- boss / lagou / 公司官网 等
  source_url    TEXT NOT NULL,
  description   TEXT,                        -- 原始全文，本阶段不做结构化清洗
  posted_at     DATE,
  collected_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  dedup_key     TEXT NOT NULL UNIQUE         -- 建议：md5(source || source_url)
);

-- 反馈事件表：闭环的心脏，追加式，不改写
CREATE TABLE feedback_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID NOT NULL REFERENCES jobs(id),
  action      TEXT NOT NULL CHECK (action IN ('interested','pass','applied')),
  comment     TEXT,                          -- 自由文本反馈，如"太偏运营了"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_feedback_job ON feedback_events(job_id, created_at DESC);

-- 偏好设置：静态结构化条件（动态权重是后续里程碑，本表不设计）
CREATE TABLE preferences (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  industries        TEXT[],
  roles             TEXT[],
  locations         TEXT[],
  salary_min        INTEGER,
  keywords_include  TEXT[],
  keywords_exclude  TEXT[],
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 素材库（故事表）：一行 = 一个可讲的故事
CREATE TABLE materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project       TEXT NOT NULL,               -- 所属项目，分组属性
  title         TEXT NOT NULL,               -- 故事标题，一句话说清场景
  role          TEXT,                        -- 担任的角色
  duration      TEXT,                        -- 如 "2023.03–2024.06"
  capability_l1 TEXT,                        -- 能力域（受控词表，如：数据分析）
  capability_l2 TEXT,                        -- 细分能力（受控词表，如：指标体系搭建）
  tags          TEXT[],                      -- 自由标签
  facets        TEXT[],                      -- 经历/公司标签（自由文本、不分类型，如 {"互联网","字节跳动"}）；chips 由该字段派生
  metrics       TEXT,                        -- 量化成果，一两个即可
  content       TEXT,                        -- markdown，自由结构（不强制 STAR 四段）
  others        JSONB,                       -- 以备不时之需
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(project, title)
);

-- 问题库
CREATE TABLE interview_questions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category           TEXT,                   -- 项目深挖 / 行为面 / 技术概念…
  question           TEXT NOT NULL,
  answer_draft       TEXT,                   -- markdown 回答草稿
  linked_material_id UUID REFERENCES materials(id),  -- "这道题讲哪个故事"
  confidence         INTEGER CHECK (confidence BETWEEN 1 AND 5),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 推送记录（第二阶段用，本阶段只建表）
CREATE TABLE push_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      UUID REFERENCES jobs(id),
  channel     TEXT NOT NULL,                 -- feishu / email
  pushed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_reply  TEXT
);
