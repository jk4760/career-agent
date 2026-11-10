import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const uploadDir = process.env.UPLOAD_DIR ?? '/var/lib/nextcareer/uploads'

/** 附件磁盘存取：路径按 materialId 分目录（§4 storage.ts） */
export async function putAttachment(materialId: string, name: string, data: Buffer) {
  const dir = path.join(uploadDir, materialId)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, path.basename(name)), data)
}

export async function getAttachment(materialId: string, name: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(uploadDir, materialId, path.basename(name)))
  } catch {
    return null
  }
}
