import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { CheckField, TextField } from "@/components/ui/Field";
import { Badge, Panel, SectionTitle, Spinner } from "@/components/ui/Surface";
import { admin } from "@/lib/api/endpoints";
import type { CouponRequestItem, FaqItem, SupportRequestItem, Topup } from "@/lib/api/types";
import { toast, toastError } from "@/store/toast";

export function OverviewPanel() {
  const overview = useQuery({ queryKey: ["admin-overview"], queryFn: () => admin.overview() });
  const data = overview.data;
  const totals = data?.totals;

  if (overview.isLoading) return <Spinner label="Loading dashboard" />;
  if (!totals) {
    return <p className="font-sans text-sm text-willow-soft">Could not load the dashboard.</p>;
  }

  const cards: Array<[string, string | number]> = [
    ["Users", totals.users],
    ["Teams", totals.teams],
    ["Matches", totals.matches],
    ["Live now", totals.live_matches],
    ["Tournaments", totals.active_tournaments],
    ["Pro accounts", totals.active_pro_subscribers],
    ["Pending top-ups", totals.pending_topups ?? 0],
    ["Coupon requests", totals.pending_coupon_requests ?? 0],
    ["Open support", totals.open_support_requests ?? 0],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(([label, value]) => (
          <Panel key={label} className="p-4">
            <SectionTitle>{label}</SectionTitle>
            <p className="mt-1 font-mono text-2xl font-black text-chalk">{value}</p>
          </Panel>
        ))}
      </div>
      <Panel className="p-4">
        <SectionTitle>Revenue ({data.revenue.currency})</SectionTitle>
        <div className="mt-3 grid grid-cols-3 gap-3 font-sans text-sm">
          <div>
            <p className="text-willow-soft">Today</p>
            <p className="font-mono text-lg text-chalk">${data.revenue.today}</p>
          </div>
          <div>
            <p className="text-willow-soft">This month</p>
            <p className="font-mono text-lg text-chalk">${data.revenue.month}</p>
          </div>
          <div>
            <p className="text-willow-soft">All time</p>
            <p className="font-mono text-lg text-chalk">${data.revenue.all_time}</p>
          </div>
        </div>
      </Panel>
      <Panel className="p-4">
        <SectionTitle>Recent payments</SectionTitle>
        {(data.recent_payments ?? []).length === 0 ? (
          <p className="pt-3 font-sans text-sm text-willow-soft">No payments yet.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {data.recent_payments.map((row) => (
              <li key={row.id} className="flex justify-between gap-2 font-sans text-sm">
                <span className="text-chalk">
                  {row.user_email ?? "Account"} · {row.plan}
                </span>
                <span className="tabular text-willow-soft">${row.paid_amount}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel className="p-4">
        <SectionTitle>New accounts</SectionTitle>
        <ul className="mt-3 flex flex-col gap-2">
          {(data.recent_users ?? []).map((row) => (
            <li key={row.id} className="flex justify-between gap-2 font-sans text-sm">
              <span className="truncate text-chalk">{row.display_name}</span>
              <span className="shrink-0 text-willow-soft">{row.email}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function RequestsPanel() {
  return (
    <div className="flex flex-col gap-6">
      <TopupQueue />
      <CouponQueue />
      <SupportQueue />
    </div>
  );
}

function TopupQueue() {
  const client = useQueryClient();
  const rows = useQuery({
    queryKey: ["admin-topups"],
    queryFn: () => admin.topups({ limit: 80 }),
  });
  const approve = useMutation({
    mutationFn: (id: string) => admin.approveTopup(id),
    onSuccess: () => {
      toast("Top-up added to the wallet.", "success");
      void client.invalidateQueries({ queryKey: ["admin-topups"] });
      void client.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (err) => toastError(err, "Could not approve that top-up."),
  });
  const reject = useMutation({
    mutationFn: (id: string) => admin.rejectTopup(id),
    onSuccess: () => {
      toast("Top-up rejected.", "success");
      void client.invalidateQueries({ queryKey: ["admin-topups"] });
      void client.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (err) => toastError(err, "Could not reject that top-up."),
  });

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <SectionTitle>Wallet top-ups</SectionTitle>
      {rows.isLoading ? (
        <Spinner label="Loading top-ups" />
      ) : (rows.data ?? []).length === 0 ? (
        <p className="font-sans text-sm text-willow-soft">No top-up requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(rows.data ?? []).map((row) => (
            <TopupRow
              key={row.id}
              row={row}
              busy={approve.isPending || reject.isPending}
              onApprove={() => approve.mutate(row.id)}
              onReject={() => reject.mutate(row.id)}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function TopupRow({
  row,
  busy,
  onApprove,
  onReject,
}: {
  row: Topup;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <li className="rounded-[3px] border border-pitch-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-sans text-sm font-semibold text-chalk">
            {row.user_name ?? "User"} · ${row.amount}
          </p>
          <p className="font-sans text-xs text-willow-soft">
            {row.user_email} · {row.method}
            {row.reference ? ` · ${row.reference}` : ""}
          </p>
          {row.note ? <p className="pt-1 font-sans text-xs text-willow">{row.note}</p> : null}
        </div>
        <Badge tone={row.status === "approved" ? "live" : row.status === "rejected" ? "wicket" : "quiet"}>
          {row.status}
        </Badge>
      </div>
      {row.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button size="sm" loading={busy} onClick={onApprove}>
            Approve
          </Button>
          <Button size="sm" variant="ghost" loading={busy} onClick={onReject}>
            Reject
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function CouponQueue() {
  const client = useQueryClient();
  const rows = useQuery({
    queryKey: ["admin-coupon-requests"],
    queryFn: () => admin.couponRequests(),
  });
  const [drafts, setDrafts] = useState<Record<string, { response: string; coupon_code: string }>>({});

  const resolve = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "approved" | "rejected";
    }) =>
      admin.resolveCouponRequest(id, {
        status,
        response: drafts[id]?.response || null,
        coupon_code: drafts[id]?.coupon_code || null,
      }),
    onSuccess: () => {
      toast("Coupon request updated.", "success");
      void client.invalidateQueries({ queryKey: ["admin-coupon-requests"] });
      void client.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (err) => toastError(err, "Could not update that request."),
  });

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <SectionTitle>Coupon requests</SectionTitle>
      {rows.isLoading ? (
        <Spinner label="Loading coupon requests" />
      ) : (rows.data ?? []).length === 0 ? (
        <p className="font-sans text-sm text-willow-soft">No coupon requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(rows.data ?? []).map((row) => (
            <CouponRow
              key={row.id}
              row={row}
              draft={drafts[row.id] ?? { response: "", coupon_code: "" }}
              onDraft={(next) => setDrafts((current) => ({ ...current, [row.id]: next }))}
              busy={resolve.isPending}
              onResolve={(status) => resolve.mutate({ id: row.id, status })}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function CouponRow({
  row,
  draft,
  onDraft,
  busy,
  onResolve,
}: {
  row: CouponRequestItem;
  draft: { response: string; coupon_code: string };
  onDraft: (next: { response: string; coupon_code: string }) => void;
  busy: boolean;
  onResolve: (status: "approved" | "rejected") => void;
}) {
  return (
    <li className="rounded-[3px] border border-pitch-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-sans text-sm font-semibold text-chalk">{row.user_name ?? "User"}</p>
          <p className="font-sans text-xs text-willow-soft">{row.user_email}</p>
          {row.message ? <p className="pt-1 font-sans text-sm text-chalk">{row.message}</p> : null}
        </div>
        <Badge tone={row.status === "approved" ? "live" : row.status === "rejected" ? "wicket" : "quiet"}>
          {row.status}
        </Badge>
      </div>
      {row.coupon_code ? (
        <p className="pt-2 font-mono text-sm font-bold text-flip">{row.coupon_code}</p>
      ) : null}
      {row.response ? <p className="pt-1 font-sans text-xs text-willow-soft">{row.response}</p> : null}
      {row.status === "pending" ? (
        <div className="mt-3 flex flex-col gap-2">
          <TextField
            label="Coupon code"
            value={draft.coupon_code}
            onChange={(e) => onDraft({ ...draft, coupon_code: e.target.value })}
          />
          <TextField
            label="Reply"
            value={draft.response}
            onChange={(e) => onDraft({ ...draft, response: e.target.value })}
          />
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => onResolve("approved")}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => onResolve("rejected")}>
              Reject
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function SupportQueue() {
  const client = useQueryClient();
  const rows = useQuery({
    queryKey: ["admin-support-requests"],
    queryFn: () => admin.supportRequests(),
  });
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const respond = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "open" | "resolved" }) =>
      admin.respondSupportRequest(id, { response: drafts[id] || null, status }),
    onSuccess: () => {
      toast("Support request updated.", "success");
      void client.invalidateQueries({ queryKey: ["admin-support-requests"] });
      void client.invalidateQueries({ queryKey: ["admin-overview"] });
    },
    onError: (err) => toastError(err, "Could not update that ticket."),
  });

  return (
    <Panel className="flex flex-col gap-3 p-4">
      <SectionTitle>ODCC support</SectionTitle>
      {rows.isLoading ? (
        <Spinner label="Loading support requests" />
      ) : (rows.data ?? []).length === 0 ? (
        <p className="font-sans text-sm text-willow-soft">No support requests yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {(rows.data ?? []).map((row) => (
            <SupportRow
              key={row.id}
              row={row}
              draft={drafts[row.id] ?? ""}
              onDraft={(value) => setDrafts((current) => ({ ...current, [row.id]: value }))}
              busy={respond.isPending}
              onResolve={() => respond.mutate({ id: row.id, status: "resolved" })}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SupportRow({
  row,
  draft,
  onDraft,
  busy,
  onResolve,
}: {
  row: SupportRequestItem;
  draft: string;
  onDraft: (value: string) => void;
  busy: boolean;
  onResolve: () => void;
}) {
  return (
    <li className="rounded-[3px] border border-pitch-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-sans text-sm font-semibold text-chalk">{row.subject}</p>
          <p className="font-sans text-xs text-willow-soft">
            {row.user_name} · {row.user_email}
          </p>
          <p className="pt-1 font-sans text-sm text-chalk">{row.message}</p>
        </div>
        <Badge tone={row.status === "resolved" ? "live" : "quiet"}>{row.status}</Badge>
      </div>
      {row.response ? (
        <p className="pt-2 font-sans text-xs text-willow-soft">
          <span className="text-flip">Reply:</span> {row.response}
        </p>
      ) : null}
      {row.status === "open" ? (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="font-sans text-xs font-semibold tracking-wide text-willow-soft">Reply</span>
            <textarea
              value={draft}
              onChange={(e) => onDraft(e.target.value)}
              rows={3}
              className="w-full rounded-[3px] border border-chalk-deep bg-chalk px-3 py-2 font-sans text-sm text-ink"
            />
          </label>
          <Button size="sm" className="self-start" loading={busy} onClick={onResolve}>
            Resolve
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function ContentPanel() {
  const client = useQueryClient();
  const site = useQuery({ queryKey: ["admin-site-content"], queryFn: () => admin.siteContent() });
  const [whatsapp, setWhatsapp] = useState("");
  const [message, setMessage] = useState("");
  const [rate, setRate] = useState("110");
  const [faq, setFaq] = useState<FaqItem[]>([]);

  useEffect(() => {
    if (!site.data) return;
    setWhatsapp(site.data.whatsapp_number ?? "");
    setMessage(site.data.whatsapp_message ?? "");
    setRate(String(site.data.exchange_rate_bdt ?? ""));
    setFaq(site.data.faq?.length ? site.data.faq : [{ q: "", a: "" }]);
  }, [site.data]);

  const save = useMutation({
    mutationFn: () =>
      admin.saveSiteContent({
        whatsapp_number: whatsapp.trim(),
        whatsapp_message: message.trim(),
        exchange_rate_bdt: Number(rate) || 0,
        faq: faq.filter((item) => item.q.trim() && item.a.trim()),
      }),
    onSuccess: () => {
      toast("Site content saved.", "success");
      void client.invalidateQueries({ queryKey: ["admin-site-content"] });
      void client.invalidateQueries({ queryKey: ["site-content"] });
    },
    onError: (err) => toastError(err, "Could not save site content."),
  });

  if (site.isLoading) return <Spinner label="Loading site content" />;

  return (
    <Panel className="flex flex-col gap-4 p-4">
      <SectionTitle>WhatsApp, rate & FAQ</SectionTitle>
      <p className="font-sans text-xs text-willow-soft">
        The number appears on Pricing and Account. The FAQ is shown on those pages too. Display
        conversion only — wallet charges stay in USD.
      </p>
      <TextField
        label="WhatsApp number"
        value={whatsapp}
        onChange={(e) => setWhatsapp(e.target.value)}
        hint="Country code, no plus. Example: 8801XXXXXXXXX"
      />
      <TextField
        label="Default WhatsApp message"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />
      <TextField
        label="USD → BDT display rate"
        type="number"
        min={0}
        step="0.01"
        value={rate}
        onChange={(e) => setRate(e.target.value)}
      />
      <div className="flex flex-col gap-3">
        <SectionTitle>FAQ</SectionTitle>
        {faq.map((item, index) => (
          <div key={index} className="rounded-[3px] border border-pitch-line p-3">
            <TextField
              label={`Question ${index + 1}`}
              value={item.q}
              onChange={(e) =>
                setFaq((current) => current.map((row, i) => (i === index ? { ...row, q: e.target.value } : row)))
              }
            />
            <label className="mt-2 flex flex-col gap-1.5">
              <span className="font-sans text-xs font-semibold tracking-wide text-willow-soft">Answer</span>
              <textarea
                value={item.a}
                rows={3}
                onChange={(e) =>
                  setFaq((current) =>
                    current.map((row, i) => (i === index ? { ...row, a: e.target.value } : row)),
                  )
                }
                className="w-full rounded-[3px] border border-chalk-deep bg-chalk px-3 py-2 font-sans text-sm text-ink"
              />
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="mt-2"
              onClick={() => setFaq((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" className="self-start" onClick={() => setFaq((current) => [...current, { q: "", a: "" }])}>
          Add question
        </Button>
      </div>
      <Button className="self-start" loading={save.isPending} onClick={() => save.mutate()}>
        Save content
      </Button>
      {site.data?.whatsapp_link ? (
        <a href={site.data.whatsapp_link} target="_blank" rel="noreferrer" className="font-sans text-sm text-flip underline">
          Open WhatsApp preview
        </a>
      ) : null}
    </Panel>
  );
}

export function TutorialsPanel() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ["admin-tutorials"], queryFn: () => admin.tutorials() });
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [active, setActive] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      admin.createTutorial({
        title,
        url,
        description: description.trim() || null,
        sort_order: Number(sortOrder) || 0,
        is_active: active,
      }),
    onSuccess: () => {
      toast("Tutorial added to the broadcast page.", "success");
      setTitle("");
      setUrl("");
      setDescription("");
      void client.invalidateQueries({ queryKey: ["admin-tutorials"] });
      void client.invalidateQueries({ queryKey: ["tutorials"] });
    },
    onError: (err) => toastError(err, "Could not add that video."),
  });
  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      admin.updateTutorial(id, { is_active }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin-tutorials"] });
      void client.invalidateQueries({ queryKey: ["tutorials"] });
    },
    onError: (err) => toastError(err, "Could not update that video."),
  });
  const remove = useMutation({
    mutationFn: (id: string) => admin.deleteTutorial(id),
    onSuccess: () => {
      toast("Tutorial removed.", "success");
      void client.invalidateQueries({ queryKey: ["admin-tutorials"] });
      void client.invalidateQueries({ queryKey: ["tutorials"] });
    },
    onError: (err) => toastError(err, "Could not remove that video."),
  });

  return (
    <div className="flex flex-col gap-4">
      <Panel className="flex flex-col gap-3 p-4">
        <SectionTitle>Add YouTube tutorial</SectionTitle>
        <p className="font-sans text-xs text-willow-soft">
          Videos appear on the Broadcast page. Paste any YouTube watch, share, or embed link.
        </p>
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField label="YouTube URL" value={url} onChange={(e) => setUrl(e.target.value)} />
        <TextField
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <TextField
          label="Sort order"
          type="number"
          min={0}
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
        />
        <CheckField label="Show on the broadcast page" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <Button
          className="self-start"
          loading={create.isPending}
          disabled={!title.trim() || !url.trim()}
          onClick={() => create.mutate()}
        >
          Add tutorial
        </Button>
      </Panel>
      <Panel className="flex flex-col gap-3 p-4">
        <SectionTitle>Tutorials</SectionTitle>
        {list.isLoading ? (
          <Spinner label="Loading tutorials" />
        ) : (list.data ?? []).length === 0 ? (
          <p className="font-sans text-sm text-willow-soft">No tutorials yet.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {(list.data ?? []).map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-[3px] border border-pitch-line p-3">
                <div className="min-w-0">
                  <p className="font-sans text-sm font-semibold text-chalk">{row.title}</p>
                  <p className="font-sans text-xs text-willow-soft">{row.url}</p>
                  {row.description ? (
                    <p className="pt-1 font-sans text-xs text-willow">{row.description}</p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={row.is_active ? "live" : "quiet"}>{row.is_active ? "on" : "hidden"}</Badge>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => toggle.mutate({ id: row.id, is_active: !row.is_active })}
                  >
                    {row.is_active ? "Hide" : "Show"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove.mutate(row.id)}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link to="/broadcast" className="font-sans text-sm text-flip underline">
          View broadcast page
        </Link>
      </Panel>
    </div>
  );
}
