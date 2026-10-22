import type { TutorialVideo } from "@/lib/api/types";

export type HowToTopic = {
  id: string;
  title: string;
  description: string;
  guide: string;
  steps: string[];
};

export const HOW_TO_TUTORIALS: HowToTopic[] = [
  {
    id: "score",
    title: "How to score a match",
    description: "Create both teams, set the toss, and score every ball from your phone.",
    guide: "/features/score",
    steps: [
      "Open Matches → New match.",
      "Add both teams and players, or reuse a saved squad.",
      "Set overs, toss, and the opening batters.",
      "Tap each ball on the keypad. The public scorecard updates live.",
    ],
  },
  {
    id: "go-live",
    title: "How to go live",
    description: "Use one live credit, connect YouTube or Facebook, and start the broadcast.",
    guide: "/pricing",
    steps: [
      "Buy a live credit from Pricing, or use an active Pro plan.",
      "Open the match and tap Go Live.",
      "Connect YouTube or a Facebook Page.",
      "Start the camera. The score overlay burns onto the stream automatically.",
    ],
  },
  {
    id: "obs",
    title: "How to add the overlay in OBS",
    description: "Paste one overlay URL as a Browser source. No chroma key needed.",
    guide: "/broadcast",
    steps: [
      "Take the match public link and add /overlay to the URL.",
      "In OBS choose Sources → + → Browser.",
      "Paste the URL. Set width 1920 and height 220.",
      "Leave the background transparent so the bar sits over your camera.",
    ],
  },
  {
    id: "youtube-key",
    title: "How to get a YouTube stream key",
    description: "Copy the key from YouTube Studio and paste it in Go Live.",
    guide: "/guides/youtube-stream-key",
    steps: [
      "Verify the YouTube channel phone number the day before the match.",
      "YouTube Studio → Create → Go live → Stream.",
      "Copy the stream key and the stream URL.",
      "Paste them in ODCC LIVE Go Live, then start streaming.",
    ],
  },
];

export type TutorialLesson = HowToTopic & {
  video: TutorialVideo | null;
};

export function mergeTutorialLessons(videos: TutorialVideo[]): TutorialLesson[] {
  const extras = videos.slice(HOW_TO_TUTORIALS.length).map((video) => ({
    id: video.id,
    title: video.title,
    description: video.description || "Watch this ODCC LIVE how-to on YouTube.",
    guide: video.url,
    steps: [] as string[],
    video,
  }));
  const core = HOW_TO_TUTORIALS.map((topic, index) => {
    const video = videos[index] ?? null;
    return {
      ...topic,
      title: video?.title || topic.title,
      description: video?.description || topic.description,
      video,
    };
  });
  return [...core, ...extras];
}
