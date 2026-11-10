import { readFile } from 'node:fs/promises'
import postgres from 'postgres'

// npm run seed：对当前库执行 db/seed.sql（幂等，固定 UUID）
const sql = postgres(process.env.DATABASE_URL!)
const seed = await readFile(new URL('../../db/seed.sql', import.meta.url), 'utf-8')
await sql.unsafe(seed)
await sql.end()
console.log('seed applied')
