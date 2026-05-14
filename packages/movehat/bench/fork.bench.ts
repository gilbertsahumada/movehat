// Fork-system benchmarks (M5.2). Plain tsx script — vitest bench's per-iter
// model doesn't fit Harness.createLocal / Harness.createFork (heavy lifecycle
// ops that spawn a process / snapshot RPC). Each run prints a small table and
// exits. Numbers are wall-clock, measured on the author's machine; CI variance
// is expected for the heavy-setup suites.
//
// Run: pnpm --filter movehat bench
// Output is consumed by BENCHMARKS.md (baseline + after-optimization).

import { performance } from 'node:perf_hooks';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../src/harness/index.js';

interface Sample {
  label: string;
  unit: 'ms';
  values: number[];
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    n: values.length,
    avg,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function printTable(samples: Sample[]) {
  console.log('\n┌─────────────────────────────────────────┬──────┬───────────┬───────────┬───────────┬───────────┐');
  console.log('│ benchmark                               │  n   │   avg     │  median   │   min     │   max     │');
  console.log('├─────────────────────────────────────────┼──────┼───────────┼───────────┼───────────┼───────────┤');
  for (const s of samples) {
    const st = stats(s.values);
    const fmt = (v: number) => `${v.toFixed(1)} ${s.unit}`.padStart(9);
    console.log(
      `│ ${s.label.padEnd(40)}│ ${String(st.n).padStart(4)} │ ${fmt(st.avg)} │ ${fmt(st.median)} │ ${fmt(st.min)} │ ${fmt(st.max)} │`,
    );
  }
  console.log('└─────────────────────────────────────────┴──────┴───────────┴───────────┴───────────┴───────────┘\n');
}

async function measure(label: string, fn: () => Promise<unknown>, iters: number): Promise<Sample> {
  const values: number[] = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    await fn();
    values.push(performance.now() - t0);
  }
  return { label, unit: 'ms', values };
}

async function benchCreateLocal(): Promise<Sample> {
  return measure(
    'Harness.createLocal cold-start',
    async () => {
      const h = await Harness.createLocal({ accountLabels: ['deployer'] });
      await h.cleanup();
    },
    2,
  );
}

async function benchCreateFork(): Promise<Sample> {
  const forkDir = join(tmpdir(), `movehat-bench-fork-${Date.now()}`);
  return measure(
    'Harness.createFork hydrate (testnet)',
    async () => {
      const h = await Harness.createFork('testnet');
      await h.cleanup();
    },
    2,
  ).finally(() => {
    if (existsSync(forkDir)) rmSync(forkDir, { recursive: true, force: true });
  });
}

async function benchRunViewFunction(): Promise<Sample> {
  const h = await Harness.createLocal({ accountLabels: ['deployer', 'alice'], autoDeploy: ['counter'] });
  try {
    const addr = h.runtime.getDeploymentAddress('counter');
    return await measure(
      'runViewFunction RPC roundtrip (local)',
      async () => {
        await h.runViewFunction({
          function: `${addr}::counter::get`,
          functionArguments: [h.runtime.account.accountAddress.toString()],
        });
      },
      50,
    );
  } finally {
    await h.cleanup();
  }
}

async function main() {
  const SUITES = process.env.MH_BENCH_SUITES?.split(',') ?? ['local', 'fork', 'view'];
  const samples: Sample[] = [];

  if (SUITES.includes('local')) {
    console.log('Running: Harness.createLocal cold-start (2 iterations) ...');
    samples.push(await benchCreateLocal());
  }
  if (SUITES.includes('fork')) {
    console.log('Running: Harness.createFork hydrate (2 iterations) ...');
    samples.push(await benchCreateFork());
  }
  if (SUITES.includes('view')) {
    console.log('Running: runViewFunction RPC (50 iterations) ...');
    samples.push(await benchRunViewFunction());
  }

  printTable(samples);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
