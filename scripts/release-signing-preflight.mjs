#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const requiredSecrets = [
  {
    id: 'android',
    label: 'Android signed APK/AAB',
    secrets: ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'],
  },
  {
    id: 'windows',
    label: 'Windows Authenticode installer',
    secrets: ['WINDOWS_CSC_LINK', 'WINDOWS_CSC_KEY_PASSWORD'],
  },
]

function parseArgs(argv) {
  const args = {
    repo: process.env.NOCLICK_GITHUB_REPO || gitRepo(),
    json: false,
    strict: true,
    secretListFile: process.env.NOCLICK_SIGNING_PREFLIGHT_SECRET_LIST_FILE || '',
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
    if (arg === '--secret-list-file') {
      args.secretListFile = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg.startsWith('--secret-list-file=')) {
      args.secretListFile = arg.slice('--secret-list-file='.length)
      continue
    }
    if (arg === '--json') {
      args.json = true
      continue
    }
    if (arg === '--no-strict') {
      args.strict = false
      continue
    }
    if (arg === '--strict') {
      args.strict = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!args.repo) throw new Error('GitHub repository could not be inferred. Pass --repo owner/name.')
  return args
}

function usage() {
  console.log(`Usage: npm run release:preflight -- [options]

Checks whether the GitHub repository has the signing secrets needed before
running Build App Packages with require_signing=true. Secret values are not read.

Options:
  --repo <owner/name>          GitHub repository. Defaults to git remote origin.
  --json                       Print JSON instead of text.
  --strict                     Exit nonzero when required secrets are missing. Default.
  --no-strict                  Report only; always exit zero.
  --secret-list-file <path>    Read a mocked gh secret list output. Used by smoke tests.
`)
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function gitRepo() {
  try {
    const remote = run('git', ['remote', 'get-url', 'origin'])
    const normalized = remote
      .replace(/^git@github\.com:/, '')
      .replace(/^https:\/\/github\.com\//, '')
      .replace(/\.git$/, '')
      .trim()
    return /^[^/\s]+\/[^/\s]+$/.test(normalized) ? normalized : ''
  } catch {
    return ''
  }
}

function readSecretNames(args) {
  const output = args.secretListFile
    ? readFileSync(args.secretListFile, 'utf8')
    : run('gh', ['secret', 'list', '--repo', args.repo])

  return new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter(Boolean),
  )
}

function buildReport(repo, secretNames) {
  const groups = requiredSecrets.map((group) => {
    const missing = group.secrets.filter((secret) => !secretNames.has(secret))
    const present = group.secrets.filter((secret) => secretNames.has(secret))
    return {
      ...group,
      present,
      missing,
      ready: missing.length === 0,
    }
  })
  const missing = groups.flatMap((group) => group.missing)
  return {
    ok: missing.length === 0,
    repo,
    groups,
    missing,
    nextCommand: missing.length
      ? 'gh secret set <NAME> --repo ' + repo
      : 'gh workflow run "Build App Packages" --ref main -f require_signing=true -f create_github_release=false',
  }
}

function printReport(report) {
  console.log(`Signing preflight: ${report.repo}`)
  report.groups.forEach((group) => {
    const status = group.ready ? 'READY' : 'MISSING'
    console.log(`${status.padEnd(7)} ${group.label}`)
    if (group.missing.length) console.log(`        missing: ${group.missing.join(', ')}`)
  })

  if (report.ok) {
    console.log(`Next: ${report.nextCommand}`)
  } else {
    console.log('Add missing GitHub Actions secrets, then re-run this preflight.')
  }
}

try {
  const args = parseArgs(process.argv)
  const report = buildReport(args.repo, readSecretNames(args))
  if (args.json) console.log(JSON.stringify(report, null, 2))
  else printReport(report)
  if (args.strict && !report.ok) process.exit(1)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
