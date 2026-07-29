import { CtaRow, H2, Note, P, PageHead, Prose } from "@/components/layout/Marketing";
import { StumpsMark } from "@/components/layout/Brand";
import { Seam, SectionTitle } from "@/components/ui/Surface";

const PRINCIPLES = [
  {
    title: "The log is the truth",
    body: "Only the ball-by-ball record is stored. Every total, rate, average and result is computed from it on demand. Nothing can drift, because there is nothing to drift from.",
  },
  {
    title: "The scoring screen is not for sale",
    body: "No advertisements, no interstitials, no upsell while someone is trying to record a wicket. The public scorecard is the same.",
  },
  {
    title: "The phone comes first",
    body: "Scoring happens standing up, outdoors, in sunlight, on a mid-range Android with two bars of signal. That is the target device, not a desk.",
  },
  {
    title: "A mistake is not a catastrophe",
    body: "Any ball can be corrected at any point, including after the match has finished, and everything downstream fixes itself.",
  },
  {
    title: "Viewers never sign in",
    body: "A scorecard link opens for anybody. Asking a spectator to create an account to look at a score is a tax on the scorer's goodwill.",
  },
];

export default function About() {
  return (
    <>
      <PageHead
        eyebrow="About"
        title="Built for the cricket that does not have a scoreboard."
        lede="Most cricket played anywhere in the world is played on a school field, a rooftop, a taped-off street or a turf box booked by the hour — with the score kept in someone's head or on the back of a receipt. This is a scorer's ledger for those games, held to the same standard as one for a first-class match."
      />

      <Seam />

      <section className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-center gap-2">
          <StumpsMark className="size-5" />
          <SectionTitle>What we hold to</SectionTitle>
        </div>
        <dl className="mt-4 flex flex-col">
          {PRINCIPLES.map((item, index) => (
            <div key={item.title}>
              {index > 0 && <Seam />}
              <div className="py-4">
                <dt className="font-sans text-sm font-semibold text-chalk">{item.title}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-willow-soft">{item.body}</dd>
              </div>
            </div>
          ))}
        </dl>
      </section>

      <Seam />

      <Prose>
        <H2>Why it looks like this</H2>
        <P>
          Two objects shaped the design: the mechanical split-flap board that used to hang at
          the end of a ground, and the hardback scorebook the club scorer filled in with a
          pencil. The board gives us the live numbers — tiles that turn over when a run is
          scored, the only animation in the product. The book gives us everything else:
          chalk-coloured paper, hairline rules, a number down the left margin, stitched seams
          instead of drop shadows.
        </P>
        <P>
          It is not nostalgia for its own sake. A split-flap tile is the clearest way to show a
          number that changes, and a ruled ledger is the clearest way to show forty rows of
          figures on a small screen. The look follows the job.
        </P>

        <H2>How it is built</H2>
        <P>
          A Python API with PostgreSQL for durability and Redis for fan-out, and a React front
          end that keeps its own copy of the scoring engine so it can keep working with no
          signal. The same cricket logic exists in both languages and both are tested against
          one shared file of fixtures, so the phone and the server can never disagree about what
          a wide off a free hit means.
        </P>

        <Note title="On accuracy">
          Cricket's laws have edges that most scoring software gets wrong: byes off a no-ball, a
          run out on the second run of a free hit, a bowled-out side's net run rate, whether a
          maiden survives a wide. Each of those is a test case in this codebase with a name a
          scorer would recognise. If you find one we have wrong, it is a bug and we want to hear
          about it.
        </Note>
      </Prose>

      <CtaRow
        title="Score a match with it"
        body="It is free, and there is nothing to install."
        secondary={{ to: "/changelog", label: "See what has changed" }}
      />
    </>
  );
}
