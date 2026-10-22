import { useMemo, useState } from "react";
import { Link } from "react-router";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import type { TutorialVideo } from "@/lib/api/types";
import { mergeTutorialLessons, type TutorialLesson } from "@/lib/tutorials";
import { cn } from "@/lib/utils";

function youtubeEmbed(video: TutorialVideo) {
  return `${video.embed_url}?rel=0&modestbranding=1`;
}

function playlistEmbed(playlistId: string) {
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(playlistId)}&rel=0&modestbranding=1`;
}

export function TutorialShowcase({
  videos,
  playlistId,
}: {
  videos: TutorialVideo[];
  playlistId?: string | null;
}) {
  const lessons = useMemo(() => mergeTutorialLessons(videos), [videos]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const count = Math.max(lessons.length, 4);
  const lesson = lessons[active] ?? lessons[0];
  const playlistOnly = Boolean(playlistId) && videos.length === 0;

  const play = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  return (
    <section id="tutorials" className="mx-auto max-w-3xl px-4 py-10">
      <h2 className="font-sans text-3xl font-semibold tracking-normal text-chalk">
        ODCC Live Tutorial
      </h2>
      <p className="mt-2 font-sans text-sm leading-relaxed text-willow-soft">
        Four short how-tos: score a match, go live, put the overlay in OBS, and copy a YouTube
        stream key. Videos play from YouTube. Add or replace them in Admin → Settings.
      </p>

      <button
        type="button"
        onClick={() => play(0)}
        className="group relative mt-6 block w-full overflow-hidden rounded-[12px] bg-black text-left"
        aria-label={`Open ODCC Live tutorials, ${count} videos`}
      >
        <TutorialPoster />
        <span className="absolute right-4 bottom-4 rounded-full bg-white px-3 py-1.5 font-sans text-sm font-semibold text-ink shadow-tile">
          ≡ {count} videos
        </span>
      </button>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {lessons.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => play(index)}
            className="flex gap-3 rounded-[3px] border border-pitch-line bg-pitch-deep p-3 text-left hover:border-flip/50"
          >
            <LessonThumb lesson={item} index={index} />
            <span className="min-w-0">
              <span className="block font-sans text-sm font-semibold text-chalk">{item.title}</span>
              <span className="mt-1 block font-sans text-xs leading-relaxed text-willow-soft">
                {item.description}
              </span>
              <span className="mt-2 block font-sans text-[0.65rem] font-bold tracking-[0.12em] text-flip uppercase">
                {item.video ? "YouTube" : "How-to"}
              </span>
            </span>
          </button>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={lesson?.title ?? "ODCC Live Tutorial"}
        description={lesson?.description}
        wide
      >
        {lesson ? (
          <div className="flex flex-col gap-4">
            <LessonPlayer
              lesson={lesson}
              playlistId={playlistOnly && active === 0 ? playlistId : null}
            />
            <ol className="flex flex-col gap-2">
              {lessons.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setActive(index)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-[3px] px-2 py-2 text-left",
                      index === active ? "bg-pitch-line text-chalk" : "text-willow-soft hover:text-chalk",
                    )}
                  >
                    <span className="font-mono text-xs text-flip">{index + 1}</span>
                    <span>
                      <span className="block font-sans text-sm font-semibold">{item.title}</span>
                      <span className="block font-sans text-xs">{item.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

function LessonPlayer({ lesson, playlistId }: { lesson: TutorialLesson; playlistId?: string | null }) {
  const src = lesson.video
    ? youtubeEmbed(lesson.video)
    : playlistId
      ? playlistEmbed(playlistId)
      : null;

  return (
    <div className="flex flex-col gap-3">
      {src ? (
        <div className="aspect-video overflow-hidden rounded-[3px] bg-ink">
          <iframe
            title={lesson.title}
            src={src}
            className="size-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="rounded-[3px] border border-pitch-line bg-pitch p-4">
          <p className="font-sans text-xs font-bold tracking-[0.14em] text-flip uppercase">
            How to do this
          </p>
          <ol className="mt-3 flex flex-col gap-2">
            {lesson.steps.map((step, index) => (
              <li key={step} className="font-sans text-sm text-chalk">
                <span className="font-mono text-flip">{index + 1}.</span> {step}
              </li>
            ))}
          </ol>
          <p className="mt-3 font-sans text-xs text-willow-soft">
            Paste the matching YouTube link in Admin → Settings to play the video here.
          </p>
        </div>
      )}
      {lesson.guide.startsWith("/") ? (
        <Link to={lesson.guide} className="self-start">
          <Button size="sm" variant="secondary">
            Open written guide
          </Button>
        </Link>
      ) : lesson.video ? (
        <a href={lesson.video.url} target="_blank" rel="noreferrer" className="self-start">
          <Button size="sm" variant="secondary">
            Watch on YouTube
          </Button>
        </a>
      ) : null}
    </div>
  );
}

function LessonThumb({ lesson, index }: { lesson: TutorialLesson; index: number }) {
  if (lesson.video?.thumbnail_url) {
    return (
      <img
        src={lesson.video.thumbnail_url}
        alt=""
        className="h-16 w-24 shrink-0 rounded-[3px] object-cover"
      />
    );
  }
  return (
    <span className="grid h-16 w-24 shrink-0 place-items-center rounded-[3px] bg-ink font-mono text-lg text-flip">
      {index + 1}
    </span>
  );
}

function TutorialPoster() {
  return (
    <div className="relative aspect-[16/10] bg-[#07140c]">
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(40,90,50,0.45), transparent 42%), radial-gradient(circle at 50% 80%, #0a1a10 0%, #050a07 70%)",
        }}
      />
      <div className="absolute inset-x-0 top-[12%] mx-auto w-[78%] max-w-md rounded-t-[18px] bg-[#111] px-3 pt-3 shadow-tile">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="font-sans text-[0.65rem] font-black tracking-[0.18em] text-white">
            ODCC LIVE
          </span>
          <span className="rounded-full bg-[#e2a73b] px-2 py-0.5 font-sans text-[0.55rem] font-bold text-ink">
            LIVE
          </span>
        </div>
        <div className="overflow-hidden rounded-t-[10px] bg-[#12351f]">
          <div className="bg-[#f3c44a] px-3 py-2 text-center">
            <p className="font-sans text-sm font-black tracking-tight text-ink sm:text-base">
              All Score Overlay of ODCC Live!
            </p>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 px-3 py-3">
            <div>
              <p className="font-sans text-[0.6rem] font-bold tracking-[0.14em] text-white/70 uppercase">
                Overlay
              </p>
              <p className="mt-1 font-mono text-xl font-black text-white">
                142/3 <span className="text-sm text-white/70">14.2</span>
              </p>
              <p className="mt-1 font-sans text-[0.7rem] text-white/80">R. Hasan 54 (32)</p>
            </div>
            <ul className="hidden space-y-1 font-sans text-[0.62rem] font-semibold text-white/85 sm:block">
              <li>Facebook & YouTube</li>
              <li>Live score overlay</li>
              <li>Real-time score</li>
              <li>Team branding</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
    </div>
  );
}
