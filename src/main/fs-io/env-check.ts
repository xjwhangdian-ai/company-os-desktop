import { execFile, spawn } from 'node:child_process'
import { app } from 'electron'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

// ============ 本地环境检测与一键安装 ============
// App 的机械管线与分身工具链依赖若干本机组件：
//   python3 + pypdf/pillow/numpy/openpyxl —— 画册抠图、PDF 手册解析、Excel 生成
//   poppler(pdftoppm)                    —— 分身 Read 工具读取 PDF 页面（缺它就是"无法读取pdf"）
//   ocrmac（仅 mac，可选）               —— 扫描版画册的离线 OCR
// 首次启动检测一次，缺失的在顶部横幅提示；设置页「本地环境」可逐项一键安装。

const isWin = process.platform === 'win32'

/** GUI 启动的 Electron PATH 不含 Homebrew 等目录，检测与安装统一用补齐后的 PATH */
function windowsRuntimeBinDirs(): string[] {
  const local = process.env.LOCALAPPDATA ?? ''
  const roaming = process.env.APPDATA ?? ''
  const base = [
    join(local, 'Programs', 'Python', 'Python312'),
    join(local, 'Programs', 'Python', 'Python312', 'Scripts'),
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Tesseract-OCR')
  ]
  const popplerRoot = join(roaming, 'Agent工作台', 'runtime', 'poppler')
  if (existsSync(popplerRoot)) {
    const walk = (dir: string): void => {
      try {
        for (const name of readdirSync(dir)) {
          const child = join(dir, name)
          if (statSync(child).isDirectory()) walk(child)
          else if (name.toLowerCase() === 'pdftoppm.exe') base.push(dir)
        }
      } catch { /* 单个运行时目录不可读时忽略 */ }
    }
    walk(popplerRoot)
  }
  return [...new Set(base.filter((p) => p && existsSync(p)))]
}

export const EXTRA_BIN_DIRS = isWin
  ? windowsRuntimeBinDirs() // 安装器自动写 PATH；这里再补一次，确保首次启动立即可用。
  : ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']

export function augmentedPath(): string {
  return [...EXTRA_BIN_DIRS, process.env.PATH ?? ''].join(delimiter)
}

/** 安装包内置 Windows 环境一键安装脚本：Python、PDF 渲染、发票 OCR 与 Python 依赖。 */
function windowsBootstrapPath(): string {
  const root = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  return join(root, 'company-os-template', 'tools', 'windows-env-setup.bat')
}

function run(cmd: string, args: string[], timeoutMs = 20000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, env: { ...process.env, PATH: augmentedPath() }, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.trim() })
      }
    )
  })
}

function resolvePython(): string | null {
  const candidates = isWin
    ? ['python', 'py']
    : ['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3']
  for (const c of candidates) {
    if (c.startsWith('/')) {
      if (existsSync(c)) return c
    } else {
      return c
    }
  }
  return null
}

export interface EnvItem {
  key: string
  name: string
  ok: boolean
  /** true=核心功能依赖；false=可选增强 */
  required: boolean
  用途: string
  说明: string
  /** 一键安装可用时的命令展示（也用于手动复制） */
  安装命令: string
  canAutoInstall: boolean
}

export interface EnvCheckResult {
  items: EnvItem[]
  missingRequired: string[]
}

const PY_DEPS = ['pypdf', 'PIL', 'numpy', 'openpyxl', 'pytesseract']
const PY_PIP_PKGS = ['pypdf', 'pillow', 'numpy', 'openpyxl', 'pytesseract']

export async function checkEnv(): Promise<EnvCheckResult> {
  const items: EnvItem[] = []

  // ① python3
  const python = resolvePython()
  let pyOk = false
  if (python) {
    pyOk = (await run(python, ['--version'])).ok
  }
  items.push({
    key: 'python',
    name: 'Python 3',
    ok: pyOk,
    required: true,
    用途: '画册抠图、PDF 手册解析、产品清单 Excel 等机械管线',
    说明: pyOk
      ? '已安装'
      : isWin
        ? '未检测到——安装包会自动部署并配置 Python；请完全退出后重新打开工作台，再点“重新检测”'
        : '未检测到——终端执行 xcode-select --install（或 brew install python3），装完重启本 App',
    安装命令: isWin ? 'https://www.python.org/downloads/' : 'xcode-select --install',
    canAutoInstall: isWin
  })

  // ② python 依赖库
  let missingPy: string[] = []
  if (pyOk && python) {
    const r = await run(python, [
      '-c',
      `import importlib.util,json;print(json.dumps([m for m in ${JSON.stringify(PY_DEPS)} if importlib.util.find_spec(m) is None]))`
    ])
    try {
      missingPy = JSON.parse(r.out.trim().split('\n').pop() || '[]')
    } catch {
      missingPy = r.ok ? [] : [...PY_DEPS]
    }
  }
  const pipCmd = `${isWin ? 'python' : 'pip3'} ${isWin ? '-m pip ' : ''}install --user ${PY_PIP_PKGS.join(' ')}`
  items.push({
    key: 'pydeps',
    name: 'Python 依赖库（pypdf/pillow/numpy/openpyxl）',
    ok: pyOk && missingPy.length === 0,
    required: true,
    用途: '画册抠图、PDF 解析、Excel 清单生成',
    说明: !pyOk
      ? '需先安装 Python 3'
      : missingPy.length === 0
        ? '已齐全'
        : `缺少：${missingPy.join('、')}——点「一键安装」自动补齐`,
    安装命令: pipCmd,
    canAutoInstall: isWin || pyOk
  })

  // ③ poppler（pdftoppm）：分身读 PDF 的关键组件
  const popplerOk = (await run('pdftoppm', ['-v'])).ok || (await run('pdftoppm', ['-h'])).ok
  const brewOk = !isWin && (existsSync('/opt/homebrew/bin/brew') || existsSync('/usr/local/bin/brew'))
  items.push({
    key: 'poppler',
    name: 'poppler（PDF 页面渲染）',
    ok: popplerOk,
    required: true,
    用途: '分身读取 PDF（招标文件解析、合同审核等）——缺它会提示"无法读取 pdf"',
    说明: popplerOk
      ? '已安装'
      : isWin
        ? '未检测到——安装包会自动部署 PDF 渲染组件并加入 PATH；请完全退出后重新打开工作台，再点“重新检测”'
        : brewOk
          ? '未检测到——点「一键安装」（brew install poppler，约 1-2 分钟）'
          : '未检测到，且本机没有 Homebrew——先装 Homebrew（brew.sh），或终端执行：/bin/bash -c "$(curl -fsSL https://gitee.com/ineo6/homebrew-install/raw/master/install.sh)"，再回来一键安装',
    安装命令: isWin ? 'https://github.com/oschwartz10612/poppler-windows/releases' : 'brew install poppler',
    canAutoInstall: isWin || (!isWin && brewOk)
  })

  // ④ ocrmac（仅 mac，可选）：扫描版画册离线 OCR
  if (!isWin) {
    let ocrOk = false
    if (pyOk && python) {
      ocrOk = (await run(python, ['-c', 'import ocrmac'])).ok
    }
    items.push({
      key: 'ocrmac',
      name: 'ocrmac（系统离线 OCR）',
      ok: ocrOk,
      required: false,
      用途: '扫描版画册抠图时识别产品名称/型号（数字版画册不需要）',
      说明: ocrOk ? '已安装' : '可选——处理扫描版画册前点「一键安装」即可',
      安装命令: 'pip3 install --user ocrmac',
      canAutoInstall: pyOk
    })
  }
  if (isWin) {
    const tesseract = await run('tesseract', ['--version'])
    items.push({
      key: 'tesseract', name: 'Tesseract OCR（Windows 发票识别）', ok: tesseract.ok, required: true,
      用途: '财务分身识别发票图片并生成台账',
      说明: tesseract.ok ? '已安装' : '必选环境缺失——安装包会自动部署发票识别 OCR 并加入 PATH；请完全退出后重新打开工作台，再点“重新检测”',
      安装命令: '安装包内置 Windows 环境一键安装脚本', canAutoInstall: true
    })
  }

  return {
    items,
    missingRequired: items.filter((i) => i.required && !i.ok).map((i) => i.name)
  }
}

/** 一键安装：只支持 canAutoInstall 的项，串行执行对应命令，返回结果摘要 */
export async function installEnvItem(key: string): Promise<{ ok: boolean; 说明: string }> {
  if (isWin && ['python', 'pydeps', 'poppler', 'tesseract'].includes(key)) {
    const script = windowsBootstrapPath()
    if (!existsSync(script)) return { ok: false, 说明: '安装包内未找到 Windows 环境安装脚本，请重新下载安装包' }
    try {
      const child = spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: false })
      child.unref()
      return { ok: true, 说明: '已打开 Windows 环境安装窗口：将自动安装 Python、PDF 渲染、Tesseract 与依赖库；完成后关闭并重新打开工作台，再点“重新检测”。' }
    } catch (err) {
      return { ok: false, 说明: `无法启动环境安装脚本：${err instanceof Error ? err.message : String(err)}` }
    }
  }
  const python = resolvePython()
  if (key === 'pydeps' || key === 'ocrmac') {
    if (!python) return { ok: false, 说明: '需先安装 Python 3' }
    const pkgs = key === 'pydeps' ? PY_PIP_PKGS : ['ocrmac']
    const r = await new Promise<{ ok: boolean; out: string }>((resolve) => {
      execFile(
        python,
        ['-m', 'pip', 'install', '--user', ...pkgs],
        { timeout: 600000, env: { ...process.env, PATH: augmentedPath() }, windowsHide: true },
        (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.slice(-400) })
      )
    })
    return r.ok
      ? { ok: true, 说明: `已安装：${pkgs.join('、')}` }
      : { ok: false, 说明: `安装失败：${r.out.slice(-200)}——可复制安装命令到终端手动执行` }
  }
  if (key === 'poppler') {
    const brew = existsSync('/opt/homebrew/bin/brew')
      ? '/opt/homebrew/bin/brew'
      : existsSync('/usr/local/bin/brew')
        ? '/usr/local/bin/brew'
        : null
    if (!brew) return { ok: false, 说明: '本机没有 Homebrew，无法一键安装——请按说明手动安装' }
    const r = await new Promise<{ ok: boolean; out: string }>((resolve) => {
      execFile(
        brew,
        ['install', 'poppler'],
        { timeout: 600000, env: { ...process.env, PATH: augmentedPath(), HOMEBREW_NO_AUTO_UPDATE: '1' }, windowsHide: true },
        (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout ?? ''}${stderr ?? ''}`.slice(-400) })
      )
    })
    return r.ok
      ? { ok: true, 说明: '已安装 poppler——分身现在可以读取 PDF 了' }
      : { ok: false, 说明: `安装失败：${r.out.slice(-200)}——可复制安装命令到终端手动执行` }
  }
  return { ok: false, 说明: '该项不支持一键安装，请按说明手动处理' }
}
