// ChurchOS — Portable upload directory resolution
// Local sandbox: <project>/upload (persistent FS)
// Serverless (Vercel): /tmp/upload or UPLOAD_DIR env (ephemeral per-invocation —
// production should swap in Vercel Blob / S3; see DEPLOYMENT.md)
import path from 'path'

export function getUploadDir(): string {
  if (process.env.UPLOAD_DIR) return process.env.UPLOAD_DIR
  if (process.env.VERCEL) return '/tmp/upload'
  return path.join(process.cwd(), 'upload')
}
