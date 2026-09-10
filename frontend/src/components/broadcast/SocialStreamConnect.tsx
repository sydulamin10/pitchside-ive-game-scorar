import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { broadcast, publicApi } from "@/lib/api/endpoints";
import type { FacebookSocialStatus, SocialDestinationItem } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

export const YOUTUBE_RTMP = "rtmps://a.rtmp.youtube.com/live2";
export const FACEBOOK_RTMP = "rtmps://live-api-s.facebook.com:443/rtmp/";

export type SocialDestination =
  | "youtube"
  | "facebook_page"
  | "facebook_group"
  | "facebook_profile";

export function socialRtmpUrl(kind: SocialDestination): string {
  return kind === "youtube" ? YOUTUBE_RTMP : FACEBOOK_RTMP;
}

export function socialLabel(kind: SocialDestination, name?: string): string {
  const base =
    kind === "youtube"
      ? "YouTube channel"
      : kind === "facebook_page"
        ? "Facebook page"
        : kind === "facebook_group"
          ? "Facebook group"
          : "Facebook timeline";
  const trimmed = name?.trim();
  return trimmed ? `${base}: ${trimmed}` : base;
}

function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 fill-current" aria-hidden="true">
      <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047v-2.66c0-3.025 1.792-4.697 4.533-4.697 1.312 0 2.686.236 2.686.236v2.97H15.83c-1.491 0-1.956.93-1.956 1.874v2.277h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073" />
    </svg>
  );
}

function DestChoice({
  selected,
  title,
  hint,
  onClick,
}: {
  selected: boolean;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-[3px] border px-3 py-2 text-left transition-colors",
        selected ? "border-flip/80 bg-flip/10" : "border-willow/25 hover:border-willow/50",
      )}
    >
      <span className="block font-sans text-sm font-semibold text-chalk">{title}</span>
      {hint ? <span className="mt-0.5 block font-sans text-[0.65rem] text-willow-soft">{hint}</span> : null}
    </button>
  );
}

/**
 * Prism-style Facebook Login: Connect Facebook → pick Timeline or a Page →
 * Go live on this phone's camera. Stream keys stay as a YouTube / fallback path.
 */
export function SocialStreamConnect({
  destination,
  streamKey,
  destinationName,
  onDestination,
  onStreamKey,
  onDestinationName,
  facebook,
  camera,
  matchId,
  onFacebookChange,
}: {
  destination: SocialDestination;
  streamKey: string;
  destinationName: string;
  onDestination: (value: SocialDestination) => void;
  onStreamKey: (value: string) => void;
  onDestinationName: (value: string) => void;
  facebook?: FacebookSocialStatus | null;
  camera?: { slug: string; token: string };
  matchId?: string;
  onFacebookChange?: () => void;
}) {
  const isYouTube = destination === "youtube";
  const selectedKey = facebook?.selected
    ? `${facebook.selected.kind}:${facebook.selected.id}`
    : "";

  const connectFb = useMutation({
    mutationFn: async () => {
      if (camera) return publicApi.cameraFacebookStart(camera.slug, camera.token);
      if (!matchId) throw new Error("No match to connect Facebook to.");
      return broadcast.facebookStart(matchId, window.location.href);
    },
    onSuccess: (data) => {
      window.location.assign(data.auth_url);
    },
    onError: (err) => toastError(err, "Could not open Facebook Login."),
  });

  const disconnectFb = useMutation({
    mutationFn: async () => {
      if (camera) return publicApi.cameraFacebookDisconnect(camera.slug, camera.token);
      if (!matchId) throw new Error("No match to disconnect Facebook from.");
      return broadcast.facebookDisconnect(matchId);
    },
    onSuccess: () => {
      toast("Facebook disconnected.", "info");
      onFacebookChange?.();
    },
    onError: (err) => toastError(err, "Could not disconnect Facebook."),
  });

  const selectFb = useMutation({
    mutationFn: async (item: { kind: SocialDestinationItem["kind"]; id: string }) => {
      if (camera) return publicApi.cameraSocialSelect(camera.slug, camera.token, item);
      if (!matchId) throw new Error("No match to save the destination on.");
      return broadcast.socialSelect(matchId, item);
    },
    onSuccess: (data) => {
      onDestination(data.selected.kind);
      onDestinationName(data.selected.name);
      toast(`Live will go to ${data.selected.name}.`, "success");
      onFacebookChange?.();
    },
    onError: (err) => toastError(err, "Could not save that Facebook destination."),
  });

  const pick = (item: SocialDestinationItem) => {
    if (`${item.kind}:${item.id}` === selectedKey) return;
    selectFb.mutate({ kind: item.kind, id: item.id });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
        Go live to
      </p>
      <div className="grid grid-cols-2 gap-2">
        <DestChoice
          selected={!isYouTube}
          title="Facebook"
          hint="Login · Timeline or Page"
          onClick={() => {
            if (isYouTube) onDestination("facebook_page");
          }}
        />
        <DestChoice
          selected={isYouTube}
          title="YouTube"
          hint="Paste a stream key"
          onClick={() => onDestination("youtube")}
        />
      </div>

      {isYouTube ? (
        <>
          <p className="font-sans text-xs leading-relaxed text-willow-soft">
            YouTube Studio opens in the phone browser — the YouTube app cannot give a stream key.
            Copy the key, save it here, then tap Go live on this camera. Viewers watch in the
            YouTube app after the stream actually starts.
          </p>
          <a href="https://studio.youtube.com/channel/UC/livestreaming" target="_blank" rel="noreferrer">
            <Button size="sm" type="button" variant="secondary" fullWidth>
              Open YouTube Studio
            </Button>
          </a>
          <TextField
            label="Channel name"
            value={destinationName}
            onChange={(e) => onDestinationName(e.target.value)}
            placeholder="e.g. ODCC Live"
          />
          <TextField
            label="YouTube stream key"
            value={streamKey}
            onChange={(e) => onStreamKey(e.target.value)}
            placeholder="Paste the key, then Save"
            autoComplete="off"
            spellCheck={false}
          />
        </>
      ) : (
        <>
          <p className="font-sans text-xs leading-relaxed text-willow-soft">
            Connect Facebook opens Facebook Login in this phone’s browser — not the Facebook app.
            After you approve, you return here, pick the Page, then tap Go live. This camera and
            mic stay in ODCC. Viewers watch in the Facebook app once video reaches the Page.
          </p>

          {!facebook?.enabled ? (
            <p className="rounded-[3px] border border-willow/25 px-3 py-2 font-sans text-[0.72rem] leading-relaxed text-willow-soft">
              Facebook Login is off until an admin pastes the Meta App ID and Secret on Admin →
              Facebook Live. Until then you can still paste a stream key below.
            </p>
          ) : facebook.connected ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-sans text-sm text-chalk">
                  Connected as <span className="font-semibold">{facebook.name ?? "Facebook"}</span>
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    loading={connectFb.isPending}
                    onClick={() => connectFb.mutate()}
                  >
                    Reconnect
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    loading={disconnectFb.isPending}
                    onClick={() => disconnectFb.mutate()}
                  >
                    Disconnect
                  </Button>
                </div>
              </div>

              <p className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
                Choose where to post
              </p>
              <div className="grid gap-1.5">
                {facebook.profile ? (
                  <DestChoice
                    selected={selectedKey === `${facebook.profile.kind}:${facebook.profile.id}`}
                    title="Timeline"
                    hint={facebook.profile.name}
                    onClick={() => pick(facebook.profile!)}
                  />
                ) : null}
                {facebook.pages.map((page) => (
                  <DestChoice
                    key={page.id}
                    selected={selectedKey === `${page.kind}:${page.id}`}
                    title={page.name}
                    hint="Page"
                    onClick={() => pick(page)}
                  />
                ))}
                {facebook.groups.map((group) => (
                  <DestChoice
                    key={group.id}
                    selected={selectedKey === `${group.kind}:${group.id}`}
                    title={group.name}
                    hint="Group — Facebook often blocks this"
                    onClick={() => pick(group)}
                  />
                ))}
              </div>
              {facebook.pages.length === 0 ? (
                <p className="font-sans text-[0.68rem] leading-relaxed text-willow-soft">
                  No Pages came back. On Facebook’s next screen, tick every Page you manage, then
                  tap Reconnect. Groups are no longer offered by Facebook to most apps.
                </p>
              ) : null}
              {facebook.selected ? (
                <p className="font-sans text-[0.72rem] text-flip">
                  Next: tap Go live on this camera. ODCC going live is not the same as the Facebook
                  Page — the Page appears LIVE after video reaches Facebook.
                </p>
              ) : (
                <p className="font-sans text-[0.72rem] text-willow-soft">
                  Pick Timeline or a Page, then tap Go live.
                </p>
              )}
            </div>
          ) : (
            <Button
              type="button"
              fullWidth
              loading={connectFb.isPending}
              onClick={() => connectFb.mutate()}
              className="!border-[#166FE5] !bg-[#1877F2] !text-white hover:!bg-[#166FE5] hover:!text-white"
            >
              <FacebookMark />
              Connect Facebook
            </Button>
          )}

          <details className="rounded-[3px] border border-willow/20 px-2 py-1.5">
            <summary className="cursor-pointer font-sans text-[0.68rem] text-willow-soft">
              Advanced: paste a Facebook stream key
            </summary>
            <div className="mt-2 grid gap-2">
              <p className="font-sans text-[0.65rem] leading-relaxed text-willow-soft">
                Same as OBS if Login is unavailable: Live Producer → Streaming software → copy the
                key once.
              </p>
              <a href="https://www.facebook.com/live/producer" target="_blank" rel="noreferrer">
                <Button size="sm" type="button" variant="secondary" fullWidth>
                  Open Facebook Live Producer
                </Button>
              </a>
              <TextField
                label="Page / Group name"
                value={destinationName}
                onChange={(e) => onDestinationName(e.target.value)}
                placeholder="e.g. ODCC Official"
              />
              <TextField
                label="Facebook stream key"
                value={streamKey}
                onChange={(e) => onStreamKey(e.target.value)}
                placeholder="Paste the key, then Save"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
