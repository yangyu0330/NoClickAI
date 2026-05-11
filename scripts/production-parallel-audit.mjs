#!/usr/bin/env node

import { spawn } from 'node:child_process'

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parseArgs(argv) {
  const args = {
    runs: parsePositiveInteger(process.env.NOCLICK_PARALLEL_AUDIT_RUNS, 2),
    passThrough: [],
  }

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--runs') {
      args.runs = parsePositiveInteger(argv[index + 1], args.runs)
      index += 1
      continue
    }
    if (arg.startsWith('--runs=')) {
      args.runs = parsePositiveInteger(arg.slice('--runs='.length), args.runs)
      continue
    }
    args.passThrough.push(arg)
  }

  args.runs = Math.min(args.runs, 8)
  return args
}

function runAudit(index, passThrough) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/production-audit.mjs', ...passThrough], {
      env: {
        ...process.env,
        NOCLICK_AUDIT_WORKER: String(index),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('close', (code) => {
      resolve({ code, index, stdout, stderr })
    })
  })
}

function printResult(result) {
  console.log(`\n--- production audit worker ${result.index} ${result.code === 0 ? 'PASS' : 'FAIL'} ---`)
  process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

async function main() {
  const { runs, passThrough } = parseArgs(process.argv)
  console.log(`NoClick AI parallel production audit: ${runs} run(s)`)

  const results = await Promise.all(Array.from({ length: runs }, (_, index) => runAudit(index + 1, passThrough)))
  for (const result of results) printResult(result)

  const failures = results.filter((result) => result.code !== 0)
  if (failures.length) {
    console.error(`Parallel production audit failed: ${failures.length}/${runs} worker(s) failed.`)
    process.exitCode = 1
    return
  }

  console.log(`Parallel production audit passed: ${runs}/${runs} worker(s) succeeded.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
