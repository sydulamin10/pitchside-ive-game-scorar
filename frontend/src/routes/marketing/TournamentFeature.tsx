import { CtaRow, Faq, H2, Note, P, PageHead, Prose } from "@/components/layout/Marketing";
import { StandingsTable } from "@/components/ledger/StandingsTable";
import { Seam, SectionTitle } from "@/components/ui/Surface";
import type { StandingRow } from "@/lib/api/types";

/** An illustrative table. Deliberately not fetched: this page is a brochure. */
const SAMPLE: StandingRow[] = [
  {
    team_id: "a",
    team_name: "Kalabagan CC",
    group_id: null,
    group_name: null,
    position: 1,
    played: 5,
    won: 4,
    lost: 1,
    tied: 0,
    no_result: 0,
    points: 8,
    points_adjustment: 0,
    runs_scored: 812,
    overs_faced: 97.2,
    runs_conceded: 741,
    overs_bowled: 100,
    run_rate_for: 8.35,
    run_rate_against: 7.41,
    net_run_rate: 0.94,
    form: ["W", "W", "L", "W", "W"],
  },
  {
    team_id: "b",
    team_name: "Dhanmondi XI",
    group_id: null,
    group_name: null,
    position: 2,
    played: 5,
    won: 3,
    lost: 1,
    tied: 0,
    no_result: 1,
    points: 7,
    points_adjustment: 0,
    runs_scored: 704,
    overs_faced: 92.4,
    runs_conceded: 690,
    overs_bowled: 95.2,
    run_rate_for: 7.6,
    run_rate_against: 7.25,
    net_run_rate: 0.35,
    form: ["W", "N", "W", "W", "L"],
  },
  {
    team_id: "c",
    team_name: "Mirpur Warriors",
    group_id: null,
    group_name: null,
    position: 3,
    played: 5,
    won: 2,
    lost: 3,
    tied: 0,
    no_result: 0,
    points: 4,
    points_adjustment: 0,
    runs_scored: 668,
    overs_faced: 100,
    runs_conceded: 702,
    overs_bowled: 98.4,
    run_rate_for: 6.68,
    run_rate_against: 7.11,
    net_run_rate: -0.43,
    form: ["L", "W", "L", "W", "L"],
  },
  {
    team_id: "d",
    team_name: "Uttara United",
    group_id: null,
    group_name: null,
    position: 4,
    played: 5,
    won: 0,
    lost: 4,
    tied: 1,
    no_result: 0,
    points: 1,
    points_adjustment: 0,
    runs_scored: 559,
    overs_faced: 94.1,
    runs_conceded: 610,
    overs_bowled: 92,
    run_rate_for: 5.94,
    run_rate_against: 6.63,
    net_run_rate: -0.69,
    form: ["L", "L", "T", "L", "L"],
  },
];

export default function TournamentFeature() {
  return (
    <>
      <PageHead
        eyebrow="Tournaments"
        title="Fixtures, a points table, and a bracket that fills itself in."
        lede="Enter the teams once. Pitchside generates the round robin, keeps the table after every finished match, and seeds the knockout from the standings when the group stage ends."
      />

      <Seam />

      <section className="mx-auto max-w-3xl px-4 py-10">
        <SectionTitle>What the noticeboard looks like</SectionTitle>
        <div className="pt-4">
          <StandingsTable rows={SAMPLE} advancing={2} />
        </div>
        <p className="pt-3 font-sans text-xs text-willow">
          The rule under second place is the qualification line, drawn where the teams-advancing
          setting says it goes.
        </p>
      </section>

      <Seam />

      <Prose>
        <H2>Net run rate, done the way the ICC does it</H2>
        <P>
          Net run rate is where most club tables go wrong, and the error always favours
          somebody. Two rules matter, and both are implemented:
        </P>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-willow-soft">
          <li>
            A side that is bowled out is charged its <em>full quota</em> of overs, not the overs
            it actually faced. Being dismissed for 60 in 12 overs of a 20-over match counts as
            60 from 20.
          </li>
          <li>
            Overs are converted honestly: 17.3 overs is 17.5 overs of run rate, not 17.3. A
            tenth of an over is not a tenth of six balls.
          </li>
        </ul>
        <P>
          Abandoned and no-result matches are excluded from run rate entirely while still
          awarding their points. Points deductions — a late arrival, an over-rate penalty — are
          applied to the total and shown against the team so nobody has to guess why the order
          looks odd.
        </P>

        <Note title="Correct a match, correct the table">
          The table is computed from the finished matches every time it is requested, never
          stored and incremented. Reopen a fixture from last weekend, fix a miscounted wide, and
          the points and net run rate move immediately — including the qualification line and
          the bracket seeds that depend on it.
        </Note>

        <H2>Three shapes of competition</H2>
        <P>
          <strong className="text-chalk">League.</strong> Everyone plays everyone, single or
          double round. The table decides it.
        </P>
        <P>
          <strong className="text-chalk">Groups then knockout.</strong> Teams are split into
          groups, each group keeps its own table, and the top however-many from each group are
          seeded into a bracket — first in one group against the runner-up in another, the way
          it is normally done.
        </P>
        <P>
          <strong className="text-chalk">Straight knockout.</strong> A bracket from the start,
          with byes handled when the number of teams is not a power of two. Winners advance the
          moment their match is decided.
        </P>

        <H2>One link for the whole competition</H2>
        <P>
          Every tournament gets a public page with the table, the fixture list and the bracket,
          each fixture linking to its own live scorecard. Send it to the group chat at the start
          of the season and never send anything else.
        </P>
      </Prose>

      <Faq
        items={[
          {
            q: "Can I schedule the fixtures for particular times?",
            a: "Give the generator a start time and a gap between matches and it will lay them out for you. Any fixture can be re-timed afterwards.",
          },
          {
            q: "What if two teams finish level on points and NRR?",
            a: "Head-to-head result is used next, then wins, then the team name, so the order is stable rather than random.",
          },
          {
            q: "Can I rank by wins only, without run rate?",
            a: "Yes. Turn net run rate off in the tournament settings and the NRR column disappears from the table.",
          },
          {
            q: "Do I have to create the knockout matches myself?",
            a: "No. Generate the bracket and Pitchside creates the fixtures with the qualified teams already in place, or with 'Winner of Semi-final 1' placeholders if the group stage is still running.",
          },
        ]}
      />

      <CtaRow
        title="Running a season this year?"
        body="Set the tournament up once and the table will look after itself."
        secondary={{ to: "/features/score", label: "How the scoring works" }}
      />
    </>
  );
}
