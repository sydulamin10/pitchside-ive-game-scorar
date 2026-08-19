import { ArrowRight, Link2, PencilLine, Radio, Trophy, WifiOff } from "lucide-react";
import { Link } from "react-router";

import { FlapNumber, FlapText } from "@/components/board/SplitFlap";
import { BatMark } from "@/components/layout/Brand";
import { InstallAppButton } from "@/components/layout/InstallAppButton";
import { Button } from "@/components/ui/Button";
import { Badge, LiveDot, Panel, Paper, Seam, SectionTitle } from "@/components/ui/Surface";

/**
 * The signature moment lives here: on load, the hero's score tiles flip into
 * place like a stadium board. Everything below it is intentionally still.
 */
function HeroBoard() {
  return (
    <Panel className="w-full max-w-md">
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <LiveDot />
          <span className="font-sans text-xs tracking-[0.14em] text-willow-soft uppercase">
            Kalabagan CC vs Dhanmondi XI
          </span>
        </div>
        <Badge tone="live">Live</Badge>
      </div>
      <Seam />
      <div className="flex items-end gap-4 px-4 py-5">
        <div className="flex flex-col gap-2">
          <FlapText text="KCC" />
          <div className="flex items-end gap-1 text-5xl leading-none">
            <FlapNumber value={187} minTiles={3} tone="live" label="187 runs" />
            <span aria-hidden="true" className="px-0.5 font-mono text-willow">
              /
            </span>
            <FlapNumber value={6} tone="wicket" label="6 wickets" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
            Overs
          </span>
          <div className="text-3xl leading-none">
            <FlapNumber value="19.4" label="19.4 overs" />
          </div>
        </div>
      </div>
      <Seam />
      <dl className="grid grid-cols-3 gap-2 px-4 py-3">
        {[
          { label: "CRR", value: "9.51" },
          { label: "RRR", value: "12.00" },
          { label: "Need", value: "4 off 2" },
        ].map((item) => (
          <div key={item.label}>
            <dt className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow uppercase">
              {item.label}
            </dt>
            <dd className="font-mono text-base tabular text-chalk">{item.value}</dd>
          </div>
        ))}
      </dl>
      <Seam />
      <p className="px-4 py-3 font-sans text-sm text-chalk">
        Rakib <span className="text-flip">*</span>{" "}
        <span className="tabular text-willow-soft">54 (31)</span> · Imran{" "}
        <span className="tabular text-willow-soft">12 (9)</span>
      </p>
    </Panel>
  );
}

const STEPS = [
  {
    ball: "1.1",
    title: "Set the match up",
    body: "Two sides, a format, an overs limit, and the toss. Reuse a saved squad or type eleven names on the spot — guests need no account of their own.",
  },
  {
    ball: "1.2",
    title: "Score every ball",
    body: "Tap the runs. Strike rotation, the over count, the free hit after a no-ball, and the bowler-change prompt all follow the laws without being asked.",
  },
  {
    ball: "1.3",
    title: "Share one link",
    body: "Every match gets a public scorecard address. Send it once; it stays correct for the rest of the match and afterwards.",
  },
];

const FEATURES = [
  {
    icon: PencilLine,
    title: "Correct any ball, at any time",
    body: "The delivery log is the only stored truth. Fix a ball from the ninth over and every figure after it — strike rates, economies, partnerships, the fall of wickets, the result — is recomputed from scratch.",
    to: "/features/score",
  },
  {
    icon: WifiOff,
    title: "Works with no signal",
    body: "Balls are written to the phone first. When the signal returns they replay in order, and a ball that already reached the server is recognised rather than double-counted.",
    to: "/features/score",
  },
  {
    icon: Trophy,
    title: "Points tables that stay honest",
    body: "Net run rate follows the ICC treatment: a side bowled out is charged its full quota of overs. Correct a match from last week and the table reorders itself.",
    to: "/features/tournament",
  },
  {
    icon: Radio,
    title: "An overlay for your stream",
    body: "A transparent scoreboard page you can point a browser source at, or run full-screen on a second phone. Score, overs, both batters, the bowler, the required rate.",
    to: "/broadcast",
  },
];

export function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:py-20">
        <div>
          <p className="font-sans text-sm font-bold tracking-[0.18em] text-flip uppercase">
            ODCC LIVE
          </p>
          <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl">
            Live Every Ball. Feel Every Run.
          </h1>
          <p className="mt-4 max-w-xl text-base text-chalk/85">
            Score ball by ball from the phone in your pocket — gully, box, turf, tape-ball, or a
            full club fixture. Everyone else just opens a link and watches the board turn over.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/register">
              <Button size="lg">
                Start scoring a match
                <ArrowRight aria-hidden="true" className="size-4" />
              </Button>
            </Link>
            <InstallAppButton size="lg" variant="ghost" label="Install app" />
            <Link to="/install">
              <Button variant="ghost" size="lg">
                Phone home-screen setup
              </Button>
            </Link>
            <Link to="/features/score">
              <Button variant="ghost" size="lg">
                See how the scoring works
              </Button>
            </Link>
          </div>
          <p className="mt-4 font-sans text-xs text-willow">
            Viewers never sign in. Scorecard links look like{" "}
            <code className="font-mono text-willow-soft">/s/kalabagan-cc-07</code>.
          </p>
        </div>
        <div className="flex justify-center lg:justify-end">
          <HeroBoard />
        </div>
      </section>

      <Seam />

      <section className="mx-auto max-w-6xl px-4 py-12">
        <SectionTitle>How a match goes</SectionTitle>
        <div className="mt-5 grid gap-6 md:grid-cols-3">
          {STEPS.map((step) => (
            <article key={step.ball}>
              {/* Cricket numbers its own sequence: over.ball, not 01/02/03. */}
              <p className="font-mono text-sm font-semibold tabular text-flip">{step.ball}</p>
              <h3 className="mt-1 text-lg">{step.title}</h3>
              <p className="mt-1.5 text-sm text-willow-soft">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <Seam />

      <section className="mx-auto max-w-6xl px-4 py-12">
        <div className="flex items-center gap-2">
          <BatMark className="size-5" />
          <SectionTitle>What it does properly</SectionTitle>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <Link
              key={feature.title}
              to={feature.to}
              className="group rounded-[3px] border border-pitch-line bg-pitch-deep p-5 transition-colors hover:border-willow/70"
            >
              <feature.icon aria-hidden="true" className="size-5 text-flip" />
              <h3 className="mt-3 text-lg">{feature.title}</h3>
              <p className="mt-1.5 text-sm text-willow-soft">{feature.body}</p>
              <span className="mt-3 inline-flex items-center gap-1 font-sans text-xs text-flip">
                Read more
                <ArrowRight
                  aria-hidden="true"
                  className="size-3.5 transition-transform group-hover:translate-x-0.5"
                />
              </span>
            </Link>
          ))}
        </div>
      </section>

      <Seam />

      <section className="mx-auto max-w-6xl px-4 py-12">
        <SectionTitle>The bit nobody else gets right</SectionTitle>
        <Paper className="mt-4 p-6">
          <h2 className="text-xl text-ink">Every number is derived, never stored</h2>
          <p className="mt-2 max-w-3xl text-sm text-ink-soft">
            Most scoring apps keep a running total and add to it. That is why a mistake in the
            third over follows them to the end of the match. Here, the ball-by-ball log is the
            only thing written down: totals, strike rates, economy rates, maidens, partnerships,
            the fall of wickets, the required rate and the result are all computed from that log
            every single time it changes.
          </p>
          <p className="mt-3 max-w-3xl text-sm text-ink-soft">
            The practical effect: open the ninth over, change a leg-bye into a wide, and the
            innings reorganises itself correctly — including whose strike it was for every ball
            afterwards.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[
              "strike rotation",
              "free hit",
              "maiden overs",
              "bowler quota",
              "NRR",
              "DLS target",
            ].map((item) => (
              <span
                key={item}
                className="rounded-[2px] border border-[color-mix(in_srgb,var(--color-ink)_25%,transparent)] px-2 py-0.5 font-sans text-xs text-ink-soft"
              >
                {item}
              </span>
            ))}
          </div>
        </Paper>
      </section>

      <Seam />

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl">Next match is on Friday?</h2>
            <p className="mt-1 text-sm text-willow-soft">
              Set it up in about a minute, then hand the link to whoever asks for the score.
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/register">
              <Button size="lg">Create an account</Button>
            </Link>
            <Link to="/tools/coin-flip">
              <Button variant="ghost" size="lg">
                <Link2 aria-hidden="true" className="size-4" />
                Toss a coin first
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
