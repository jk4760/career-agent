import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { attachmentsRoute } from './attachments'

test('附件超过 25 MB 在读取文件内容前返回 413', async () => {
  const app = new Hono().route('/materials', attachmentsRoute)
  const file = new File([new Uint8Array(25 * 1024 * 1024 + 1)], 'fake-large.pdf', { type: 'application/pdf' })
  const body = new FormData()
  body.append('file', file)
  const response = await app.request('/materials/00000000-0000-4000-8000-00000000d501/attachments', {
    method: 'POST',
    body,
  })
  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: '附件不能超过 25 MB' })
})
