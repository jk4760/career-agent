import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { Hono } from 'hono'
import { db } from './db'
import { attachmentsRoute } from './routes/attachments'
import { internalRoute } from './routes/internal'
import { jobsRoute } from './routes/jobs'
import { facetsRoute, materialsRoute } from './routes/materials'
import { preferencesRoute } from './routes/preferences'
import { questionsRoute } from './routes/questions'

const app = new Hono()

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message }, 500)
})

app.get('/api/health', (c) => c.json({ ok: true }))

app.route('/api/jobs', jobsRoute)
app.route('/api/materials', materialsRoute)
app.route('/api/materials', attachmentsRoute)
app.route('/api/facets', facetsRoute)
app.route('/api/questions', questionsRoute)
app.route('/api/preferences', preferencesRoute)

// M4 内网接口：不挂 /api 前缀，nginx 不转发，仅 compose 内网（collector / ops 脚本）可达
app.route('/internal', internalRoute)

// 启动时对空库/老库执行迁移（api/drizzle 为入库的生成产物）
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))
await migrate(db, { migrationsFolder })

const port = Number(process.env.PORT ?? 3001)
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on :${info.port}`)
})
