import Link from 'next/link';
import { RepoInput } from '@/components/repo-input';
import { FixtureGrid } from '@/components/fixture-grid';
import { SandboxBanner } from '@/components/sandbox-banner';

export default function HomePage() {
  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6">
      {/* ------------------------------------------------------------------ */}
      {/* Hero: the thesis is the excavation itself                          */}
      {/* ------------------------------------------------------------------ */}
      <section className="blueprint-grid relative -mx-4 border-b border-line px-4 py-16 sm:-mx-6 sm:px-6 sm:py-24">
        <div className="relative mx-auto max-w-3xl">
          <p className="label mb-5 animate-fade-up">Software archaeology</p>

          <h1 className="mb-6 animate-fade-up font-mono text-3xl font-semibold leading-[1.1] tracking-display text-ink sm:text-5xl">
            Paste an abandoned repo.
            <br />
            <span className="text-brass">Revive tries to make it run again.</span>
          </h1>

          <p className="mb-9 max-w-2xl animate-fade-up text-sm leading-relaxed text-muted sm:text-base">
            Most dead repositories are not badly written. They are stranded — built for a Node, a
            Python, a JDK that no longer exists on your machine. Revive works out which one,
            reconstructs it, and changes as little as possible to get a build back.
          </p>

          <div className="animate-fade-up">
            <RepoInput autoFocus />
          </div>

          <div className="mt-6">
            <SandboxBanner />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* How it works — a real sequence, so numbering earns its place        */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-b border-line py-16">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label mb-2">The method</p>
            <h2 className="font-mono text-xl font-semibold tracking-display text-ink">
              Dig before you rebuild
            </h2>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-muted">
            A dependency bot upgrades everything and hopes. Revive does the opposite: it
            establishes what actually worked, then makes the smallest change that gets there.
          </p>
        </div>

        <ol className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              step: '01',
              title: 'Date the specimen',
              body: 'Read .nvmrc, engines, lockfile format, CI config and commit dates. Each is weighted; the result is a runtime version with an evidence trail you can audit.',
            },
            {
              step: '02',
              title: 'Run it untouched',
              body: 'Install, build, test and start the project exactly as its author left it. Nothing is modified until a real failure exists to point at.',
            },
            {
              step: '03',
              title: 'Name the blocker',
              body: 'Match the output against known ecosystem history — OpenSSL 3 and webpack 4, npm 7 peer conflicts, stdlib removals, JDK release floors.',
            },
            {
              step: '04',
              title: 'Repair and verify',
              body: 'Apply the smallest fix, re-run everything, keep it only if the project measurably improved. Failed attempts are rolled back and still reported.',
            },
          ].map((item) => (
            <li key={item.step} className="bg-surface p-5">
              <div className="mb-3 font-mono text-2xs tracking-label text-brass">{item.step}</div>
              <h3 className="mb-2 text-sm font-semibold text-ink">{item.title}</h3>
              <p className="text-xs leading-relaxed text-muted">{item.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Demo specimens                                                      */}
      {/* ------------------------------------------------------------------ */}
      <section className="border-b border-line py-16">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label mb-2">Demo shelf</p>
            <h2 className="font-mono text-xl font-semibold tracking-display text-ink">
              Eight repositories, each broken a different way
            </h2>
          </div>
          <p className="max-w-md text-xs leading-relaxed text-muted">
            Real git repositories with backdated commits, run through the same engine as anything
            you paste above. Five need no network at all.
          </p>
        </div>

        <FixtureGrid />
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* What it handles                                                     */}
      {/* ------------------------------------------------------------------ */}
      <section className="py-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <p className="label mb-2">Coverage</p>
            <h2 className="mb-4 font-mono text-xl font-semibold tracking-display text-ink">
              Five ecosystems, one pipeline
            </h2>
            <p className="mb-6 text-xs leading-relaxed text-muted">
              Each language is an adapter behind the same interface: detect, date, run, diagnose,
              repair, verify. Adding a sixth means writing one adapter, not a second product.
            </p>
            <Link
              href="/jobs"
              className="inline-flex items-center gap-2 font-mono text-2xs uppercase tracking-label text-brass hover:underline"
            >
              Browse past revivals →
            </Link>
          </div>

          <dl className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2">
            {[
              {
                lang: 'JavaScript / TypeScript',
                tools: 'npm · yarn · pnpm',
                fails: 'node-sass bindings, webpack 4 on OpenSSL 3, npm 7 peer conflicts, ESM-only majors, broken lockfiles, dead packages',
              },
              {
                lang: 'Python',
                tools: 'pip · Poetry · Pipenv',
                fails: 'Python 2 syntax, removed stdlib modules, setuptools 58 breakage, unsatisfiable pins, missing virtualenv support',
              },
              {
                lang: 'Java',
                tools: 'Maven · Gradle',
                fails: 'source/target levels modern JDKs reject, javax.* packages removed in 11, jcenter and plain-HTTP repositories',
              },
              {
                lang: 'Go · Rust',
                tools: 'Go modules · Cargo',
                fails: 'pre-modules layouts, go directives ahead of the toolchain, go.sum drift, unreachable MSRVs, lockfile format jumps',
              },
            ].map((item) => (
              <div key={item.lang} className="bg-surface p-5">
                <dt className="mb-1 text-sm font-semibold text-ink">{item.lang}</dt>
                <div className="mb-3 font-mono text-2xs tracking-label text-brass">
                  {item.tools}
                </div>
                <dd className="text-xs leading-relaxed text-muted">{item.fails}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </div>
  );
}
