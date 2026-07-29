/**
 * The changelog.
 *
 * Kept by hand and written for scorers, not for developers: each line says what is
 * different when you use the app, not which module changed.
 */

import { PageHead } from "@/components/layout/Marketing";
import { Badge, Seam } from "@/components/ui/Surface";
import { formatDate } from "@/lib/utils";

interface Release {
  version: string;
  date: string;
  headline: string;
  added?: string[];
  fixed?: string[];
}

const RELEASES: Release[] = [
  {
    version: "1.0.0",
    date: "2026-07-28",
    headline: "First public release.",
    added: [
      "Ball-by-ball scoring with automatic strike rotation, over counting, free hits after a no-ball, maiden overs and bowler quotas.",
      "Correct or delete any ball at any point; the innings and the result are recomputed from the delivery log.",
      "Offline scoring. Balls are written to the phone first and replayed in order when the signal returns, without double-counting.",
      "Public scorecards on a share link, updating live, with no account needed to watch.",
      "A transparent broadcast overlay for OBS, Streamlabs and vMix, with position, theme and scale options.",
      "Tournaments: round-robin generation, a points table with ICC-style net run rate, and knockout brackets seeded from the standings.",
      "Saved teams and rosters, so a rematch takes two taps to set up.",
      "Server-decided coin flip and wheel spin, each stamped with a receipt that cannot be re-rolled.",
      "Twelve dismissal types with the dismissal line written for you, and a full ledger scorecard: batting, bowling, partnerships, fall of wickets, over by over.",
      "Second scorer support with per-match roles, and session management so you can sign a lost device out.",
    ],
  },
];

export default function Changelog() {
  return (
    <>
      <PageHead
        eyebrow="Changelog"
        title="What has changed"
        lede="Every release that affects how the app behaves, newest first. Corrections to cricket rules are listed as fixes, because that is what they are."
      />

      <Seam />

      <div className="mx-auto flex max-w-3xl flex-col px-4 py-8">
        {RELEASES.map((release, index) => (
          <article key={release.version}>
            {index > 0 && <Seam className="my-6" />}
            <header className="flex flex-wrap items-baseline gap-3">
              <h2 className="font-mono text-xl tabular text-chalk">{release.version}</h2>
              <span className="font-sans text-xs text-willow">{formatDate(release.date)}</span>
              {index === 0 && <Badge tone="live">Current</Badge>}
            </header>
            <p className="mt-2 text-sm text-chalk/85">{release.headline}</p>

            {release.added && <Section title="Added" items={release.added} />}
            {release.fixed && <Section title="Fixed" items={release.fixed} />}
          </article>
        ))}
      </div>
    </>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="mt-4">
      <h3 className="font-sans text-[0.65rem] font-bold tracking-[0.16em] text-willow uppercase">
        {title}
      </h3>
      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-willow-soft">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
