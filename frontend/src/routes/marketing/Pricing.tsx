import { Link } from "react-router";

import { CtaRow, H2, P, PageHead, Prose } from "@/components/layout/Marketing";
import { Button } from "@/components/ui/Button";
import { Badge, Panel, Seam, SectionTitle } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";

const PLANS = [
  {
    name: "Community Scoring",
    eyebrow: "Free",
    price: "$0",
    period: "Forever",
    blurb: "Start scoring your matches completely free.",
    tone: "free" as const,
    points: [
      "Unlimited Match Scoring",
      "Live Scorecard",
      "Ball-by-Ball Scoring",
      "Team & Player Management",
      "Match Management",
      "Basic Player Statistics",
      "Tournament & Match Creation",
      "Public Match Link",
      "Easy Score Sharing",
      "Access to ODCC LIVE Platform",
    ],
    footer: "No subscription. No match limit. No hidden cost.",
    cta: "Start scoring",
    to: "/register",
    featured: false,
  },
  {
    name: "Live Broadcast",
    eyebrow: "Live",
    price: "$1.20",
    period: "/ Match",
    blurb: "Turn your scored match into a professional live broadcast.",
    tone: "live" as const,
    points: [
      "Facebook Live Integration",
      "YouTube Live Integration",
      "Live Score Overlay",
      "Real-Time Score Synchronization",
      "Team Logo on Broadcast",
      "Sponsor Logo Integration",
      "Match & Tournament Branding",
      "Live Score Display",
      "Broadcast-Ready Score Data",
      "Public Live Match Link",
    ],
    member: { regular: "$1.20 / Match", member: "$0.90 / Match" },
    footer: "Broadcast your passion. Reach your audience.",
    cta: "Go live",
    to: "/broadcast",
    featured: true,
  },
  {
    name: "ODCC LIVE Pro",
    eyebrow: "Pro",
    price: "$9.99",
    period: "/ Month",
    blurb: "Unlimited live broadcasting for your matches.",
    tone: "pro" as const,
    points: [
      "Unlimited Live Broadcasts",
      "Facebook & YouTube Integration",
      "Live Score Overlay",
      "Real-Time Score Updates",
      "Team & Sponsor Branding",
      "Broadcast Score Graphics",
      "Match Sharing",
      "Tournament Match Broadcasting",
      "Advanced Live Broadcast Support",
    ],
    footer: "Broadcast 1 match or 100 matches — one monthly subscription.",
    cta: "Go Pro",
    to: "/register",
    featured: false,
  },
  {
    name: "Tournament Package",
    eyebrow: "Starting from",
    price: "$15.99",
    period: "/ Tournament",
    blurb: "Complete tournament management with live broadcast and branding.",
    tone: "cup" as const,
    points: [
      "Tournament Setup & Management",
      "Live Scoring & Scorecards",
      "Live Broadcasting",
      "Facebook & YouTube Integration",
      "Broadcast Score Overlay",
      "Team & Player Management",
      "Points Table & Match Schedule",
      "Tournament Statistics",
      "Team Logos & Sponsor Branding",
      "Public Tournament/Match Links",
    ],
    footer: "Your Tournament. Our Platform.",
    cta: "Plan a cup",
    to: "/about",
    featured: false,
  },
];

const COMPARE = [
  ["Match Scoring", "yes", "yes", "yes", "yes"],
  ["Live Scorecard", "yes", "yes", "yes", "yes"],
  ["Ball-by-Ball Scoring", "yes", "yes", "yes", "yes"],
  ["Team & Player Management", "yes", "yes", "yes", "yes"],
  ["Facebook Live", "no", "yes", "yes", "yes"],
  ["YouTube Live", "no", "yes", "yes", "yes"],
  ["Live Score Overlay", "no", "yes", "yes", "yes"],
  ["Sponsor Logo", "no", "yes", "yes", "yes"],
  ["Unlimited Broadcasting", "no", "no", "yes", "note"],
  ["Tournament Management", "basic", "basic", "advanced", "yes"],
  ["Points Table", "basic", "basic", "advanced", "yes"],
  ["Tournament Branding", "no", "optional", "advanced", "yes"],
];

const TONE: Record<(typeof PLANS)[number]["tone"], string> = {
  free: "border-emerald-500/40 bg-emerald-500/10",
  live: "border-sky-400/50 bg-sky-400/10",
  pro: "border-violet-400/50 bg-violet-400/10",
  cup: "border-amber-400/50 bg-amber-400/10",
};

function Cell({ value }: { value: string }) {
  if (value === "yes") return <span className="text-flip">✓</span>;
  if (value === "no") return <span className="text-boundary">✕</span>;
  if (value === "note") return <span className="text-flip">✓*</span>;
  return <span className="text-willow-soft">{value}</span>;
}

export default function Pricing() {
  return (
    <>
      <PageHead
        eyebrow="Live scoring · Live broadcasting · Tournament management"
        title="Score Free. Broadcast Affordably. Go Unlimited."
        lede="The complete cricket digital platform for teams, organizers and communities. Live on Facebook and YouTube."
      />

      <Seam />

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 md:grid-cols-2 xl:grid-cols-4">
        {PLANS.map((plan) => (
          <Panel key={plan.name} className={cn("flex flex-col p-5", TONE[plan.tone], plan.featured && "ring-1 ring-sky-400/40")}>
            <div className="flex items-center justify-between gap-2">
              <SectionTitle>{plan.name}</SectionTitle>
              {plan.featured ? <Badge tone="live">{plan.eyebrow}</Badge> : null}
            </div>
            <p className="mt-3 font-mono text-3xl font-black text-chalk">
              {plan.price}
              <span className="ml-1 font-sans text-xs font-semibold tracking-wide text-willow-soft uppercase">
                {plan.period}
              </span>
            </p>
            <p className="mt-3 font-sans text-sm text-willow-soft">{plan.blurb}</p>
            <ul className="mt-4 flex flex-1 flex-col gap-2 font-sans text-sm text-chalk">
              {plan.points.map((point) => (
                <li key={point} className="border-t border-pitch-line pt-2">
                  {point}
                </li>
              ))}
            </ul>
            {"member" in plan && plan.member ? (
              <div className="mt-4 rounded-[4px] border border-boundary/40 bg-boundary/10 p-3">
                <p className="font-sans text-[0.65rem] font-bold tracking-[0.12em] text-boundary uppercase">
                  ODCC Community Member 25% Discount
                </p>
                <p className="pt-1 font-sans text-xs text-willow-soft">Regular: {plan.member.regular}</p>
                <p className="font-sans text-sm font-semibold text-chalk">Member: {plan.member.member}</p>
              </div>
            ) : null}
            <p className="mt-3 font-sans text-[0.7rem] text-willow-soft">{plan.footer}</p>
            <div className="mt-4">
              <Link to={plan.to}>
                <Button size="sm" variant={plan.featured ? "primary" : "secondary"} fullWidth>
                  {plan.cta}
                </Button>
              </Link>
            </div>
          </Panel>
        ))}
      </section>

      <Seam />

      <section className="mx-auto max-w-6xl px-4 py-10">
        <H2>Quick comparison</H2>
        <div className="mt-4 overflow-x-auto rounded-[4px] border border-pitch-line">
          <table className="w-full min-w-[36rem] border-collapse text-left font-sans text-sm sm:min-w-[40rem]">
            <thead>
              <tr className="bg-pitch-deep text-willow-soft">
                <th className="px-3 py-2 font-semibold">Feature</th>
                <th className="px-3 py-2 font-semibold">Free</th>
                <th className="px-3 py-2 font-semibold">$1.20 / Match</th>
                <th className="px-3 py-2 font-semibold">$9.99 / Month</th>
                <th className="px-3 py-2 font-semibold">Tournament</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([label, ...cells]) => (
                <tr key={label} className="border-t border-pitch-line">
                  <td className="px-3 py-2 text-chalk">{label}</td>
                  {cells.map((cell) => (
                    <td key={`${label}-${cell}`} className="px-3 py-2">
                      <Cell value={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 rounded-[4px] border border-boundary/40 bg-boundary/10 px-4 py-3 text-center font-sans text-sm text-chalk">
          ODCC এর যে কোন মেম্বারের জন্য যে কোন প্যাকেজ ২৫% ডিসকাউন্ট থাকবে।
        </p>
      </section>

      <Seam />

      <Prose>
        <H2>What you are paying for</H2>
        <P>
          The scorer&apos;s ledger stays free. A live match uses camera ingest, a Facebook or
          YouTube restream, and the overlay that burns score, target, sponsor and squad onto the
          picture. That is the paid service.
        </P>
        <P>
          Need a custom rate for a league, a school, or a week of cup cricket? Write from the
          About page and we will quote the days you actually broadcast.
        </P>
      </Prose>

      <CtaRow
        title="Ready for match day?"
        body="Open a free scoring account, then go live when the club wants the picture on Facebook or YouTube."
        primary={{ to: "/register", label: "Start scoring" }}
        secondary={{ to: "/broadcast", label: "See the overlay" }}
      />
    </>
  );
}
