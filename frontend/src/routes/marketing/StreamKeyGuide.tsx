/**
 * The two guides that bring people here from a search engine.
 *
 * They are written as one component with a platform switch because the shape of
 * the answer is identical and the differences are worth seeing side by side in the
 * source rather than drifting apart in two files.
 */

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
import { Seam, SectionTitle } from "@/components/ui/Surface";

type Platform = "youtube" | "facebook";

const CONTENT: Record<
  Platform,
  {
    name: string;
    title: string;
    lede: string;
    where: string;
    steps: Array<{ title: string; body: string }>;
    server: string;
    faq: Array<{ q: string; a: string }>;
  }
> = {
  youtube: {
    name: "YouTube",
    title: "How to get your YouTube stream key",
    lede: "Two minutes, once. The key is a password for your channel's live feed: your streaming software sends video to YouTube's server, and the key is how YouTube knows the video is yours.",
    where: "YouTube Studio → Create → Go live → Stream",
    steps: [
      {
        title: "Enable live streaming on the channel",
        body: "YouTube requires a verified phone number, and first-time activation can take up to 24 hours. Do this the day before the match, not an hour before it.",
      },
      {
        title: "Open YouTube Studio and choose Go live",
        body: "studio.youtube.com → Create (top right) → Go live. Pick the Stream tab rather than Webcam.",
      },
      {
        title: "Fill in the stream details",
        body: "Title it the way people will search for it — 'Kalabagan CC vs Dhanmondi XI, Division 3, 14 March'. Set visibility, and mark whether it is made for kids.",
      },
      {
        title: "Copy the stream key",
        body: "In the Stream settings panel you will see Stream key and Stream URL. Copy both. The key is hidden behind a Copy button; you never need to read it aloud.",
      },
      {
        title: "Paste them into OBS",
        body: "OBS → Settings → Stream → Service: YouTube - RTMPS. Either sign in, or choose 'Use stream key' and paste it. Then Start Streaming.",
      },
    ],
    server: "rtmps://a.rtmps.youtube.com/live2/",
    faq: [
      {
        q: "Does my stream key change every time?",
        a: "Not by default. The persistent key on the Stream tab is reusable, which is what you want for a weekly fixture. Keys created for a single scheduled stream are one-off.",
      },
      {
        q: "Why does YouTube say my stream is unhealthy?",
        a: "Almost always upload bandwidth. Drop the OBS video bitrate to around 2500 kbps at 720p30 for cricket — the camera is mostly static, so the picture holds up well.",
      },
      {
        q: "The stream is live but nobody can find it.",
        a: "Check visibility is Public rather than Unlisted, and share the watch link directly. Unlisted streams do not appear in search or on your channel page.",
      },
      {
        q: "Should I ever share the key?",
        a: "No. Anyone with it can broadcast to your channel. If it leaks, click Reset in the Stream settings and paste the new one into OBS.",
      },
    ],
  },
  facebook: {
    name: "Facebook",
    title: "How to get your Facebook stream key",
    lede: "Facebook hides the stream key behind the Live Producer page, and it expires faster than people expect. Here is where it lives and what to do when it stops working.",
    where: "facebook.com/live/producer → Streaming software",
    steps: [
      {
        title: "Open Live Producer",
        body: "Go to facebook.com/live/producer while signed in as the person or Page that will host the stream. Choose 'Go live' and then 'Streaming software' rather than a camera.",
      },
      {
        title: "Choose where it is posted",
        body: "Your own timeline, a Page, or a group. Pick the Page if the club has one — the video stays with the club rather than with whoever held the phone.",
      },
      {
        title: "Copy the stream key",
        body: "Under 'Streaming software' you will find Stream key and Server URL. Tick 'Use a persistent stream key' if it is offered, so next week's match does not need a new one.",
      },
      {
        title: "Paste them into OBS",
        body: "OBS → Settings → Stream → Service: Facebook Live, then paste the key. If you are using a custom server, choose Custom and paste the Server URL too.",
      },
      {
        title: "Start streaming, then post it",
        body: "Facebook only shows the Go Live button once it is receiving video from OBS. Start OBS first, wait for the preview, then click Go Live.",
      },
    ],
    server: "rtmps://live-api-s.facebook.com:443/rtmp/",
    faq: [
      {
        q: "My key worked last week and does not now.",
        a: "Non-persistent Facebook keys expire once the stream ends, and Live Producer will silently issue a new one. Tick the persistent-key option, or copy a fresh key each match.",
      },
      {
        q: "Facebook says the video is not receiving data.",
        a: "The server URL and the key are separate fields and are easy to paste into each other. Confirm the URL ends in /rtmp/ and that the key is on its own in the key field.",
      },
      {
        q: "Can I stream to a group rather than a Page?",
        a: "Yes, but you must be a member with posting rights, and the group has to allow live video. Choose the destination in Live Producer before you copy the key.",
      },
      {
        q: "Why is my stream limited to 8 hours?",
        a: "That is Facebook's cap on a single continuous broadcast. A day of cricket needs to be split — end the stream at the innings break and start a second one.",
      },
    ],
  },
};

export default function StreamKeyGuide({ platform }: { platform: Platform }) {
  const guide = CONTENT[platform];

  return (
    <>
      <PageHead eyebrow={`${guide.name} guide`} title={guide.title} lede={guide.lede} />

      <Seam />

      <Prose>
        <H2>Where the key lives</H2>
        <P>
          <span className="font-mono text-chalk">{guide.where}</span>
        </P>
        <Note title="What a stream key actually is">
          It is a write-only password for a video ingest server. Your software opens a
          connection to the server address, presents the key, and starts pushing frames. Nothing
          about it is specific to cricket, and nothing about it comes from Pitchside — we render
          the scoreboard overlay; {guide.name} handles the video.
        </Note>
      </Prose>

      <section className="mx-auto max-w-3xl px-4 py-6">
        <SectionTitle>Step by step</SectionTitle>
        <div className="pt-4">
          <Steps steps={guide.steps} />
        </div>
      </section>

      <Prose>
        <H2>Settings that work for cricket</H2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-willow-soft">
          <li>
            Server: <code className="font-mono text-chalk">{guide.server}</code>
          </li>
          <li>
            Resolution 1280×720 at 30fps. A cricket camera is mostly still; the extra pixels of
            1080p cost you bitrate you probably do not have at a ground.
          </li>
          <li>
            Video bitrate 2500–4000 kbps, audio 128 kbps. Keyframe interval 2 seconds — both
            platforms require it.
          </li>
          <li>
            Encoder: hardware (NVENC / AMF / QuickSync) if the laptop has it, so the CPU is free
            for the browser source.
          </li>
        </ul>

        <H2>Add the scoreboard</H2>
        <P>
          Once video is flowing, add the Pitchside overlay as a browser source and you have a
          scoreboard that follows the scoring rather than being typed in by hand.{" "}
          <Link to="/broadcast" className="text-flip underline">
            The overlay setup is written up here
          </Link>
          .
        </P>
      </Prose>

      <Faq items={guide.faq} />

      <CtaRow
        title="Score it while you stream it"
        body="One person on the phone scoring, one laptop streaming, and the board on screen stays right."
        secondary={{ to: "/broadcast", label: "Set up the overlay" }}
      />
    </>
  );
}
