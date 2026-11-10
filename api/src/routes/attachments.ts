import { Hono } from 'hono'
import { getAttachment, putAttachment } from '../storage'

export const attachmentsRoute = new Hono()
  // putAttachmentFile：multipart 上传，原文件存磁盘（路径按 materialId 分目录）
  .post('/:id/attachments', async (c) => {
    const id = c.req.param('id')
    const body = await c.req.parseBody()
    const file = body['file']
    if (!(file instanceof File)) return c.json({ error: 'file field is required' }, 400)
    const data = Buffer.from(await file.arrayBuffer())
    await putAttachment(id, file.name, data)
    return c.json({ ok: true, name: file.name, size: file.size }, 201)
  })

  // getAttachmentFile：下载原文件（浏览器一次 Basic Auth 后即可直接下载）
  .get('/:id/attachments/:name/download', async (c) => {
    const { id, name } = c.req.param()
    const data = await getAttachment(id, name)
    if (!data) return c.json({ error: 'attachment not found' }, 404)
    c.header('Content-Type', 'application/octet-stream')
    c.header(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    )
    return c.body(new Uint8Array(data))
  })
