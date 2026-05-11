#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const releaseTag = 'v1.2.3-android'
const commit = 'abcdef1234567890abcdef1234567890abcdef12'
const apkName = `NoClickAI-Android-${releaseTag}.apk`
const aabName = `NoClickAI-Android-${releaseTag}.aab`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function digest(content) {
  return createHash('sha256').update(content).digest('hex')
}

function runPrepare(args) {
  const result = spawnSync(process.execPath, ['scripts/prepare-android-play-upload.mjs', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
  }
}

const dir = await mkdtemp(join(tmpdir(), 'noclick-android-play-upload-smoke-'))

try {
  const inputDir = join(dir, 'artifact')
  const outputDir = join(dir, 'play-upload')
  const badOutputDir = join(dir, 'bad-play-upload')
  await writeFile(join(dir, 'placeholder'), '')
  await rm(inputDir, { recursive: true, force: true })
  await rm(outputDir, { recursive: true, force: true })
  await rm(badOutputDir, { recursive: true, force: true })

  const apk = 'signed apk bytes'
  const aab = 'signed aab bytes'
  const evidence = `NoClick AI Android signing evidence
Release tag: ${releaseTag}
Commit: ${commit}
Signing required: true
Generated at: 2026-05-12T00:00:00Z

APK: ${apkName}
Signer #1 certificate SHA-256 digest: AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99

AAB: ${aabName}
jar verified.
`

  await rm(inputDir, { recursive: true, force: true })
  await mkdir(inputDir, { recursive: true })
  await writeFile(join(inputDir, apkName), apk)
  await writeFile(join(inputDir, aabName), aab)
  await writeFile(join(inputDir, 'ANDROID-SIGNING-EVIDENCE.txt'), evidence)
  await writeFile(
    join(inputDir, 'SHA256SUMS-android.txt'),
    `${digest(evidence)}  ANDROID-SIGNING-EVIDENCE.txt\n${digest(aab)}  ${aabName}\n${digest(apk)}  ${apkName}\n`,
  )

  const prepared = runPrepare(['--input-dir', inputDir, '--release-tag', releaseTag, '--output', outputDir])
  assert(prepared.status === 0, `valid artifact failed:\n${prepared.output}`)
  assert(prepared.output.includes('Android Play Console upload package is ready.'), 'success message missing')
  assert(prepared.output.includes(aabName), 'AAB name missing from output')
  assert(prepared.output.includes('npm run launch:evidence'), 'next launch evidence command missing')

  const copiedEvidence = await readFile(join(outputDir, 'ANDROID-SIGNING-EVIDENCE.txt'), 'utf8')
  assert(copiedEvidence.includes('Signing required: true'), 'evidence was not copied')

  await rm(badOutputDir, { recursive: true, force: true })
  await mkdir(badOutputDir, { recursive: true })
  await cp(inputDir, badOutputDir, { recursive: true })
  await writeFile(join(badOutputDir, 'SHA256SUMS-android.txt'), `0000000000000000000000000000000000000000000000000000000000000000  ${apkName}\n`)
  const bad = runPrepare(['--input-dir', badOutputDir, '--release-tag', releaseTag, '--output', join(dir, 'bad-out')])
  assert(bad.status !== 0, 'checksum mismatch unexpectedly passed')
  assert(bad.output.includes('checksum'), 'checksum failure did not explain the problem')

  console.log('Android Play upload smoke passed')
} finally {
  await rm(dir, { recursive: true, force: true })
}
