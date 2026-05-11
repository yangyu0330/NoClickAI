#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const DEFAULT_REPO = 'yangyu0330/NoClickAI'

function parseArgs(argv) {
  const args = {
    repo: process.env.GITHUB_REPOSITORY || DEFAULT_REPO,
    run: '',
    releaseTag: '',
    artifact: '',
    inputDir: '',
    output: '',
    force: false,
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--repo') {
      args.repo = argv[index + 1] || args.repo
      index += 1
      continue
    }
    if (arg.startsWith('--repo=')) {
      args.repo = arg.slice('--repo='.length)
      continue
    }
    if (arg === '--run') {
      args.run = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--run=')) {
      args.run = arg.slice('--run='.length)
      continue
    }
    if (arg === '--release-tag') {
      args.releaseTag = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--release-tag=')) {
      args.releaseTag = arg.slice('--release-tag='.length)
      continue
    }
    if (arg === '--artifact') {
      args.artifact = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--artifact=')) {
      args.artifact = arg.slice('--artifact='.length)
      continue
    }
    if (arg === '--input-dir') {
      args.inputDir = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--input-dir=')) {
      args.inputDir = arg.slice('--input-dir='.length)
      continue
    }
    if (arg === '--output') {
      args.output = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length)
      continue
    }
    if (arg === '--force') {
      args.force = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!args.run && !args.inputDir) throw new Error('Provide --run <github-run-id> or --input-dir <downloaded-artifact-dir>.')
  if (args.run && args.inputDir) throw new Error('Use only one of --run or --input-dir.')
  if (!args.artifact && args.releaseTag) args.artifact = `noclickai-android-signed-${args.releaseTag}`
  if (args.run && !args.artifact) throw new Error('Provide --release-tag or --artifact when downloading from a GitHub run.')
  if (!args.output) args.output = join('release', 'android-play-console', safePathSegment(args.releaseTag || args.run || 'android'))
  return args
}

function usage() {
  console.log(`Usage: npm run android:play-upload -- [options]

Downloads or stages a signed Android workflow artifact, verifies the artifact
checksums and signing evidence, and leaves the Play Console upload files in one
operator-friendly folder. This does not call Google Play APIs.

Options:
  --run <id>             GitHub Actions run ID from Build Signed Android Package.
  --release-tag <tag>    Release tag, used to infer artifact name.
  --artifact <name>      Explicit GitHub artifact name.
  --repo <owner/repo>    GitHub repository. Default: ${DEFAULT_REPO}
  --input-dir <path>     Verify an already-downloaded Android artifact folder.
  --output <path>        Staging folder. Default: release/android-play-console/<tag-or-run>
  --force                Replace the output folder when it is under release/android-play-console or .tmp.

Example:
  npm run android:play-upload -- \\
    --run 25694777212 \\
    --release-tag v0.1.0-android-signed.3
`)
}

function safePathSegment(value) {
  return String(value || 'android').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'android'
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
    throw new Error(`${command} ${args.join(' ')} failed${output ? `:\n${output}` : ''}`)
  }
  return result.stdout || ''
}

function isSafeForceTarget(fullPath) {
  const cwd = resolve(process.cwd())
  const rel = relative(cwd, fullPath).replace(/\\/g, '/')
  return rel.startsWith('release/android-play-console/') || rel.startsWith('.tmp/')
}

async function prepareOutput(outputPath, force) {
  const fullPath = resolve(outputPath)
  if (isAbsolute(outputPath) && !relative(resolve(process.cwd()), fullPath)) {
    throw new Error('--output must not be the repository root.')
  }

  if (existsSync(fullPath)) {
    const current = readdirSync(fullPath)
    if (current.length) {
      if (!force) throw new Error(`Output directory is not empty: ${outputPath}. Re-run with --force to replace it.`)
      if (!isSafeForceTarget(fullPath)) throw new Error(`Refusing to --force delete unsafe output path: ${outputPath}`)
      await rm(fullPath, { recursive: true, force: true })
    }
  }
  await mkdir(fullPath, { recursive: true })
  return fullPath
}

async function stageInputDir(inputDir, outputPath) {
  const inputPath = resolve(inputDir)
  if (!existsSync(inputPath)) throw new Error(`Input directory does not exist: ${inputDir}`)
  const info = await stat(inputPath)
  if (!info.isDirectory()) throw new Error(`Input path is not a directory: ${inputDir}`)
  await cp(inputPath, outputPath, { recursive: true })
}

function findOne(root, predicate, label) {
  const matches = []
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (predicate(entry.name)) matches.push(path)
    }
  }
  walk(root)
  if (!matches.length) throw new Error(`${label} was not found in ${root}`)
  if (matches.length > 1) throw new Error(`Expected one ${label}, found ${matches.length}: ${matches.map((path) => basename(path)).join(', ')}`)
  return matches[0]
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function parseChecksums(content) {
  const rows = new Map()
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (!match) throw new Error(`Invalid checksum line: ${rawLine}`)
    rows.set(match[2].trim(), match[1].toLowerCase())
  }
  return rows
}

function field(content, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = content.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'im'))
  return match ? match[1].trim() : ''
}

function verifyChecksums(root, checksumPath, requiredFiles) {
  const checksums = parseChecksums(readFileSync(checksumPath, 'utf8'))
  for (const file of requiredFiles) {
    const name = basename(file)
    const expected = checksums.get(name)
    if (!expected) throw new Error(`SHA256SUMS-android.txt is missing ${name}`)
    const actual = sha256(file)
    if (actual !== expected) throw new Error(`${name} checksum mismatch: expected ${expected}, got ${actual}`)
  }
  for (const [name, expected] of checksums.entries()) {
    const path = join(dirname(checksumPath), name)
    if (!existsSync(path)) throw new Error(`SHA256SUMS-android.txt references missing file: ${name}`)
    const actual = sha256(path)
    if (actual !== expected) throw new Error(`${name} checksum mismatch: expected ${expected}, got ${actual}`)
  }
}

function verifyEvidence(evidencePath, releaseTag) {
  const content = readFileSync(evidencePath, 'utf8')
  if (field(content, 'Signing required').toLowerCase() !== 'true') {
    throw new Error('ANDROID-SIGNING-EVIDENCE.txt must come from a required signed build.')
  }
  if (releaseTag && field(content, 'Release tag') !== releaseTag) {
    throw new Error(`Evidence release tag is ${field(content, 'Release tag') || 'missing'}; expected ${releaseTag}`)
  }
  if (!field(content, 'Commit')) throw new Error('ANDROID-SIGNING-EVIDENCE.txt is missing Commit.')
  if (!/certificate SHA-256 digest:/i.test(content)) throw new Error('ANDROID-SIGNING-EVIDENCE.txt is missing APK certificate SHA-256 digest.')
  if (!/jar verified/i.test(content)) throw new Error('ANDROID-SIGNING-EVIDENCE.txt is missing AAB jarsigner verification output.')
  return content
}

async function main() {
  const args = parseArgs(process.argv)
  const outputPath = await prepareOutput(args.output, args.force)

  if (args.run) {
    run('gh', ['run', 'download', args.run, '--repo', args.repo, '--name', args.artifact, '--dir', outputPath])
  } else {
    await stageInputDir(args.inputDir, outputPath)
  }

  const apkPath = findOne(outputPath, (name) => name.endsWith('.apk'), 'Android APK')
  const aabPath = findOne(outputPath, (name) => name.endsWith('.aab'), 'Android AAB')
  const evidencePath = findOne(outputPath, (name) => name === 'ANDROID-SIGNING-EVIDENCE.txt', 'Android signing evidence')
  const checksumPath = findOne(outputPath, (name) => name === 'SHA256SUMS-android.txt', 'Android checksum file')

  verifyEvidence(evidencePath, args.releaseTag)
  verifyChecksums(outputPath, checksumPath, [apkPath, aabPath, evidencePath])

  console.log('Android Play Console upload package is ready.')
  console.log(`Output: ${relative(process.cwd(), outputPath) || outputPath}`)
  console.log(`AAB: ${basename(aabPath)}`)
  console.log(`APK: ${basename(apkPath)}`)
  console.log(`Evidence: ${basename(evidencePath)}`)
  console.log('')
  console.log('After uploading the AAB to Play Console, generate launch evidence with:')
  console.log(`npm run launch:evidence -- --android ${join(relative(process.cwd(), outputPath), basename(evidencePath)).replace(/\\/g, '/')} --android-play-console play-console-production-YYYY-MM-DD --output .env.launch.local`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
