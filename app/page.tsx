export default function Home() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="inline-block size-3 rounded-full bg-primary" aria-hidden />
        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Cadence
        </span>
      </div>

      <div className="space-y-4">
        <h1 className="text-4xl font-semibold tracking-tight">
          A multi-agent AI sales team.
        </h1>
        <p className="max-w-prose text-muted-foreground">
          Nine agents share one database brain, coordinate through a Sales
          Manager, and route every outbound action through a consent gate.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <span className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          Consent gate on every send
        </span>
        <span className="rounded-md border px-3 py-1.5 text-sm text-foreground">
          Scaffold ready
        </span>
      </div>
    </main>
  );
}
