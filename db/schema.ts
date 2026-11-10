import { sql } from 'drizzle-orm'
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import type { AttachmentMeta } from '../web/src/types'

// 单一事实来源（M2 起）：schema 即代码，迁移由 drizzle-kit 生成。
// db/schema.sql 仅作历史存档，不再维护。

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  company: text('company').notNull(),
  location: text('location'),
  salaryMin: integer('salary_min'),
  salaryMax: integer('salary_max'),
  currency: text('currency').default('CNY'),
  source: text('source').notNull(),
  sourceUrl: text('source_url').notNull(),
  description: text('description'),
  postedAt: date('posted_at'),
  collectedAt: timestamp('collected_at', { withTimezone: true }).notNull().defaultNow(),
  dedupKey: text('dedup_key').notNull().unique(),
})

export const feedbackEvents = pgTable(
  'feedback_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id),
    action: text('action').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'feedback_events_action_check',
      sql`${t.action} IN ('interested','pass','applied')`,
    ),
    index('idx_feedback_job').on(t.jobId, t.createdAt.desc()),
  ],
)

export const preferences = pgTable('preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  industries: text('industries').array(),
  roles: text('roles').array(),
  locations: text('locations').array(),
  salaryMin: integer('salary_min'),
  keywordsInclude: text('keywords_include').array(),
  keywordsExclude: text('keywords_exclude').array(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const materials = pgTable(
  'materials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    project: text('project').notNull(),
    title: text('title').notNull(),
    role: text('role'),
    duration: text('duration'),
    capabilityL1: text('capability_l1'),
    capabilityL2: text('capability_l2'),
    tags: text('tags').array(),
    facets: text('facets').array(),
    metrics: text('metrics'),
    content: text('content'),
    attachments: jsonb('attachments').$type<AttachmentMeta[]>(),
    others: jsonb('others'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('materials_project_title_key').on(t.project, t.title)],
)

export const interviewQuestions = pgTable('interview_questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  category: text('category'),
  question: text('question').notNull(),
  answerDraft: text('answer_draft'),
  linkedMaterialId: uuid('linked_material_id').references(() => materials.id),
  confidence: integer('confidence'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const pushLog = pgTable('push_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').references(() => jobs.id),
  channel: text('channel').notNull(),
  pushedAt: timestamp('pushed_at', { withTimezone: true }).notNull().defaultNow(),
  userReply: text('user_reply'),
})
