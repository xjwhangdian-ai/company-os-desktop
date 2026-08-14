import { existsSync, openSync, readSync, closeSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

const root = process.cwd()
const unpacked = join(root, 'dist', 'win-unpacked')
const appExe = join(unpacked, 'AgentWorkbench.exe')
const agentExe = join(
  unpacked,
  'resources',
  'app.asar.unpacked',
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk',
  'node_modules',
  '@anthropic-ai',
  'claude-agent-sdk-win32-x64',
  'claude.exe'
)
const runtimeDir = join(unpacked, 'resources', 'windows-deps')
const runtimeManifest = join(runtimeDir, 'runtime-manifest.json')

function fail(message) {
  console.error(`Windows package verification failed: ${message}`)
  process.exit(1)
}

function readPeMachine(file) {
  const fd = openSync(file, 'r')
  try {
    const dosHeader = Buffer.alloc(64)
    readSync(fd, dosHeader, 0, dosHeader.length, 0)
    if (dosHeader.toString('ascii', 0, 2) !== 'MZ') fail(`${file} is not a PE executable`)

    const peOffset = dosHeader.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(6)
    readSync(fd, peHeader, 0, peHeader.length, peOffset)
    if (peHeader.toString('ascii', 0, 4) !== 'PE\0\0') fail(`${file} has no PE header`)
    return peHeader.readUInt16LE(4)
  } finally {
    closeSync(fd)
  }
}

if (!existsSync(appExe)) fail(`missing main executable: ${appExe}`)
if (readPeMachine(appExe) !== 0x8664) fail('AgentWorkbench.exe is not Windows x64')
if (!existsSync(agentExe)) fail(`missing Windows x64 agent runtime: ${agentExe}`)
if (readPeMachine(agentExe) !== 0x8664) fail('claude.exe is not Windows x64')

if (!existsSync(runtimeManifest)) fail(`missing runtime manifest: ${runtimeManifest}`)
let manifest
try {
  manifest = JSON.parse(readFileSync(runtimeManifest, 'utf8').replace(/^\uFEFF/, ''))
} catch (err) {
  fail(`invalid runtime manifest: ${err instanceof Error ? err.message : String(err)}`)
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail('runtime manifest has no files')
for (const required of ['python-installer.exe', 'tesseract/tesseract.exe', 'poppler.zip', 'repair-runtime.bat']) {
  if (!manifest.files.some((file) => file.path === required)) fail(`runtime manifest lacks ${required}`)
}
for (const file of manifest.files) {
  const target = join(runtimeDir, ...String(file.path).split('/'))
  if (!existsSync(target)) fail(`missing embedded runtime file: ${file.path}`)
  if (statSync(target).size !== file.size || file.size <= 0) fail(`invalid embedded runtime size: ${file.path}`)
  const actual = createHash('sha256').update(readFileSync(target)).digest('hex')
  if (actual !== file.sha256) fail(`embedded runtime hash mismatch: ${file.path}`)
}
const installers = readdirSync(join(root, 'dist')).filter((name) => /^AgentWorkbench-Setup-.*\.exe$/i.test(name))
if (installers.length !== 1) fail(`expected one ASCII-named NSIS installer, found: ${installers.join(', ') || 'none'}`)
if (statSync(join(root, 'dist', installers[0])).size < 50 * 1024 * 1024) fail('NSIS installer is unexpectedly small')

console.log('Windows x64 package verified: app, agent runtime, offline dependencies, and NSIS installer are present.')
