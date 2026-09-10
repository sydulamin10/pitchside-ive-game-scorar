import { Link } from "react-router";

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
import { Paper, Seam, SectionTitle } from "@/components/ui/Surface";

const PARAMS: Array<[string, string, string]> = [
  ["position", "bottom | top", "Which edge the bar sits against. Default bottom."],
  [
    "theme",
    "dark | light",
    "Ink tiles or chalk tiles. Default dark, which keys over most pitches.",
  ],
  ["scale", "0.5 – 3", "Multiplier for the bar. Use 1.5 on a 4K canvas. Default 1."],
  ["balls", "0", "Set to 0 to hide the recent-balls strip when the bar is too wide."],
];

export default function Broadcast() {
  return (
    <>
      <PageHead
        eyebrow="Broadcast overlay"
        title="A scoreboard your stream can key straight over the pitch."
        lede="Point OBS at one URL. The bar has a transparent background, a fixed height so your scene never jumps mid-over, and it updates from the same live feed as the public scorecard."
      />

      <Seam />

      <Prose>
        <H2>The URL</H2>
        <P>
          Take your match's public link and add{" "}
          <code className="font-mono text-chalk">/overlay</code>. If your scorecard is at{" "}
          <code className="font-mono text-chalk">/s/kalabagan-cc-07</code>, the browser source
          is:
        </P>
        <Paper className="p-4">
          <code className="font-mono text-sm break-all text-ink">
            https://your-domain/s/kalabagan-cc-07/overlay?position=bottom&amp;theme=dark&amp;scale=1
          </code>
        </Paper>

        <H2>What you can change</H2>
        <div className="overflow-x-auto">
          <table className="ledger w-full">
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Values</th>
                <th scope="col">What it does</th>
              </tr>
            </thead>
            <tbody>
              {PARAMS.map(([name, values, note]) => (
                <tr key={name}>
                  <td className="font-mono">{name}</td>
                  <td className="font-mono">{values}</td>
                  <td>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Note title="Why it does not need a login">
          The overlay reads the same public feed as the scorecard, so you can paste the URL into
          streaming software on a machine that has never signed in — and you are not putting an
          access token into a config file that gets shared with your scene collection.
        </Note>

        <H2>What appears on the bar</H2>
        <P>
          Batting side, score and wickets, overs, both batters with their runs and balls, the
          current bowler's figures, the required runs and balls when a chase is on, a free-hit
          flag when one is live, and the last six balls. Anything that does not apply is left
          out rather than shown empty — no <span className="font-mono">0/0</span> before the
          first ball.
        </P>
      </Prose>

      <Seam />

      <section className="mx-auto max-w-3xl px-4 py-10">
        <SectionTitle>Setting it up in OBS</SectionTitle>
        <div className="pt-4">
          <Steps
            steps={[
              {
                title: "Add a Browser source",
                body: "Sources → + → Browser. Name it 'Scoreboard'.",
              },
              {
                title: "Paste the overlay URL",
                body: "Set width to your canvas width (1920) and height to 220. The bar positions itself inside that box, so a taller box just gives it more room.",
              },
              {
                title: "Leave the background alone",
                body: "Do not add a custom CSS background. The page is already transparent; OBS composites it over your camera without a chroma key.",
              },
              {
                title: "Tick 'Refresh browser when scene becomes active'",
                body: "Not required — the bar reconnects on its own — but it makes a scene switch feel instant.",
              },
            ]}
          />
        </div>
      </section>

      <Faq
        items={[
          {
            q: "How quickly does it update?",
            a: "Within about a second of the ball being recorded. The bar holds an open connection to the server and falls back to a short poll if that connection is blocked by a network.",
          },
          {
            q: "Can I run it on a second phone instead?",
            a: "Yes — open the overlay URL in a phone browser, turn it full-screen, and point a camera or a capture card at it. Use ?theme=light if the screen is being filmed.",
          },
          {
            q: "It looks small on a 4K scene.",
            a: (
              <>
                Add <code className="font-mono text-chalk">?scale=1.5</code> to the URL. The bar
                scales from whichever edge it is anchored to, so it stays flush.
              </>
            ),
          },
          {
            q: "Can I restyle it to match my channel?",
            a: "The accent stripe uses the batting team's colour, which you set on the team. Beyond that, OBS lets you apply custom CSS to a browser source if you want to go further.",
          },
          {
            q: "Do I need a stream key from Pitchside?",
            a: (
              <>
                No — Pitchside does not stream video. The stream key comes from YouTube or
                Facebook. We have written both up:{" "}
                <Link to="/guides/youtube-stream-key" className="text-flip underline">
                  YouTube
                </Link>{" "}
                and{" "}
                <Link to="/guides/facebook-stream-key" className="text-flip underline">
                  Facebook
                </Link>
                .
              </>
            ),
          },
        ]}
      />

      <CtaRow
        title="Streaming a final this season?"
        body="Scoring stays free. Going live to a Facebook Page or YouTube is the paid service — rates are on the pricing page."
        secondary={{ to: "/pricing", label: "See ODCC Live pricing" }}
      />
    </>
  );
}
