import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
const installers = existsSync(dist)
  ? readdirSync(dist).filter((name) => /^AgentWorkbench-Setup-.*\.exe$/i.test(name))
  : []

if (installers.length !== 1) {
  console.error(`Cannot write Windows installer checksum: expected one installer, found ${installers.join(', ') || 'none'}`)
  process.exit(1)
}

const installer = installers[0]
const installerPath = join(dist, installer)
const sha256 = createHash('sha256').update(readFileSync(installerPath)).digest('hex')
const checksumPath = `${installerPath}.sha256`

// Standard SHA-256 format: usable with certutil, PowerShell, shasum and GitHub downloads.
writeFileSync(checksumPath, `${sha256}  ${installer}\n`, 'utf8')
console.log(`Windows installer checksum written: ${checksumPath}`)
