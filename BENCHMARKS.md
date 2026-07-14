# Movehat Benchmarks

Performance baseline for the fork system.

## Methodology

- **Tool**: plain tsx script (`packages/movehat/bench/fork.bench.ts`) using `performance.now()`. Not `vitest bench` — the heavy lifecycle operations (`createLocal`, `createFork`) don't fit microbench iteration semantics (process spawn + RPC snapshot per iteration). The runViewFunction RPC suite is run as a tight loop against a long-running harness.
- **Run**: `pnpm bench` from the repo root (cd's into `examples/counter-example` so the runtime can load a `movehat.config.ts`).
- **Iterations**: `createLocal` × 2, `createFork` cold × 1, the same fork cached × 2, `runViewFunction` × 50. Cold and cached fork samples are deliberately separate so their distributions are not mixed.
- **Output**: wall-clock milliseconds. Each row reports n, avg, median, min, max.

## Hardware

| Field | Value |
|---|---|
| Host | macOS Darwin 25.3.0 arm64 (M-series) |
| Node | v20.19.6 |
| Movement CLI | v7.4.0 |
| Network (fork) | https://testnet.movementnetwork.xyz/v1 |
| Network (local) | local Movement node spawned by Movehat |

CI variance is expected on Linux x86_64 GitHub Actions runners — Movement CLI startup is the dominant cost of the `createLocal` suite and depends on host I/O / scheduler. The numbers below are author-machine measurements, not CI-reproducible benchmarks.

## Baseline (author's machine, 2026-05-14)

| Benchmark                              |  n  |    avg     |  median    |   min      |   max      |
|----------------------------------------|-----|------------|------------|------------|------------|
| Harness.createLocal cold-start         |  2  | 15133.2 ms | 15176.0 ms | 15090.3 ms | 15176.0 ms |
| Harness.createFork hydrate (testnet, historical mixed cold/warm baseline) |  2  |  2455.0 ms |  3478.4 ms |  1431.6 ms |  3478.4 ms |
| runViewFunction RPC roundtrip (local)  | 50  |     3.0 ms |     2.6 ms |     1.6 ms |    15.9 ms |

## Where the time goes

### `createLocal` ≈ 15 s

Dominated by the external `movement node run-local-testnet` process startup — Movement CLI spends ~12-13 s building the Move framework runtime + initial genesis state before the RPC port comes up. The remaining ~2 s is Movehat's account generation + funding + first deploy.

**Optimization potential on the Movehat side**: ~zero. The external process startup is not under our control. A future Movement CLI release with a "fast start" mode (or a pre-built genesis cache) would shift this floor; until then, this is fixed cost.

### `createFork` ≈ 2.5 s

The cold path performs one `getLedgerInfo` RPC, initializes local metadata, starts the JSON server, and creates isolated test accounts. Resources remain lazy-loaded on first request. Cached runs reuse the pinned ledger metadata and reset only the writable overlay, so the revised benchmark reports them separately.

The historical row mixed one cold and one cached run, so its variance cannot be attributed solely to RPC latency. New runs avoid that methodological error and also delete the exact fork directory they create.

### `runViewFunction` ≈ 3 ms

Already near the RPC floor (HTTP keep-alive + JSON parse). The implementation in `src/harness/view.ts` is a thin wrapper over `aptos.view()` from the Movement TS SDK — there is no Movehat-side overhead to remove. The 15.9 ms max in the sample is one outlier on the 50-iter loop (probably a GC pause or scheduler hiccup); the median 2.6 ms is the steady-state cost.

## Optimization wins applied

**None applied.** Policy: if <5% improvement, document the negative result and don't claim a win. The three obvious candidates were each evaluated:

| Candidate | Inspected | Outcome |
|---|---|---|
| Parallelize `ForkManager.getAllResources` (Promise.all) | yes | **Not applicable** — the method already issues a single `getAccountResources` API call that returns all resources at once. No sequential loop to parallelize. |
| Cache `getLedgerInfo` for the Harness lifetime | yes | **Not applicable** — `getLedgerInfo` is called exactly once during `ForkManager.initialize()`. Caching benefits zero subsequent calls within a single Harness instance. |
| Reduce `runViewFunction` overhead | yes | **Not applicable** — implementation is a 5-line wrapper over `aptos.view()`. No Movehat-side work to remove. |

The honest conclusion: prior work already left the fork system reasonably tight. The dominant costs (Movement CLI startup, testnet RPC latency) are external. Future perf work should target either (a) Movement CLI fast-start mode (upstream, not us), or (b) caching strategies that span Harness lifetimes (e.g. snapshot reuse across `createFork` calls).

## How to reproduce

```bash
# Full suite (~30 s)
pnpm bench

# Single suite via MH_BENCH_SUITES env var
MH_BENCH_SUITES=local pnpm bench
MH_BENCH_SUITES=fork  pnpm bench
MH_BENCH_SUITES=view  pnpm bench
```

Requires: Movement CLI on PATH (`movement --version`), network access for the `fork` suite, and a `movehat.config.ts` in the working directory (the script cd's into `examples/counter-example` automatically).

## Related issues fixed alongside this baseline

- **#63** — `ForkManager.fundAccount` previously synthesized `authentication_key` as `address.padEnd(66, '0')`, which was a no-op since normalized addresses are already 66 characters. Replaced with a deterministic SHA3-256 hash of the address, producing a 66-char hex value distinguishable from the address itself. Documented in code as a fork-mode placeholder — downstream code must NOT trust it as real key material.
