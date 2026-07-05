import { useState, type DragEvent } from 'react'
import type { ChatAttachment } from '@shared/agent-types'
import type { FileFilter, UploadResult } from '@shared/api-types'

interface FileDropzoneProps {
  uploadFn: (sourcePath: string) => Promise<UploadResult>
  onUploaded: (attachments: ChatAttachment[]) => void
  label?: string
  compact?: boolean
  /** compact 模式下按钮文字，默认"📎 上传" */
  buttonLabel?: string
  /** 限制系统选择框能选的文件类型，比如只给 word/pdf/md（拖拽上传不受此限制，只影响点击弹出的选择框） */
  filters?: FileFilter[]
}

/** Electron 里被拖拽的 File 对象带有 .path（绝对路径），这是 Electron 对 Web File API 的扩展 */
interface ElectronFile extends File {
  path: string
}

export function FileDropzone({ uploadFn, onUploaded, label, compact, buttonLabel, filters }: FileDropzoneProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function handlePaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    setUploading(true)
    try {
      const results: ChatAttachment[] = []
      for (const p of paths) {
        const res = await uploadFn(p)
        results.push({ path: res.absPath, fileName: res.absPath.split(/[\\/]/).pop() ?? res.absPath, relativePath: res.relativePath })
      }
      onUploaded(results)
    } finally {
      setUploading(false)
    }
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    const paths = Array.from(e.dataTransfer.files).map((f) => (f as ElectronFile).path).filter(Boolean)
    await handlePaths(paths)
  }

  async function handleClick(): Promise<void> {
    const paths = await window.api.dialog.pickFiles(filters)
    await handlePaths(paths)
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        disabled={uploading}
        className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        title={buttonLabel ?? '上传文件'}
      >
        {uploading ? '上传中…' : (buttonLabel ?? '📎 上传')}
      </button>
    )
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={handleClick}
      className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${
        dragOver ? 'border-jushi-accent bg-blue-50 text-jushi-accent' : 'border-slate-300 text-slate-400 hover:border-slate-400'
      }`}
    >
      {uploading ? '上传中…' : (label ?? '拖拽文件到这里，或点击选择文件')}
    </div>
  )
}
