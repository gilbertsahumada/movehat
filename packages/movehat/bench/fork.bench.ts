// Fork-system benchmarks. Plain tsx script — vitest bench's per-iter model
// doesn't fit Harness.createLocal / Harness.createFork (heavy lifecycle ops
// that spawn a process / snapshot RPC). Each run prints a small table and
// exits. Numbers are wall-clock, measured on the author's machine; CI
// variance is expected for the heavy-setup suites.
//
// Run: pnpm --filter movehat bench
// Output is consumed by BENCHMARKS.md.

import { performance } from 'node:perf_hooks';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Harness } from '../src/harness/index.js';
import { ForkManager } from '../src/fork/manager.js';
import { ForkStorage } from '../src/fork/storage.js';

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
  const forkName = `movehat-bench-fork-${Date.now()}`;
  const forkDir = join(process.cwd(), '.movehat', 'forks', forkName);
  // Hydrate outside the measured loop so every sampled iteration is a
  // warm-cache access; otherwise the cold hydrate dominates the median.
  const warm = await Harness.createFork({
    network: 'testnet',
    name: forkName,
    resetState: false,
  });
  try {
    await warm.forkManager?.getAllResources('0x1');
  } finally {
    await warm.cleanup();
  }
  return measure(
    'Harness.createFork cached read (testnet)',
    async () => {
      const h = await Harness.createFork({
        network: 'testnet',
        name: forkName,
        resetState: false,
      });
      try {
        await h.forkManager?.getAllResources('0x1');
      } finally {
        await h.cleanup();
      }
    },
    2,
  ).finally(() => {
    if (existsSync(forkDir)) rmSync(forkDir, { recursive: true, force: true });
  });
}

async function benchGetResourceWarm(): Promise<Sample> {
  // Fully offline: the fork is fabricated on disk and warm cache hits never
  // touch the upstream API client.
  const dir = mkdtempSync(join(tmpdir(), 'movehat-bench-resource-'));
  const forkDir = join(dir, 'bench-fork');
  const address = `0x${'a'.repeat(64)}`;
  const storage = new ForkStorage(forkDir);
  storage.initialize();
  storage.saveMetadata({
    network: 'custom',
    nodeUrl: 'http://127.0.0.1:1/v1',
    chainId: 27,
    ledgerVersion: '100',
    timestamp: '0',
    epoch: '1',
    blockHeight: '1',
    createdAt: new Date().toISOString(),
  });
  const resources: Record<string, unknown> = {};
  for (let i = 0; i < 500; i++) {
    resources[`0x1::bench::R${i}`] = { value: String(i), blob: 'x'.repeat(2000) };
  }
  storage.saveAllResources(address, resources);
  const manager = new ForkManager(forkDir);
  manager.load();
  return measure(
    'getResource warm hit (500-entry map)',
    async () => {
      for (let i = 0; i < 100; i++) {
        await manager.getResource(address, `0x1::bench::R${i % 500}`);
      }
    },
    20,
  ).finally(() => rmSync(dir, { recursive: true, force: true }));
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
  const SUITES = process.env.MH_BENCH_SUITES?.split(',') ?? ['local', 'fork', 'view', 'resource'];
  const samples: Sample[] = [];

  if (SUITES.includes('local')) {
    console.log('Running: Harness.createLocal cold-start (2 iterations) ...');
    samples.push(await benchCreateLocal());
  }
  if (SUITES.includes('fork')) {
    console.log('Running: Harness.createFork cached read (2 iterations) ...');
    samples.push(await benchCreateFork());
  }
  if (SUITES.includes('view')) {
    console.log('Running: runViewFunction RPC (50 iterations) ...');
    samples.push(await benchRunViewFunction());
  }
  if (SUITES.includes('resource')) {
    console.log('Running: getResource warm hit (20 iterations) ...');
    samples.push(await benchGetResourceWarm());
  }

  printTable(samples);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
