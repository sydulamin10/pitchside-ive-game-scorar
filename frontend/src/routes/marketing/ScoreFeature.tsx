import {
  CtaRow,
  Faq,
  H2,
  Note,
  P,
  PageHead,
  Prose,
  Steps,
} from "@/components/layout/Marketing";
import { Seam } from "@/components/ui/Surface";

export default function ScoreFeature() {
  return (
    <>
      <PageHead
        eyebrow="Ball-by-ball scoring"
        title="Score the whole match with one thumb."
        lede="The keypad is the size of a phone screen because that is where scoring happens — standing at the boundary, one hand holding the phone, the other holding a cup of tea."
      />

      <Seam />

      <Prose>
        <H2>What the app knows without being told</H2>
        <P>
          A scorer should be recording what happened, not administering the laws. These follow
          automatically from the ball you tap:
        </P>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-willow-soft">
          <li>
            Strike rotation on odd runs and at the end of an over — including the awkward cases,
            like a bye taken off a wide or two runs run on a no-ball.
          </li>
          <li>
            The over count. Wides and no-balls do not advance it; byes and leg-byes do, because
            the ball was legal.
          </li>
          <li>
            The free hit after a no-ball, and the fact that a batter cannot be bowled, caught or
            LBW on it — only run out.
          </li>
          <li>Maiden overs, bowler quotas, and who is not allowed to bowl the next over.</li>
          <li>
            The required run rate, balls remaining, and the moment the chase is complete or the
            side is all out.
          </li>
        </ul>

        <H2>Corrections are the whole point</H2>
        <P>
          Every scorer mis-taps. What matters is what happens next. Because the ball-by-ball log
          is the only thing this app stores, a correction is not a patch — the innings is
          replayed from the first ball with the corrected value in place.
        </P>
        <Note title="A worked example">
          You recorded a leg-bye in the ninth over that was actually a wide. Change it, and the
          over count for the rest of the innings shifts by one ball, the bowler's economy
          changes, the batters who were on strike for every subsequent ball are recalculated,
          the partnership runs move, the fall-of-wickets column re-labels itself, and if the
          match has finished, the result and the tournament points table are recomputed too. You
          do not touch any of that.
        </Note>

        <H2>Wickets, properly</H2>
        <P>
          Twelve dismissal types, each asking only for what it needs: a catch wants a fielder, a
          run out wants to know which batter went and whether they had crossed, a retired hurt
          keeps the batter available to come back in. The dismissal line on the scorecard is
          written for you —<span className="font-mono text-chalk"> c Imran b Rakib</span>, not
          "out".
        </P>

        <H2>Offline is the default, not a fallback</H2>
        <P>
          Balls are written to the phone before anything is sent. If the signal drops mid-over
          you keep scoring at full speed; a small counter shows how many balls are waiting. When
          the connection returns they are replayed in order, and any ball that already reached
          the server is recognised by its client id instead of being counted twice.
        </P>
        <P>
          Two people can score the same match at once. Writes are serialised on the server per
          match, so the second scorer's ball queues behind the first rather than overwriting it.
        </P>
      </Prose>

      <Seam />

      <section className="mx-auto max-w-3xl px-4 py-10">
        <Steps
          steps={[
            {
              title: "Set up the match",
              body: "Pick two saved teams or type the names in. Choose the format — T20, T10, ODI, or a custom overs limit for box and gully games — then record the toss.",
            },
            {
              title: "Choose openers and a bowler",
              body: "The app asks for exactly what it needs next and nothing else. It will not let you record a ball until there is a striker, a non-striker and a bowler.",
            },
            {
              title: "Tap the runs",
              body: "0 to 6, with wide, no-ball, bye and leg-bye as modifiers. A wicket opens a short sheet for the dismissal. Undo removes the last ball.",
            },
            {
              title: "Share the link",
              body: "The public scorecard updates within a second of each ball. Nobody watching needs an account, and nothing on that page asks them to sign up.",
            },
          ]}
        />
      </section>

      <Faq
        items={[
          {
            q: "Can I score a match with fewer than eleven players a side?",
            a: "Yes. Set the players per side when you create the match — six a side for box cricket is common — and the all-out condition follows it.",
          },
          {
            q: "What about eight-ball overs, or five?",
            a: "Balls per over is a match rule. Set it once and the over count, maidens and bowler quotas all use it.",
          },
          {
            q: "Does it handle a super over?",
            a: "Yes. Start a super over innings for each side and the result treats it as the decider.",
          },
          {
            q: "Can someone else help me score?",
            a: "Add them as a scorer on the match and they can record balls from their own phone. Viewers get a read-only link.",
          },
          {
            q: "What happens if I score a ball twice by accident?",
            a: "Undo removes the last ball. If the duplicate came from an offline queue replay, the server spots the repeated client id and reports it as a duplicate rather than recording it.",
          },
        ]}
      />

      <CtaRow
        title="Try it on your next net session"
        body="Set up a two-over practice match and mis-tap on purpose — then correct it and watch the numbers follow."
        secondary={{ to: "/features/tournament", label: "Tournaments and NRR" }}
      />
    </>
  );
}
