import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { AccountControls } from "@/components/admin/AccountControls";
import {
  ContentPanel,
  OverviewPanel,
  RequestsPanel,
  TutorialsPanel,
} from "@/components/admin/SiteOps";
import { OverlayDirectorPanel } from "@/components/broadcast/OverlayDirectorPanel";
import { EventGraphics } from "@/components/broadcast/EventGraphics";
import { mockOverlayState } from "@/components/broadcast/TvScoreBars";
import { HistoryBackButton } from "@/components/layout/HistoryBackButton";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Badge, EmptyState, Panel, SectionTitle, Spinner } from "@/components/ui/Surface";
import { admin, billing } from "@/lib/api/endpoints";
import { useMatchStream } from "@/lib/realtime/useMatchStream";
import type { MatchListItem, MatchStatus, OverlayDirector } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { toast, toastError } from "@/store/toast";

type Tab =
  | "dashboard"
  | "users"
  | "teams"
  | "matches"
  | "tournaments"
  | "broadcast"
  | "plans"
  | "settings"
  | "revenue"
  | "support";

const NAV: Array<[Tab, string]> = [
  ["dashboard", "Dashboard"],
  ["users", "Users"],
  ["teams", "Teams"],
  ["matches", "Matches"],
  ["tournaments", "Tournaments"],
  ["broadcast", "Broadcast"],
  ["plans", "Plans & Payments"],
  ["settings", "Settings"],
  ["revenue", "Revenue"],
  ["support", "Support"],
];

export default function Admin() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <aside className="lg:sticky lg:top-24 lg:w-56 lg:shrink-0">
        <div className="mb-3 flex items-start gap-2 lg:hidden">
          <HistoryBackButton />
          <div>
            <h1 className="font-sans text-lg font-semibold text-chalk">Admin Panel</h1>
            <p className="font-sans text-xs text-willow-soft">Manage ODCC LIVE from one place.</p>
          </div>
        </div>
        <Panel className="p-2">
          <p className="hidden px-3 pt-2 font-sans text-[0.62rem] font-bold tracking-[0.16em] text-willow-soft uppercase lg:block">
            Admin Panel
          </p>
          <nav className="flex gap-1 overflow-x-auto lg:mt-2 lg:flex-col" aria-label="Admin sections">
            {NAV.map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "shrink-0 rounded-[3px] px-3 py-2 text-left font-sans text-sm",
                  tab === id ? "bg-flip/15 font-semibold text-flip" : "text-willow-soft hover:bg-pitch-line hover:text-chalk",
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        </Panel>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="mb-4 hidden items-start gap-2 lg:flex">
          <HistoryBackButton />
          <div>
            <h1 className="font-sans text-xl font-semibold text-chalk">
              {NAV.find(([id]) => id === tab)?.[1]}
            </h1>
            <p className="font-sans text-xs text-willow-soft">
              Simple controls for users, matches, broadcasts, payments and support.
            </p>
          </div>
        </header>
        {tab === "dashboard" ? <OverviewPanel /> : null}
        {tab === "users" ? <UsersSection /> : null}
        {tab === "teams" ? <TeamsSection /> : null}
        {tab === "matches" ? <MatchesSection /> : null}
        {tab === "tournaments" ? <TournamentsSection /> : null}
        {tab === "broadcast" ? <BroadcastSection /> : null}
        {tab === "plans" ? <PlansSection /> : null}
        {tab === "settings" ? <SettingsSection /> : null}
        {tab === "revenue" ? <RevenueSection /> : null}
        {tab === "support" ? <SupportSection /> : null}
      </div>
    </div>
  );
}

function UsersSection() {
  const [filter, setFilter] = useState<"all" | "pending" | "unverified">("all");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["all", "All users"],
            ["unverified", "Unverified email"],
            ["pending", "Pending approval"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "rounded-[3px] px-3 py-1.5 font-sans text-sm",
              filter === id ? "bg-pitch-line text-flip" : "text-willow-soft hover:text-chalk",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <AccountControls pendingOnly={filter === "pending"} unverifiedOnly={filter === "unverified"} />
    </div>
  );
}

function TeamsSection() {
  const teams = useQuery({ queryKey: ["admin-teams"], queryFn: () => admin.teams({ limit: 80 }) });
  if (teams.isLoading) return <Spinner label="Loading teams" />;
  const rows = teams.data ?? [];
  if (rows.length === 0) {
    return <EmptyState title="No teams" description="Registered clubs will appear here." />;
  }
  return (
    <Panel className="overflow-x-auto p-4">
      <SectionTitle>Team list</SectionTitle>
      <table className="mt-3 w-full min-w-[40rem] text-left font-sans text-sm">
        <thead className="text-willow-soft">
          <tr>
            <th className="py-2 font-semibold">Team</th>
            <th className="py-2 font-semibold">Ground</th>
            <th className="py-2 font-semibold">Owner</th>
            <th className="py-2 font-semibold">Players</th>
            <th className="py-2 font-semibold">Open</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-pitch-line">
              <td className="py-3">
                <div className="flex items-center gap-2">
                  {row.logo_url ? (
                    <img src={row.logo_url} alt="" className="size-8 rounded-full object-cover" />
                  ) : (
                    <span className="grid size-8 place-items-center rounded-full bg-pitch-line font-mono text-xs">
                      {row.name.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-xs text-willow-soft">{row.manager_name ?? "—"}</p>
                  </div>
                </div>
              </td>
              <td className="py-3 text-willow-soft">{row.home_ground ?? "—"}</td>
              <td className="py-3">
                <p>{row.owner_name}</p>
                <p className="text-xs text-willow-soft">{row.owner_email}</p>
              </td>
              <td className="py-3 tabular">{row.player_count}</td>
              <td className="py-3">
                {row.public_slug ? (
                  <Link to={`/club/${row.public_slug}`} className="text-flip underline-offset-4 hover:underline">
                    View
                  </Link>
                ) : (
                  <span className="text-willow-soft">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function MatchesSection() {
  const [status, setStatus] = useState<MatchStatus | "all">("all");
  const matches = useQuery({
    queryKey: ["admin-matches-all", status],
    queryFn: () => admin.matches({ status: status === "all" ? undefined : status, limit: 80 }),
  });
  const filters: Array<[MatchStatus | "all", string]> = [
    ["all", "All"],
    ["setup", "Upcoming"],
    ["live", "Live"],
    ["completed", "Completed"],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {filters.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setStatus(id)}
            className={cn(
              "rounded-[3px] px-3 py-1.5 font-sans text-sm",
              status === id ? "bg-pitch-line text-flip" : "text-willow-soft hover:text-chalk",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {matches.isLoading ? (
        <Spinner label="Loading matches" />
      ) : (matches.data ?? []).length === 0 ? (
        <EmptyState title="No matches" description="Created matches will appear here." />
      ) : (
        <Panel className="overflow-x-auto p-4">
          <table className="w-full min-w-[48rem] text-left font-sans text-sm">
            <thead className="text-willow-soft">
              <tr>
                <th className="py-2 font-semibold">Match</th>
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 font-semibold">Venue</th>
                <th className="py-2 font-semibold">Score</th>
                <th className="py-2 font-semibold">Broadcast</th>
                <th className="py-2 font-semibold">Open</th>
              </tr>
            </thead>
            <tbody>
              {(matches.data ?? []).map((match) => (
                <tr key={match.id} className="border-t border-pitch-line">
                  <td className="py-3">
                    <p className="font-semibold">
                      {match.title ?? `${match.team_a_name} vs ${match.team_b_name}`}
                    </p>
                    <p className="text-xs text-willow-soft">{match.match_format.toUpperCase()}</p>
                  </td>
                  <td className="py-3 text-xs text-willow-soft">
                    {match.scheduled_at
                      ? new Date(match.scheduled_at).toLocaleString()
                      : match.started_at
                        ? new Date(match.started_at).toLocaleString()
                        : "—"}
                  </td>
                  <td className="py-3 text-willow-soft">{match.venue ?? "—"}</td>
                  <td className="py-3">{match.score_line ?? "—"}</td>
                  <td className="py-3">
                    <Badge tone={match.status === "live" ? "live" : "quiet"}>{match.status.replace("_", " ")}</Badge>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      <Link to={`/s/${match.public_slug}`} className="text-flip underline-offset-4 hover:underline">
                        Scorecard
                      </Link>
                      <Link to={`/app/matches/${match.id}`} className="text-willow-soft underline-offset-4 hover:underline">
                        Score
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function TournamentsSection() {
  const rows = useQuery({
    queryKey: ["admin-tournaments"],
    queryFn: () => admin.tournaments({ limit: 80 }),
  });
  if (rows.isLoading) return <Spinner label="Loading tournaments" />;
  if ((rows.data ?? []).length === 0) {
    return (
      <EmptyState
        title="No tournaments"
        description="Create a tournament from the scoring app. It will show here."
      />
    );
  }
  return (
    <Panel className="overflow-x-auto p-4">
      <SectionTitle>Tournaments</SectionTitle>
      <table className="mt-3 w-full min-w-[36rem] text-left font-sans text-sm">
        <thead className="text-willow-soft">
          <tr>
            <th className="py-2 font-semibold">Name</th>
            <th className="py-2 font-semibold">Format</th>
            <th className="py-2 font-semibold">Status</th>
            <th className="py-2 font-semibold">Open</th>
          </tr>
        </thead>
        <tbody>
          {(rows.data ?? []).map((row) => (
            <tr key={row.id} className="border-t border-pitch-line">
              <td className="py-3">
                <p className="font-semibold">{row.name}</p>
                <p className="text-xs text-willow-soft">{row.venue ?? "—"}</p>
              </td>
              <td className="py-3 capitalize">{row.tournament_format.replace("_", " ")}</td>
              <td className="py-3">
                <Badge tone={row.status === "active" ? "live" : "quiet"}>{row.status}</Badge>
              </td>
              <td className="py-3">
                <Link to={`/t/${row.public_slug}`} className="text-flip underline-offset-4 hover:underline">
                  Public page
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function BroadcastSection() {
  const live = useQuery({
    queryKey: ["admin-matches", "live"],
    queryFn: () => admin.matches({ status: "live", limit: 50 }),
  });
  const breakQuery = useQuery({
    queryKey: ["admin-matches", "innings_break"],
    queryFn: () => admin.matches({ status: "innings_break", limit: 20 }),
  });
  const matches = [...(live.data ?? []), ...(breakQuery.data ?? [])];
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-3 p-4">
        <SectionTitle>Overlay preview / test</SectionTitle>
        <p className="font-sans text-xs text-willow-soft">
          These buttons play graphics on this page only. They do not change a live match score.
        </p>
        <OverlayTestBench />
      </Panel>
      {live.isLoading ? (
        <Spinner label="Loading live matches" />
      ) : matches.length === 0 ? (
        <EmptyState
          title="No live matches"
          description="When a scorer goes live, broadcast controls appear here."
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

function PlansSection() {
  const plans = useQuery({ queryKey: ["billing-plans"], queryFn: () => billing.plans() });
  const payments = useQuery({
    queryKey: ["billing-payments"],
    queryFn: () => billing.payments({ limit: 40 }),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {(plans.data ?? []).map((plan) => (
          <Panel key={plan.id} className="p-4">
            <SectionTitle>{plan.name}</SectionTitle>
            <p className="mt-2 font-mono text-2xl font-black text-chalk">${plan.price}</p>
            <p className="mt-1 font-sans text-xs text-willow-soft">
              {plan.unlimited ? "Unlimited live while active" : `${plan.credits ?? 0} live credit(s)`}
            </p>
          </Panel>
        ))}
      </div>
      <Panel className="overflow-x-auto p-4">
        <SectionTitle>Payments</SectionTitle>
        {payments.isLoading ? (
          <Spinner label="Loading payments" />
        ) : (payments.data ?? []).length === 0 ? (
          <p className="pt-3 font-sans text-sm text-willow-soft">No payments yet.</p>
        ) : (
          <table className="mt-3 w-full min-w-[36rem] text-left font-sans text-sm">
            <thead className="text-willow-soft">
              <tr>
                <th className="py-2 font-semibold">User</th>
                <th className="py-2 font-semibold">Package</th>
                <th className="py-2 font-semibold">Amount</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(payments.data ?? []).map((row) => (
                <tr key={row.id} className="border-t border-pitch-line">
                  <td className="py-2">
                    {row.user_name}
                    <span className="block text-xs text-willow-soft">{row.user_email}</span>
                  </td>
                  <td className="py-2 capitalize">{row.plan.replace("_", " ")}</td>
                  <td className="py-2 tabular">
                    ${row.paid_amount} {row.currency}
                  </td>
                  <td className="py-2">
                    <Badge tone={row.status === "paid" ? "live" : "quiet"}>{row.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="font-sans text-xs text-willow-soft">
        Record a payment or coupon from the{" "}
        <Link to="/billing" className="text-flip underline">
          Billing Portal
        </Link>
        .
      </p>
    </div>
  );
}

function SettingsSection() {
  const snap = useQuery({ queryKey: ["admin-settings"], queryFn: () => admin.settings() });
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
  const data = snap.data;
  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-4">
        <SectionTitle>Website</SectionTitle>
        <dl className="mt-3 grid gap-2 font-sans text-sm sm:grid-cols-2">
          <div>
            <dt className="text-willow-soft">Name</dt>
            <dd>{data?.website_name ?? "ODCC LIVE"}</dd>
          </div>
          <div>
            <dt className="text-willow-soft">Public URL</dt>
            <dd className="break-all">{data?.public_web_url}</dd>
          </div>
          <div>
            <dt className="text-willow-soft">Currency</dt>
            <dd>{data?.currency ?? "USD"}</dd>
          </div>
        </dl>
      </Panel>
      <Panel className="p-4">
        <SectionTitle>Email settings</SectionTitle>
        <dl className="mt-3 grid gap-2 font-sans text-sm sm:grid-cols-2">
          <div>
            <dt className="text-willow-soft">SMTP</dt>
            <dd>{data?.smtp_configured ? "Connected (Gmail)" : "Not configured"}</dd>
          </div>
          <div>
            <dt className="text-willow-soft">From</dt>
            <dd>{data?.smtp_from ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-willow-soft">Verification required</dt>
            <dd>{data?.email_verify_required ? "Yes — users confirm email before login" : "Off"}</dd>
          </div>
        </dl>
      </Panel>
      <Panel className="flex flex-col gap-3 p-4">
        <SectionTitle>Facebook integration</SectionTitle>
        <TextField
          label="Facebook App ID"
          value={appId}
          onChange={(e) => setAppId(e.target.value)}
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
        <Button size="sm" type="button" loading={saveFacebook.isPending} onClick={() => saveFacebook.mutate()}>
          {facebook.data?.configured ? "Update Facebook app" : "Turn on Connect Facebook"}
        </Button>
      </Panel>
      <ContentPanel />
      <TutorialsPanel />
    </div>
  );
}

function RevenueSection() {
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: () => admin.overview() });
  const data = overview.data;
  if (overview.isLoading) return <Spinner label="Loading revenue" />;
  if (!data) return <p className="font-sans text-sm text-willow-soft">Could not load revenue.</p>;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {(
        [
          ["Today", data.revenue.today],
          ["This month", data.revenue.month],
          ["All time", data.revenue.all_time],
        ] as const
      ).map(([label, value]) => (
        <Panel key={label} className="p-4">
          <SectionTitle>{label}</SectionTitle>
          <p className="mt-2 font-mono text-2xl font-black text-chalk">
            ${value} {data.revenue.currency}
          </p>
        </Panel>
      ))}
    </div>
  );
}

function SupportSection() {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () => admin.sendSupportEmail({ to, subject, body }),
    onSuccess: (row) => {
      toast(row.message, "success");
      setSubject("");
      setBody("");
    },
    onError: (err) => toastError(err, "Could not send that email."),
  });
  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-3 p-4">
        <SectionTitle>New email</SectionTitle>
        <p className="font-sans text-xs text-willow-soft">
          Sends from the configured Gmail account. SMS gateway is not connected yet — use email.
        </p>
        <TextField label="To" type="email" value={to} onChange={(e) => setTo(e.target.value)} required />
        <TextField label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
        <label className="flex flex-col gap-1 font-sans text-sm">
          <span className="text-willow-soft">Message</span>
          <textarea
            className="min-h-32 rounded-[3px] border border-pitch-line bg-ink px-3 py-2 text-chalk"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        <Button
          type="button"
          disabled={!to.trim() || !subject.trim() || !body.trim()}
          loading={send.isPending}
          onClick={() => send.mutate()}
        >
          Send email
        </Button>
      </Panel>
      <RequestsPanel />
    </div>
  );
}

function OverlayTestBench() {
  const [preview, setPreview] = useState(mockOverlayState());
  const fire = (display: string) => {
    setPreview((current) =>
      mockOverlayState({
        ...current,
        state_version: (current.state_version ?? 1) + 1,
        recent_balls: [
          {
            delivery_id: `test-${display}-${Date.now()}`,
            sequence: Date.now(),
            over_number: 6,
            ball_in_over: 2,
            over_ball_text: "6.2",
            display,
            runs_total: Number.parseInt(display, 10) || 0,
            batter_runs: Number.parseInt(display, 10) || 0,
            extra_type: display.includes("wd") ? "wide" : display.includes("nb") ? "no_ball" : null,
            extra_runs: 0,
            is_wicket: display.toLowerCase() === "w",
            is_legal: true,
            is_free_hit: false,
            striker_id: "p1",
            striker_name: "Preview",
            bowler_id: "p9",
            bowler_name: "Test",
            commentary: null,
          },
        ],
      }),
    );
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button" variant="ghost" onClick={() => fire("4")}>
          Test 4
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => fire("6")}>
          Test 6
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => fire("W")}>
          Test wicket
        </Button>
        <Button size="sm" type="button" variant="ghost" onClick={() => fire("wd")}>
          Test wide
        </Button>
      </div>
      <div className="relative h-48 overflow-hidden rounded-[4px] border border-willow/20 bg-ink">
        <EventGraphics state={preview} />
      </div>
    </div>
  );
}
