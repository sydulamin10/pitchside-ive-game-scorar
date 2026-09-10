import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { OverlayDirectorPanel } from "@/components/broadcast/OverlayDirectorPanel";
import { HistoryBackButton } from "@/components/layout/HistoryBackButton";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, SectionTitle, Spinner } from "@/components/ui/Surface";
import { admin } from "@/lib/api/endpoints";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import type { MatchListItem, OverlayDirector } from "@/lib/api/types";
import { toast, toastError } from "@/store/toast";

function LiveMatchRow({ match }: { match: MatchListItem }) {
  const { state } = useMatchStream(match.public_slug, {
    enabled: match.status === "live" || match.status === "innings_break",
    pollMs: 4_000,
  });

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-sans text-sm font-semibold text-chalk">
            {match.title ?? `${match.team_a_name} vs ${match.team_b_name}`}
          </p>
          <p className="font-sans text-xs text-willow-soft">
            {match.score_line ?? "No score yet"} · {match.status.replace("_", " ")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={match.status === "live" ? "live" : "quiet"}>{match.status}</Badge>
          <Link to={`/app/matches/${match.id}`}>
            <Button size="sm" variant="ghost">
              Score
            </Button>
          </Link>
          <Link to={`/app/matches/${match.id}/broadcast`}>
            <Button size="sm" variant="secondary">
              Go Live
            </Button>
          </Link>
        </div>
      </div>
      <OverlayDirectorPanel matchId={match.id} graphics={state?.graphics as OverlayDirector | null} />
    </Panel>
  );
}

export default function Admin() {
  const live = useQuery({
    queryKey: ["admin-matches", "live"],
    queryFn: () => admin.matches({ status: "live", limit: 50 }),
  });
  const breakQuery = useQuery({
    queryKey: ["admin-matches", "innings_break"],
    queryFn: () => admin.matches({ status: "innings_break", limit: 20 }),
  });
  const facebook = useQuery({
    queryKey: ["admin-facebook-settings"],
    queryFn: () => admin.facebookSettings(),
  });
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");

  useEffect(() => {
    if (facebook.data?.app_id) setAppId(facebook.data.app_id);
  }, [facebook.data?.app_id]);

  const saveFacebook = useMutation({
    mutationFn: () =>
      admin.saveFacebookSettings({
        app_id: appId,
        app_secret: appSecret.trim() ? appSecret : null,
      }),
    onSuccess: (data) => {
      setAppSecret("");
      toast(
        data.configured
          ? "Facebook Login is on. Cameramen can tap Connect Facebook."
          : "Facebook Login is off.",
        "success",
      );
      void facebook.refetch();
    },
    onError: (err) => toastError(err, "Could not save Facebook settings."),
  });

  const matches = [...(live.data ?? []), ...(breakQuery.data ?? [])];
  const redirectUri = facebook.data?.redirect_uri;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-start gap-2">
        <HistoryBackButton />
        <div>
          <h1 className="font-sans text-lg font-semibold text-chalk">Admin</h1>
          <p className="font-sans text-xs text-willow-soft">
            Direct the live overlay, ticker and tournament chip for matches that are on air.
          </p>
        </div>
      </header>

      <Panel className="flex flex-col gap-3 p-4">
        <SectionTitle>Facebook Live</SectionTitle>
        <p className="font-sans text-xs leading-relaxed text-willow-soft">
          Same login Prism uses: the cameraman taps Connect Facebook, picks Timeline or a Page,
          then Go live on this app’s camera. Create a Meta app, add Facebook Login, add the
          cameraman as a Tester, then paste the App ID and Secret here.
        </p>
        {redirectUri ? (
          <div className="flex flex-col gap-1">
            <p className="font-sans text-[0.65rem] font-bold tracking-[0.14em] text-willow-soft uppercase">
              Valid OAuth Redirect URI
            </p>
            <code className="break-all rounded-[3px] border border-willow/20 bg-ink px-2 py-1.5 font-mono text-[0.68rem] text-chalk">
              {redirectUri}
            </code>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(redirectUri).then(
                  () => toast("Redirect URI copied.", "success"),
                  () => toast("Could not copy.", "error"),
                );
              }}
            >
              Copy redirect URI
            </Button>
          </div>
        ) : null}
        <TextField
          label="Facebook App ID"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
          placeholder="From developers.facebook.com"
          autoComplete="off"
        />
        <TextField
          label="Facebook App Secret"
          type="password"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
          placeholder={facebook.data?.has_secret ? "Leave blank to keep the saved secret" : "Paste once"}
          autoComplete="off"
        />
        <p className="font-sans text-[0.68rem] leading-relaxed text-willow-soft">
          The Meta app must be a Website app, not Desktop. Settings → Advanced → Native or desktop
          app = No. App Domains: <code className="text-chalk">odcc.live</code> only (no api.).
          Valid OAuth Redirect URI is the URL above. On Facebook’s permission screen tick every
          Page. Development mode only works for Testers and Admins.
        </p>
        <Button
          size="sm"
          type="button"
          loading={saveFacebook.isPending}
          onClick={() => saveFacebook.mutate()}
        >
          {facebook.data?.configured ? "Update Facebook app" : "Turn on Connect Facebook"}
        </Button>
      </Panel>

      {live.isLoading ? (
        <Spinner label="Loading live matches" />
      ) : matches.length === 0 ? (
        <EmptyState
          title="No live matches"
          description="When a scorer goes live, the overlay controls will appear here."
        />
      ) : (
        <div className="flex flex-col gap-3">
          <SectionTitle>On air</SectionTitle>
          {matches.map((match) => (
            <LiveMatchRow key={match.id} match={match} />
          ))}
        </div>
      )}
    </div>
  );
}
