import Link from 'next/link';
import { ArrowRight, Package, Terminal, FlaskConical, Globe, Shield, FileText, Network, KeyRound } from 'lucide-react';
import { CopyButton } from './_components/copy-button';

const INSTALL_CMD = 'npm i -g movehat';

const TERMINAL_COMMANDS = `npx movehat init my-project
cd my-project && npm install
npm test`;

const CANONICAL_TEST = `import { Harness } from "movehat";

describe("Counter", () => {
  let harness: Harness;

  before(async () => {
    harness = await Harness.createLocal({
      accountLabels: ["deployer", "alice"],
      autoDeploy: ["counter"],
    });
  });

  after(() => harness.cleanup());

  it("alice increments", async () => {
    const alice = harness.runtime.getAccountByLabel("alice");
    await counter.call(alice, "increment", []);
  });
});`;

const GithubIcon = ({ className }: { className?: string }) => (
  <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.28-1.67-1.28-1.67-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.74.4-1.26.73-1.55-2.55-.29-5.24-1.27-5.24-5.66 0-1.25.45-2.27 1.18-3.07-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.15 1.17a10.96 10.96 0 0 1 5.74 0c2.18-1.48 3.14-1.17 3.14-1.17.62 1.58.23 2.75.11 3.04.74.8 1.18 1.82 1.18 3.07 0 4.4-2.69 5.37-5.26 5.65.41.35.77 1.05.77 2.12 0 1.53-.01 2.77-.01 3.14 0 .31.21.68.8.56C20.21 21.39 23.5 17.07 23.5 12 23.5 5.65 18.35.5 12 .5z" />
  </svg>
);

export default function HomePage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-fd-border">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-fd-primary/5 via-transparent to-transparent" />
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_30%_0%,rgba(120,119,198,0.08),transparent_50%)]" />

        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-20 lg:py-28">
          <div className="grid items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-14">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-fd-border bg-fd-card px-3 py-1 text-[11px] font-medium text-fd-muted-foreground sm:mb-6 sm:text-xs">
                <span className="size-1.5 rounded-full bg-green-500" />
                <span>v0.2.0 · published with SLSA provenance</span>
              </div>

              <div className="flex items-center gap-3 sm:gap-4">
                <img
                  src="/movehat.png"
                  alt="Movehat"
                  width={80}
                  height={80}
                  className="size-14 rounded-xl sm:size-16 lg:size-20"
                />
                <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                  Movehat
                </h1>
              </div>

              <p className="mt-4 text-base text-fd-muted-foreground sm:mt-6 sm:text-lg lg:text-xl">
                A Hardhat-like development framework for{' '}
                <a
                  href="https://movementnetwork.xyz/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-fd-foreground underline decoration-fd-primary/40 decoration-2 underline-offset-2 transition-colors hover:decoration-fd-primary"
                >
                  Movement L1
                </a>{' '}
                smart contracts. Write tests and deployment scripts in TypeScript while building Move modules.
              </p>

              <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
                <Link
                  href="/docs"
                  className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90 sm:px-5"
                >
                  Get Started
                  <ArrowRight className="size-4" />
                </Link>
                <Link
                  href="https://github.com/gilbertsahumada/movehat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent sm:px-5"
                >
                  <GithubIcon className="size-4" />
                  View on GitHub
                </Link>
              </div>

              <div className="mt-5 inline-flex max-w-full items-center gap-1 rounded-md border border-fd-border bg-fd-card/50 py-1 pl-3 pr-1 font-mono text-xs text-fd-muted-foreground sm:mt-6 sm:text-sm">
                <Terminal className="size-3.5 shrink-0" />
                <span className="truncate px-1">{INSTALL_CMD}</span>
                <CopyButton text={INSTALL_CMD} label="Copy install command" />
              </div>
            </div>

            {/* Terminal preview */}
            <div className="relative -mx-4 sm:mx-0">
              <div className="border-fd-border bg-fd-card shadow-2xl shadow-fd-primary/10 sm:rounded-xl sm:border">
                <div className="flex items-center gap-1.5 border-y border-fd-border px-3 py-2 sm:border-t-0 sm:px-4">
                  <div className="size-2.5 rounded-full bg-red-500/80 sm:size-3" />
                  <div className="size-2.5 rounded-full bg-yellow-500/80 sm:size-3" />
                  <div className="size-2.5 rounded-full bg-green-500/80 sm:size-3" />
                  <span className="ml-2 font-mono text-[10px] text-fd-muted-foreground sm:ml-3 sm:text-xs">~/my-project</span>
                  <CopyButton
                    text={TERMINAL_COMMANDS}
                    label="Copy commands"
                    className="ml-auto inline-flex items-center justify-center rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
                  />
                </div>
                <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed sm:p-5 sm:text-[13px]">
                  <code className="font-mono">
                    <span className="text-fd-muted-foreground">$</span> <span className="text-fd-foreground">npx movehat init my-project</span>
                    {'\n'}
                    <span className="text-fd-muted-foreground">$</span> <span className="text-fd-foreground">cd my-project && npm install</span>
                    {'\n'}
                    <span className="text-fd-muted-foreground">$</span> <span className="text-fd-foreground">npm test</span>
                    {'\n\n'}
                    <span className="text-fd-muted-foreground">  Starting local Movement node...</span>
                    {'\n'}
                    <span className="text-fd-muted-foreground">  Funded 3 accounts from faucet</span>
                    {'\n'}
                    <span className="text-fd-muted-foreground">  Published counter at 0x82f...</span>
                    {'\n\n'}
                    <span className="text-fd-foreground">  Counter Contract</span>
                    {'\n'}
                    <span className="text-green-500">    ✓</span> <span className="text-fd-foreground">alice can increment her own counter</span> <span className="text-fd-muted-foreground">(240ms)</span>
                    {'\n'}
                    <span className="text-green-500">    ✓</span> <span className="text-fd-foreground">bob can read alice's counter</span> <span className="text-fd-muted-foreground">(58ms)</span>
                    {'\n\n'}
                    <span className="text-green-500">  2 passing</span> <span className="text-fd-muted-foreground">(15s)</span>
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Three execution modes */}
      <section className="border-b border-fd-border">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="mb-8 text-center sm:mb-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Three execution modes</h2>
            <p className="mt-2 text-sm text-fd-muted-foreground sm:mt-3 sm:text-base">One Harness API, three runtimes — pick the one that fits the test.</p>
          </div>

          <div className="grid gap-4 sm:gap-6 sm:grid-cols-3">
            <div className="rounded-xl border border-fd-border bg-fd-card p-5 transition-shadow hover:shadow-md sm:p-6">
              <div className="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary sm:mb-4 sm:size-10">
                <Terminal className="size-4 sm:size-5" />
              </div>
              <h3 className="mb-2 font-semibold">Local</h3>
              <p className="mb-3 text-sm text-fd-muted-foreground">
                Real Movement node spawned by the harness. Funds accounts, deploys modules, runs your tests on a full blockchain.
              </p>
              <code className="font-mono text-xs text-fd-muted-foreground">Harness.createLocal()</code>
            </div>

            <div className="rounded-xl border border-fd-border bg-fd-card p-5 transition-shadow hover:shadow-md sm:p-6">
              <div className="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary sm:mb-4 sm:size-10">
                <FlaskConical className="size-4 sm:size-5" />
              </div>
              <h3 className="mb-2 font-semibold">Fork</h3>
              <p className="mb-3 text-sm text-fd-muted-foreground">
                Read-only JSON snapshot of a remote network. Lazy-loads resources as you read. Real state, zero testnet deploy.
              </p>
              <code className="font-mono text-xs text-fd-muted-foreground">Harness.createFork(network)</code>
            </div>

            <div className="rounded-xl border border-fd-border bg-fd-card p-5 transition-shadow hover:shadow-md sm:p-6">
              <div className="mb-3 inline-flex size-9 items-center justify-center rounded-lg bg-fd-primary/10 text-fd-primary sm:mb-4 sm:size-10">
                <Globe className="size-4 sm:size-5" />
              </div>
              <h3 className="mb-2 font-semibold">Live</h3>
              <p className="mb-3 text-sm text-fd-muted-foreground">
                Binds to a real running network. No local process. Use for deployment scripts and testnet / mainnet flows.
              </p>
              <code className="font-mono text-xs text-fd-muted-foreground">Harness.createLive(network)</code>
            </div>
          </div>
        </div>
      </section>

      {/* How a test looks */}
      <section className="border-b border-fd-border">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="grid gap-6 sm:gap-10 lg:grid-cols-5 lg:gap-12">
            <div className="lg:col-span-2">
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">How a test looks</h2>
              <p className="mt-3 text-sm text-fd-muted-foreground sm:text-base">
                The canonical pattern: construct a Harness, label your accounts, autoDeploy the modules you care about, run your assertions, clean up.
              </p>
              <p className="mt-3 text-sm text-fd-muted-foreground sm:mt-4">
                Lifecycle is explicit. After <code className="rounded bg-fd-muted px-1 py-0.5 font-mono text-xs">cleanup()</code> any further deploy / view / script call throws synchronously — no stale-handle bugs.
              </p>
              <Link
                href="/docs/guides/testing"
                className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-fd-primary hover:underline sm:mt-6"
              >
                Full testing guide
                <ArrowRight className="size-4" />
              </Link>
            </div>

            <div className="-mx-4 sm:mx-0 lg:col-span-3">
              <div className="border-fd-border bg-fd-card overflow-hidden sm:rounded-xl sm:border">
                <div className="flex items-center border-y border-fd-border px-3 py-2 font-mono text-[10px] text-fd-muted-foreground sm:border-t-0 sm:px-4 sm:text-xs">
                  <span>tests/Counter.test.ts</span>
                  <CopyButton
                    text={CANONICAL_TEST}
                    label="Copy test code"
                    className="ml-auto inline-flex items-center justify-center rounded-md p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-foreground"
                  />
                </div>
                <pre className="overflow-x-auto p-3 text-[11px] leading-relaxed sm:p-5 sm:text-[13px]">
                  <code className="font-mono">
                    <span className="text-purple-500">import</span> <span className="text-fd-foreground">{'{ Harness }'}</span> <span className="text-purple-500">from</span> <span className="text-green-500">&quot;movehat&quot;</span>;
                    {'\n\n'}
                    <span className="text-blue-400">describe</span>(<span className="text-green-500">&quot;Counter&quot;</span>, () =&gt; {'{'}
                    {'\n'}
                    {'  '}<span className="text-purple-500">let</span> harness: Harness;
                    {'\n\n'}
                    {'  '}<span className="text-blue-400">before</span>(<span className="text-purple-500">async</span> () =&gt; {'{'}
                    {'\n'}
                    {'    '}harness = <span className="text-purple-500">await</span> Harness.<span className="text-blue-400">createLocal</span>({'{'}
                    {'\n'}
                    {'      '}accountLabels: [<span className="text-green-500">&quot;deployer&quot;</span>, <span className="text-green-500">&quot;alice&quot;</span>],
                    {'\n'}
                    {'      '}autoDeploy: [<span className="text-green-500">&quot;counter&quot;</span>],
                    {'\n'}
                    {'    '}{'}'});
                    {'\n'}
                    {'  '}{'}'});
                    {'\n\n'}
                    {'  '}<span className="text-blue-400">after</span>(() =&gt; harness.<span className="text-blue-400">cleanup</span>());
                    {'\n\n'}
                    {'  '}<span className="text-blue-400">it</span>(<span className="text-green-500">&quot;alice increments&quot;</span>, <span className="text-purple-500">async</span> () =&gt; {'{'}
                    {'\n'}
                    {'    '}<span className="text-purple-500">const</span> alice = harness.runtime.<span className="text-blue-400">getAccountByLabel</span>(<span className="text-green-500">&quot;alice&quot;</span>);
                    {'\n'}
                    {'    '}<span className="text-purple-500">await</span> counter.<span className="text-blue-400">call</span>(alice, <span className="text-green-500">&quot;increment&quot;</span>, []);
                    {'\n'}
                    {'  '}{'}'});
                    {'\n'}
                    {'}'});
                  </code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Built for production */}
      <section className="border-b border-fd-border">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="mb-8 text-center sm:mb-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Built for production</h2>
            <p className="mt-2 text-sm text-fd-muted-foreground sm:mt-3 sm:text-base">Not a toy — a release pipeline with provenance, security hardening, and a real API.</p>
          </div>

          <div className="grid gap-5 sm:gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex gap-3">
              <div className="shrink-0 text-fd-primary">
                <Shield className="size-5" />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">SLSA provenance</h3>
                <p className="text-sm text-fd-muted-foreground">
                  Every npm release ships attestations via Trusted Publishers. Verifiable supply chain.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="shrink-0 text-fd-primary">
                <KeyRound className="size-5" />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">Security hardening</h3>
                <p className="text-sm text-fd-muted-foreground">
                  Path-traversal, command-injection, and YAML-injection guards at every CLI boundary.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="shrink-0 text-fd-primary">
                <FileText className="size-5" />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">TypeDoc reference</h3>
                <p className="text-sm text-fd-muted-foreground">
                  Auto-generated reference for every exported class, interface, and function.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="shrink-0 text-fd-primary">
                <Network className="size-5" />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">Multi-network</h3>
                <p className="text-sm text-fd-muted-foreground">
                  Single <code className="rounded bg-fd-muted px-1 font-mono text-xs">PRIVATE_KEY</code> across testnet / mainnet / local. Hardhat-style.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section>
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="rounded-2xl border border-fd-border bg-gradient-to-br from-fd-primary/5 via-fd-card to-fd-card p-6 text-center sm:p-10 lg:p-14">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl lg:text-4xl">Ready to start?</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-fd-muted-foreground sm:mt-3 sm:text-base">
              Five commands from <code className="rounded bg-fd-muted px-1 font-mono text-xs sm:text-sm">npm install</code> to your first passing test on a real Movement node.
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-3 sm:mt-8">
              <Link
                href="/docs/getting-started/quickstart"
                className="inline-flex items-center gap-2 rounded-lg bg-fd-primary px-4 py-2.5 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90 sm:px-5"
              >
                Read the docs
                <ArrowRight className="size-4" />
              </Link>
              <Link
                href="https://github.com/gilbertsahumada/movehat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent sm:px-5"
              >
                <GithubIcon className="size-4" />
                GitHub
              </Link>
              <Link
                href="https://www.npmjs.com/package/movehat"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-card px-4 py-2.5 text-sm font-medium transition-colors hover:bg-fd-accent sm:px-5"
              >
                <Package className="size-4" />
                npm
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
