#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const DEFAULT_ENV_FILE = '.env.launch.local'
const DEFAULT_BASE_URL = 'https://noclickai-zeta.vercel.app'

const launchVars = [
  {
    name: 'STRIPE_SECRET_KEY',
    detail: 'Stripe live secret key',
    validate: (value) => value.startsWith('sk_live_') && !isPlaceholder(value),
    expected: 'must start with sk_live_ and not be a placeholder',
  },
  {
    name: 'STRIPE_PRICE_ID',
    detail: 'Stripe recurring Price ID',
    validate: (value) => value.startsWith('price_') && !isPlaceholder(value),
    expected: 'must start with price_ and not be a placeholder',
  },
  {
    name: 'STRIPE_WEBHOOK_SECRET',
    detail: 'Stripe webhook signing secret',
    validate: (value) => value.startsWith('whsec_') && !isPlaceholder(value),
    expected: 'must start with whsec_ and not be a placeholder',
  },
  {
    name: 'NOCLICK_REQUIRE_SUBSCRIPTION',
    detail: 'paid access enforcement',
    validate: (value) => isTrue(value),
    expected: 'must be true for public paid launch',
  },
  {
    name: 'NOCLICK_GOOGLE_OAUTH_VERIFIED',
    detail: 'Google OAuth public verification attestation',
    validate: (value) => isTrue(value),
    expected: 'must be true after Google approval',
  },
  {
    name: 'NOCLICK_GOOGLE_OAUTH_VERIFICATION_EVIDENCE',
    detail: 'non-secret Google verification evidence marker',
    validate: hasEvidence,
    expected: 'must be a non-secret evidence marker',
  },
  {
    name: 'NOCLICK_ANDROID_RELEASE_SIGNED',
    detail: 'Android signed release attestation',
    validate: (value) => isTrue(value),
    expected: 'must be true after signed AAB verification and Play Console upload',
  },
  {
    name: 'NOCLICK_ANDROID_RELEASE_EVIDENCE',
    detail: 'non-secret Android signing evidence marker',
    validate: hasEvidence,
    expected: 'must be a non-secret evidence marker',
  },
  {
    name: 'NOCLICK_WINDOWS_CODE_SIGNED',
    detail: 'Windows code signing attestation',
    validate: (value) => isTrue(value),
    expected: 'must be true after Authenticode verification',
  },
  {
    name: 'NOCLICK_WINDOWS_CODE_SIGNING_EVIDENCE',
    detail: 'non-secret Windows signing evidence marker',
    validate: hasEvidence,
    expected: 'must be a non-secret evidence marker',
  },
]

function parseBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function isTrue(value) {
  return parseBoolean(value)
}

function hasEvidence(value) {
  const trimmed = String(value || '').trim()
  if (trimmed.length < 6) return false
  if (isPlaceholder(trimmed)) return false
  return !/^(true|false|yes|no|todo|tbd|none|null|n\/a)$/i.test(trimmed)
}

function isPlaceholder(value) {
  return /(replace|example|dummy|placeholder|yyyy|mm-dd|\.\.\.)/i.test(String(value || ''))
}

function parseArgs(argv) {
  const args = {
    file: process.env.NOCLICK_LAUNCH_ENV_FILE || DEFAULT_ENV_FILE,
    apply: parseBoolean(process.env.NOCLICK_LAUNCH_ENV_APPLY),
    deploy: parseBoolean(process.env.NOCLICK_LAUNCH_ENV_DEPLOY),
    verify: parseBoolean(process.env.NOCLICK_LAUNCH_ENV_VERIFY),
    strict: parseBoolean(process.env.NOCLICK_LAUNCH_ENV_STRICT),
    baseUrl: process.env.NOCLICK_AUDIT_BASE_URL || DEFAULT_BASE_URL,
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--file') {
      args.file = argv[index + 1] || args.file
      index += 1
      continue
    }
    if (arg.startsWith('--file=')) {
      args.file = arg.slice('--file='.length)
      continue
    }
    if (arg === '--base-url') {
      args.baseUrl = argv[index + 1] || args.baseUrl
      index += 1
      continue
    }
    if (arg.startsWith('--base-url=')) {
      args.baseUrl = arg.slice('--base-url='.length)
      continue
    }
    if (arg === '--apply') {
      args.apply = true
      continue
    }
    if (arg === '--dry-run') {
      args.apply = false
      continue
    }
    if (arg === '--deploy') {
      args.deploy = true
      continue
    }
    if (arg === '--no-deploy') {
      args.deploy = false
      continue
    }
    if (arg === '--verify') {
      args.verify = true
      continue
    }
    if (arg === '--no-verify') {
      args.verify = false
      continue
    }
    if (arg === '--strict') {
      args.strict = true
      continue
    }
    if (arg === '--no-strict') {
      args.strict = false
      continue
    }
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  args.baseUrl = args.baseUrl.replace(/\/+$/, '')
  return args
}

function usage() {
  console.log(`Usage: npm run launch:env -- [options]

Reads a local, gitignored launch env file, validates public-launch values, and
optionally writes them to Vercel Production.

Options:
  --file <path>     Env file to read. Default: ${DEFAULT_ENV_FILE}
  --apply           Write validated values to Vercel Production.
  --dry-run         Validate only. This is the default.
  --deploy          After --apply, deploy the current checkout to Production.
  --verify          Run launch:status after applying/deploying.
  --strict          After --verify, run the strict production audit.
  --base-url <url>  Production URL. Default: ${DEFAULT_BASE_URL}
`)
}

function parseDotenv(filePath) {
  const content = readFileSync(filePath, 'utf8')
  const env = {}

  content.split(/\r?\n/).forEach((rawLine, index) => {
    let line = rawLine.trim()
    if (!line || line.startsWith('#')) return
    if (line.startsWith('export ')) line = line.slice('export '.length).trim()

    const equals = line.indexOf('=')
    if (equals === -1) {
      throw new Error(`${filePath}:${index + 1} is not KEY=value`)
    }

    const key = line.slice(0, equals).trim()
    let value = line.slice(equals + 1).trim()
    if (!/^[A-Z0-9_]+$/.test(key)) {
      throw new Error(`${filePath}:${index + 1} has invalid env key "${key}"`)
    }

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const hash = value.indexOf(' #')
      if (hash !== -1) value = value.slice(0, hash).trim()
    }

    env[key] = value
  })

  return env
}

function validateLaunchEnv(env) {
  const failures = []
  const rows = launchVars.map((item) => {
    const value = env[item.name] || ''
    const present = Boolean(value)
    const valid = present && item.validate(value)
    if (!valid) {
      failures.push({
        name: item.name,
        reason: present ? item.expected : 'missing',
      })
    }
    return {
      ...item,
      present,
      valid,
    }
  })
  return { rows, failures }
}

function printValidation(rows) {
  console.log('Launch env validation:')
  rows.forEach((row) => {
    const status = row.valid ? 'READY' : row.present ? 'INVALID' : 'MISSING'
    console.log(`${status.padEnd(7)} ${row.name} - ${row.detail}`)
  })
}

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: options.input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    input: options.input,
    env: process.env,
  })

  if (result.status !== 0) {
    const detail = `${result.stdout || ''}${result.stderr || ''}`.trim()
    throw new Error(`${command} ${args.join(' ')} failed${detail ? `:\n${detail}` : ''}`)
  }

  return `${result.stdout || ''}${result.stderr || ''}`.trim()
}

function localGitHead() {
  return run('git', ['rev-parse', 'HEAD'])
}

function applyVercelEnv(env, rows) {
  const npx = commandName('npx')
  for (const row of rows) {
    const value = env[row.name]
    console.log(`APPLY   ${row.name} -> Vercel Production`)
    run(npx, ['vercel@latest', 'env', 'add', row.name, 'production', '--force', '--yes'], {
      input: value,
    })
  }
}

function deployProduction(commitSha) {
  const npx = commandName('npx')
  console.log(`DEPLOY  Vercel Production commit ${commitSha}`)
  run(npx, [
    'vercel@latest',
    'deploy',
    '--prod',
    '--yes',
    '--force',
    '-e',
    `NOCLICK_COMMIT_SHA=${commitSha}`,
    '-b',
    `NOCLICK_COMMIT_SHA=${commitSha}`,
  ])
}

function verifyLaunchStatus(baseUrl, commitSha) {
  const npm = commandName('npm')
  run(npm, ['run', 'launch:status', '--', '--base-url', baseUrl, '--expected-commit', commitSha])
}

function runStrictAudit(baseUrl, commitSha) {
  const npm = commandName('npm')
  run(npm, [
    'run',
    'audit:production',
    '--',
    '--base-url',
    baseUrl,
    '--expected-commit',
    commitSha,
    '--strict-launch',
  ])
}

async function main() {
  const args = parseArgs(process.argv)
  const filePath = resolve(args.file)
  const env = parseDotenv(filePath)
  const { rows, failures } = validateLaunchEnv(env)

  printValidation(rows)

  if (failures.length) {
    console.error('\nFix these values before applying:')
    failures.forEach((failure) => {
      console.error(`- ${failure.name}: ${failure.reason}`)
    })
    process.exit(1)
  }

  if (!args.apply) {
    console.log(`\nDry run only. To update Vercel Production, run:\n  npm run launch:env -- --file ${args.file} --apply --deploy --verify --strict`)
    return
  }

  const commitSha = localGitHead()
  applyVercelEnv(env, rows)

  if (args.deploy) {
    deployProduction(commitSha)
  } else {
    console.log('\nValues were applied. Redeploy production before expecting /v1/readiness to change.')
  }

  if (args.verify) {
    verifyLaunchStatus(args.baseUrl, commitSha)
  }

  if (args.strict) {
    runStrictAudit(args.baseUrl, commitSha)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
