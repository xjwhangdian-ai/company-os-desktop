import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import type { TranscribeEvent, WhisperStatus } from '@shared/agent-types'

// ============ 本地音频转写（whisper） ============
// Claude 系模型不接受音频输入，转写必须在本地完成。用 openai-whisper 的 CLI
// （brew install ffmpeg openai-whisper）：首次运行自动下载模型，全程离线、免 API 费。
// 打包后的 App 从 Finder 启动时拿不到 Homebrew 的 PATH，这里显式补上常见安装路径。

const AUGMENTED_PATH = ['/opt/homebrew/bin', '/usr/local/bin', process.env.PATH ?? ''].join(':')

const WHISPER_CANDIDATES = [
  '/opt/homebrew/bin/whisper',
  '/usr/local/bin/whisper',
  join(homedir(), '.local', 'bin', 'whisper') // pipx 安装位置
]
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg']

function findBinary(candidates: string[]): string | null {
  for (const p of candidates) if (existsSync(p)) return p
  return null
}

export function getWhisperStatus(): WhisperStatus {
  const whisperPath = findBinary(WHISPER_CANDIDATES)
  return {
    found: whisperPath !== null,
    whisperPath: whisperPath ?? undefined,
    ffmpegFound: findBinary(FFMPEG_CANDIDATES) !== null
  }
}

interface TranscribeJob {
  child: ChildProcess
  cancelled: boolean
}

const jobs = new Map<string, TranscribeJob>()

function fmtNow(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 启动转写：whisper 输出 txt 到音频同目录，完成后包装成带来源说明的 _转写.md，
 * 原始 txt 删除。进度（识别出的时间轴文本行 / 模型下载进度）经 onEvent 流回渲染进程。
 */
export function startTranscribe(
  jobId: string,
  dataDir: string,
  audioRelativePath: string,
  model: string,
  onEvent: (event: TranscribeEvent) => void
): void {
  const status = getWhisperStatus()
  if (!status.found || !status.whisperPath) {
    onEvent({ jobId, type: 'error', message: '未检测到本地转写引擎 whisper，请先按提示安装' })
    return
  }
  if (!status.ffmpegFound) {
    onEvent({ jobId, type: 'error', message: '未检测到 ffmpeg（whisper 解码音频需要它），请先按提示安装' })
    return
  }

  const audioAbs = join(dataDir, audioRelativePath)
  if (!existsSync(audioAbs)) {
    onEvent({ jobId, type: 'error', message: `音频文件不存在：${audioRelativePath}` })
    return
  }

  const outDir = dirname(audioAbs)
  const stem = basename(audioAbs, extname(audioAbs))
  const rawTxt = join(outDir, `${stem}.txt`)

  // --fp16 False：CPU 上避免半精度告警；--task transcribe 显式声明不做翻译
  const child = spawn(
    status.whisperPath,
    [audioAbs, '--language', 'zh', '--task', 'transcribe', '--model', model, '--output_format', 'txt', '--output_dir', outDir, '--fp16', 'False'],
    { env: { ...process.env, PATH: AUGMENTED_PATH } }
  )
  jobs.set(jobId, { child, cancelled: false })

  // 节流：转写行可能上千条，每 800ms 最多回传一次最新行，避免 IPC 刷屏
  let lastSent = 0
  const forward = (chunk: Buffer): void => {
    const lines = chunk
      .toString()
      .split(/[\r\n]+/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    const now = Date.now()
    if (now - lastSent > 800) {
      lastSent = now
      onEvent({ jobId, type: 'progress', text: lines[lines.length - 1].slice(0, 200) })
    }
  }
  child.stdout?.on('data', forward)
  child.stderr?.on('data', forward)

  child.on('error', (err) => {
    jobs.delete(jobId)
    onEvent({ jobId, type: 'error', message: `whisper 启动失败：${err.message}` })
  })

  child.on('close', (code) => {
    const job = jobs.get(jobId)
    jobs.delete(jobId)
    if (job?.cancelled) {
      try {
        if (existsSync(rawTxt)) unlinkSync(rawTxt)
      } catch {
        /* 清理失败不影响 */
      }
      onEvent({ jobId, type: 'error', message: '转写已取消' })
      return
    }
    if (code !== 0 || !existsSync(rawTxt)) {
      onEvent({ jobId, type: 'error', message: `转写失败（退出码 ${code}）——首次使用请确认模型下载完成，网络受限时可先手动运行一次 whisper` })
      return
    }
    try {
      const text = readFileSync(rawTxt, 'utf-8').trim()
      const mdPath = join(outDir, `${stem}_转写.md`)
      writeFileSync(
        mdPath,
        `# ${stem} 会议转写

> 来源：${audioRelativePath} · 转写时间 ${fmtNow()} · 引擎 whisper(${model})
> ⚠️ AI 转写未经人工校对，人名/产品名/数字可能有误，引用前请核对录音

---

${text}
`,
        'utf-8'
      )
      unlinkSync(rawTxt)
      const outputRelativePath = `${dirname(audioRelativePath)}/${stem}_转写.md`.replace(/\\/g, '/')
      onEvent({ jobId, type: 'done', outputRelativePath })
    } catch (err) {
      onEvent({ jobId, type: 'error', message: `转写结果写入失败：${err instanceof Error ? err.message : String(err)}` })
    }
  })
}

export function cancelTranscribe(jobId: string): void {
  const job = jobs.get(jobId)
  if (job) {
    job.cancelled = true
    job.child.kill('SIGTERM')
  }
}
