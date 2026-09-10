import { Link } from "react-router";

import { CtaRow, H2, P, PageHead, Prose } from "@/components/layout/Marketing";
import { Button } from "@/components/ui/Button";
import { Badge, Panel, Seam, SectionTitle } from "@/components/ui/Surface";

const PLANS = [
  {
    name: "Scoring",
    price: "Free",
    period: "every match",
    blurb: "Ball-by-ball ledger, public scorecard, squads and tournaments.",
    points: [
      "Unlimited matches and teams",
      "Live scorecard link — no login for viewers",
      "Tournaments, NRR and points table",
      "Phone scoring with offline queue",
    ],
    cta: "Start scoring",
    to: "/register",
    featured: false,
  },
  {
    name: "Match day live",
    price: "৳1,500",
    period: "per live match",
    blurb: "Your camera, our overlay, Facebook or YouTube Page live.",
    points: [
      "TV score bar on the live picture",
      "Go live to a Facebook Page from this app",
      "YouTube stream-key restream",
      "Scorecard, squad and sponsor on air",
    ],
    cta: "Go live",
    to: "/broadcast",
    featured: true,
  },
  {
    name: "Season",
    price: "৳8,000",
    period: "per month",
    blurb: "Club or tournament that lives every weekend.",
    points: [
      "Unlimited match-day lives in the month",
      "Tournament branding on every overlay",
      "Priority setup help for the first broadcast",
      "Everything in Scoring and Match day live",
    ],
    cta: "Talk to us",
    to: "/about",
    featured: false,
  },
];

export default function Pricing() {
  return (
    <>
      <PageHead
        eyebrow="Pricing"
        title="ODCC Live — scoring is free. Going live is a service."
        lede="Keep the book for nothing. When the club wants the match on a Facebook Page or YouTube, pick a match-day or a season. Prices are in BDT and can be invoiced per club."
      />

      <Seam />

      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 md:grid-cols-3">
        {PLANS.map((plan) => (
          <Panel
            key={plan.name}
            className={plan.featured ? "border-flip/50 bg-flip/5 p-5" : "p-5"}
          >
            <div className="flex items-center justify-between gap-2">
              <SectionTitle>{plan.name}</SectionTitle>
              {plan.featured ? <Badge tone="live">Live</Badge> : null}
            </div>
            <p className="mt-3 font-mono text-3xl font-black text-chalk">{plan.price}</p>
            <p className="font-sans text-[0.7rem] tracking-wide text-willow-soft uppercase">
              {plan.period}
            </p>
            <p className="mt-3 font-sans text-sm text-willow-soft">{plan.blurb}</p>
            <ul className="mt-4 flex flex-col gap-2 font-sans text-sm text-chalk">
              {plan.points.map((point) => (
                <li key={point} className="border-t border-pitch-line pt-2">
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-5">
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
