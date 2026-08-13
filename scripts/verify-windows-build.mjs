import { existsSync, openSync, readSync, closeSync } from 'node:fs'
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

console.log('Windows x64 package verified: main executable and agent runtime are present.')
