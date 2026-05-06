import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold mb-4 sm:text-5xl">Movehat</h1>
      <p className="text-fd-muted-foreground text-lg mb-8 max-w-2xl">
        A Hardhat-like development framework for Movement L1 and Aptos Move
        smart contracts. Write your tests and deployment scripts in TypeScript.
      </p>
      <div className="flex gap-4 flex-wrap justify-center">
        <Link
          href="/docs"
          className="rounded-lg bg-fd-primary px-6 py-3 text-fd-primary-foreground font-medium hover:bg-fd-primary/90 transition-colors"
        >
          Get Started
        </Link>
        <Link
          href="https://github.com/movehat/movehat"
          className="rounded-lg border border-fd-border px-6 py-3 font-medium hover:bg-fd-accent transition-colors"
        >
          GitHub
        </Link>
      </div>
      <div className="mt-16 grid gap-6 sm:grid-cols-3 max-w-4xl text-left">
        <div className="rounded-lg border border-fd-border p-6">
          <h3 className="font-semibold mb-2">Local Node Testing</h3>
          <p className="text-fd-muted-foreground text-sm">
            Run a real Movement blockchain locally for testing, just like
            Hardhat.
          </p>
        </div>
        <div className="rounded-lg border border-fd-border p-6">
          <h3 className="font-semibold mb-2">TypeScript-First</h3>
          <p className="text-fd-muted-foreground text-sm">
            Write tests and deployment scripts in TypeScript with full type
            safety.
          </p>
        </div>
        <div className="rounded-lg border border-fd-border p-6">
          <h3 className="font-semibold mb-2">Native Fork System</h3>
          <p className="text-fd-muted-foreground text-sm">
            Create local snapshots of Movement L1 with real network state for
            testing.
          </p>
        </div>
      </div>
    </main>
  );
}
