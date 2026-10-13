/**
 * Account dashboard.
 *
 * Mirrors the ODCC design: a profile header, Match Credit + Balance (with
 * top-up and a converted BDT figure), the Pro plan card with quick links,
 * a coupon request, and an ODCC support request. Security controls (password,
 * sessions, install) live below, unchanged in behaviour.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Crown,
  FileText,
  Headphones,
  Receipt,
  Ticket,
  Trophy,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/Button";
import { SelectField, TextField } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Badge, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { InstallAppButton } from "@/components/layout/InstallAppButton";
import { ApiError } from "@/lib/api/client";
import { account, auth, content } from "@/lib/api/endpoints";
import type { BillingPayment, BillingPlanId } from "@/lib/api/types";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { toast, toastError } from "@/store/toast";

const PLAN_PRICE: Record<Exclude<BillingPlanId, "free">, string> = {
  live_match: "$1.20 / match",
  pro: "$9.99 / month",
  tournament: "$15.99 / tournament",
};

const PLAN_NAME: Record<BillingPlanId, string> = {
  free: "Community Scoring",
  live_match: "Live Broadcast",
  pro: "ODCC LIVE Pro",
  tournament: "Tournament Package",
};

function initialsOf(name?: string | null): string {
  if (!name) return "OD";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "OD";
}

export default function Account() {
  const queryClient = useQueryClient();
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [pwError, setPwError] = useState<string | undefined>();
  const [modal, setModal] = useState<
    null | "topup" | "purchase" | "payments" | "coupon" | "support"
  >(null);

  const overview = useQuery({ queryKey: ["account-overview"], queryFn: () => account.overview() });
  const site = useQuery({ queryKey: ["site-content"], queryFn: () => content.site() });
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => auth.sessions() });

  const changePassword = useMutation({
    mutationFn: () => auth.changePassword({ current_password: current, new_password: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setPwError(undefined);
      toast("Password changed. Other devices have been signed out.", "success");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (cause) => {
      if (cause instanceof ApiError) setPwError(cause.message);
      else toastError(cause, "That password could not be changed.");
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => auth.revokeSession(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
      toast("That device has been signed out.", "success");
    },
    onError: (cause) => toastError(cause, "That session could not be revoked."),
  });

  const data = overview.data;
  const isAdmin = user?.role === "admin";

  return (
    <div className="flex flex-col gap-5">
      {/* Profile header */}
      <div className="overflow-hidden rounded-[6px] border border-sky-500/30 bg-gradient-to-r from-sky-900 via-sky-800 to-sky-700">
        <div className="flex items-center justify-between gap-4 p-5">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 font-sans text-xl font-bold text-white">
              {initialsOf(user?.display_name)}
            </div>
            <div className="min-w-0">
              <h1 className="truncate font-sans text-xl font-semibold text-white">
                {user?.display_name}
              </h1>
              <p className="truncate font-sans text-sm text-sky-100/90">{user?.email}</p>
            </div>
          </div>
          {isAdmin ? <Badge tone="live">Admin</Badge> : null}
        </div>
      </div>

      {/* Credit + Balance */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Panel className="flex items-center gap-4 border-emerald-500/30 p-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
            <Ticket className="size-6" />
          </div>
          <div>
            <SectionTitle>Match Credit</SectionTitle>
            <p className="mt-0.5 font-mono text-2xl font-black text-chalk">
              {isAdmin ? "∞" : (data?.live_credits ?? "—")}
            </p>
            <p className="font-sans text-xs text-willow-soft">
              {isAdmin ? "unlimited (admin)" : "matches available"}
            </p>
          </div>
        </Panel>

        <Panel className="flex flex-col gap-3 border-sky-500/30 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-sky-500/20 text-sky-300">
                <Wallet className="size-6" />
              </div>
              <div>
                <SectionTitle>Balance</SectionTitle>
                <p className="mt-0.5 font-mono text-2xl font-black text-chalk">
                  ${data?.balance ?? "0.00"}
                </p>
                {data?.converted_balance_bdt ? (
                  <p className="font-sans text-xs text-willow-soft">
                    ৳ {data.converted_balance_bdt} (converted)
                  </p>
                ) : null}
              </div>
            </div>
            <Button size="sm" onClick={() => setModal("topup")}>
              + Add Top-up
            </Button>
          </div>
          {data && data.pending_topups > 0 ? (
            <p className="font-sans text-xs text-amber-300">
              {data.pending_topups} top-up{data.pending_topups === 1 ? "" : "s"} waiting for admin
              confirmation.
            </p>
          ) : null}
        </Panel>
      </div>

      {/* Pro plan + quick links */}
      <Panel className="flex flex-col border-violet-500/30">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-violet-300">
              <Crown className="size-5" />
            </div>
            <div>
              <p className="font-sans text-sm font-semibold text-chalk">
                {isAdmin
                  ? "Admin — unlimited broadcasting"
                  : data?.pro_until
                    ? "Pro Plan · Active"
                    : "Go Pro for unlimited live"}
              </p>
              <p className="font-sans text-xs text-willow-soft">
                {data?.pro_until
                  ? `Valid till ${new Date(data.pro_until).toLocaleDateString()}`
                  : isAdmin
                    ? "No limits on this account."
                    : "Scoring is free. One credit per live match, or go Pro."}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            {data?.pro_until ? (
              <Badge tone="live">Active</Badge>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setModal("purchase")}>
                View plans
              </Button>
            )}
          </div>
        </div>
        <Seam />
        <div className="grid grid-cols-2 gap-px bg-pitch-line sm:grid-cols-4">
          <QuickLink icon={<Receipt className="size-5" />} label="Buy / Subscribe" onClick={() => setModal("purchase")} />
          <QuickLink icon={<Trophy className="size-5" />} label="Tournament Pack" onClick={() => setModal("purchase")} />
          <QuickLink icon={<CreditCard className="size-5" />} label="Payment History" onClick={() => setModal("payments")} />
          <QuickLink icon={<FileText className="size-5" />} label="Invoices" onClick={() => setModal("payments")} />
        </div>
      </Panel>

      {/* Coupon request */}
      <button
        type="button"
        onClick={() => setModal("coupon")}
        className="tap flex items-center justify-between gap-3 rounded-[6px] border border-amber-500/30 bg-amber-500/10 p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-amber-500/25 text-amber-300">
            <Ticket className="size-5" />
          </div>
          <div>
            <p className="font-sans text-sm font-semibold text-chalk">Coupon Request</p>
            <p className="font-sans text-xs text-willow-soft">
              Request a coupon and get special benefits.
            </p>
          </div>
        </div>
        <span aria-hidden className="text-willow-soft">›</span>
      </button>

      {/* Support request */}
      <button
        type="button"
        onClick={() => setModal("support")}
        className="tap flex items-center justify-between gap-3 rounded-[6px] border border-sky-500/30 bg-sky-500/10 p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-sky-500/25 text-sky-300">
            <Headphones className="size-5" />
          </div>
          <div>
            <p className="font-sans text-sm font-semibold text-chalk">ODCC Support Request</p>
            <p className="font-sans text-xs text-willow-soft">
              Need help? Send your message to our admin panel.
            </p>
          </div>
        </div>
        <span aria-hidden className="text-willow-soft">›</span>
      </button>

      {site.data?.whatsapp_link ? (
        <a
          href={site.data.whatsapp_link}
          target="_blank"
          rel="noreferrer"
          className="tap flex items-center justify-between gap-3 rounded-[6px] border border-emerald-500/30 bg-emerald-500/10 p-4"
        >
          <div>
            <p className="font-sans text-sm font-semibold text-chalk">WhatsApp</p>
            <p className="font-sans text-xs text-willow-soft">Message ODCC LIVE on WhatsApp.</p>
          </div>
          <span aria-hidden className="text-willow-soft">›</span>
        </a>
      ) : null}

      {(site.data?.faq ?? []).length > 0 ? (
        <Panel className="flex flex-col p-4">
          <SectionTitle>FAQ</SectionTitle>
          <dl className="mt-3 flex flex-col">
            {site.data?.faq.map((item, index) => (
              <div key={`${item.q}-${index}`}>
                {index > 0 ? <Seam /> : null}
                <div className="py-3">
                  <dt className="font-sans text-sm font-semibold text-chalk">{item.q}</dt>
                  <dd className="mt-1 font-sans text-sm text-willow-soft">{item.a}</dd>
                </div>
              </div>
            ))}
          </dl>
        </Panel>
      ) : null}

      {/* ------------------------------------------------------- security area */}
      <Panel className="flex flex-col">
        <div className="px-4 py-3">
          <SectionTitle>Install on this device</SectionTitle>
          <p className="pt-1 font-sans text-xs text-willow">
            Add ODCC LIVE to your phone home screen or PC Start menu — opens like an app.
          </p>
        </div>
        <Seam />
        <div className="px-4 py-4">
          <InstallAppButton size="md" label="Install app" />
        </div>
      </Panel>

      <Panel className="flex flex-col">
        <div className="px-4 py-3">
          <SectionTitle>Change your password</SectionTitle>
        </div>
        <Seam />
        <form
          className="flex flex-col gap-3 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            changePassword.mutate();
          }}
        >
          <TextField
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            required
            onChange={(event) => setCurrent(event.target.value)}
          />
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            value={next}
            required
            minLength={10}
            error={pwError}
            hint="At least ten characters."
            onChange={(event) => setNext(event.target.value)}
          />
          <Button
            type="submit"
            className="self-start"
            loading={changePassword.isPending}
            disabled={!current || next.length < 10}
          >
            Change password
          </Button>
        </form>
      </Panel>

      <Panel className="flex flex-col">
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <SectionTitle>Signed-in devices</SectionTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void auth
                .logoutEverywhere()
                .then(() => {
                  toast("Signed out everywhere.", "success");
                  void logout();
                })
                .catch((cause: unknown) => toastError(cause))
            }
          >
            Sign out everywhere
          </Button>
        </div>
        <Seam />
        {sessions.isLoading ? (
          <Spinner label="Loading sessions" />
        ) : (
          <ul className="flex flex-col">
            {(sessions.data ?? []).map((session, index) => (
              <li key={session.id}>
                {index > 0 && <Seam />}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <span className="font-sans text-sm text-chalk">
                    {session.user_agent ?? "Unknown device"}
                    <span className="block text-xs text-willow">
                      {session.ip_address ?? "no address"} · started{" "}
                      {relativeTime(new Date(session.created_at).getTime())} · expires{" "}
                      {formatDateTime(session.expires_at)}
                    </span>
                  </span>
                  {session.is_current ? (
                    <Badge tone="live">This device</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(session.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel className="p-4">
        <SectionTitle>This device</SectionTitle>
        <p className="pt-2 font-sans text-sm text-willow-soft">
          Balls scored offline are stored on this device until they sync.
        </p>
        <Button variant="ghost" className="mt-3" onClick={() => void logout()}>
          Sign out of this device
        </Button>
      </Panel>

      <TopupModal open={modal === "topup"} onClose={() => setModal(null)} />
      <PurchaseModal
        open={modal === "purchase"}
        onClose={() => setModal(null)}
        balance={data?.balance ?? "0.00"}
      />
      <PaymentsModal open={modal === "payments"} onClose={() => setModal(null)} />
      <CouponRequestModal open={modal === "coupon"} onClose={() => setModal(null)} />
      <SupportRequestModal open={modal === "support"} onClose={() => setModal(null)} />
    </div>
  );
}

function QuickLink({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="tap flex flex-col items-center gap-1.5 bg-pitch-deep px-2 py-4 text-willow-soft transition-colors hover:text-flip"
    >
      <span className="text-violet-300">{icon}</span>
      <span className="font-sans text-xs font-medium text-chalk">{label}</span>
    </button>
  );
}

// ----------------------------------------------------------------- top-up modal

function TopupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bkash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      account.createTopup({
        amount,
        method,
        reference: reference.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast("Top-up request sent. An admin will confirm it shortly.", "success");
      setAmount("");
      setReference("");
      setNote("");
      void queryClient.invalidateQueries({ queryKey: ["account-overview"] });
      onClose();
    },
    onError: (cause) => toastError(cause, "Could not send the top-up request."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Top-up"
      description="Send your payment, then submit the amount and reference. An admin confirms it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!amount || Number(amount) <= 0}
            onClick={() => mutation.mutate()}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="Amount (USD)"
          type="number"
          min={1}
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-autofocus
          required
        />
        <SelectField label="Payment method" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="bkash">bKash</option>
          <option value="nagad">Nagad</option>
          <option value="rocket">Rocket</option>
          <option value="bank">Bank transfer</option>
          <option value="manual">Other</option>
        </SelectField>
        <TextField
          label="Payment reference / sender number"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          hint="e.g. the bKash transaction id or the number you paid from."
        />
        <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------- purchase modal

function PurchaseModal({
  open,
  onClose,
  balance,
}: {
  open: boolean;
  onClose: () => void;
  balance: string;
}) {
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<Exclude<BillingPlanId, "free">>("live_match");
  const [quantity, setQuantity] = useState("1");
  const [tournamentId, setTournamentId] = useState("");
  const [coupon, setCoupon] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      account.purchase({
        plan,
        quantity: Number(quantity) || 1,
        tournament_id: plan === "tournament" ? tournamentId.trim() || null : null,
        coupon_code: coupon.trim() || null,
      }),
    onSuccess: () => {
      toast("Purchase complete. Your access is updated.", "success");
      void queryClient.invalidateQueries({ queryKey: ["account-overview"] });
      void queryClient.invalidateQueries({ queryKey: ["account-payments"] });
      void queryClient.invalidateQueries({ queryKey: ["billing-entitlement"] });
      onClose();
    },
    onError: (cause) => toastError(cause, "Could not complete the purchase."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Buy with balance"
      description={`Pay from your wallet balance ($${balance}). Top up first if it is not enough.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={plan === "tournament" && !tournamentId.trim()}
            onClick={() => mutation.mutate()}
          >
            Pay from balance
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <SelectField
          label="Plan"
          value={plan}
          onChange={(e) => setPlan(e.target.value as Exclude<BillingPlanId, "free">)}
        >
          <option value="live_match">{PLAN_NAME.live_match} · {PLAN_PRICE.live_match}</option>
          <option value="pro">{PLAN_NAME.pro} · {PLAN_PRICE.pro}</option>
          <option value="tournament">{PLAN_NAME.tournament} · {PLAN_PRICE.tournament}</option>
        </SelectField>
        {plan !== "tournament" ? (
          <TextField
            label={plan === "pro" ? "Months" : "Matches"}
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        ) : (
          <TextField
            label="Tournament id"
            value={tournamentId}
            onChange={(e) => setTournamentId(e.target.value)}
            hint="Paste the tournament UUID this package covers."
          />
        )}
        <TextField label="Coupon code (optional)" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
        <p className="font-sans text-xs text-willow-soft">
          You can also buy credits any time from the Pricing page.
        </p>
      </div>
    </Modal>
  );
}

// -------------------------------------------------------------- payments modal

function PaymentsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const payments = useQuery({
    queryKey: ["account-payments"],
    queryFn: () => account.payments({ limit: 50 }),
    enabled: open,
  });

  return (
    <Modal open={open} onClose={onClose} title="Payment history & invoices" wide>
      {payments.isLoading ? (
        <Spinner label="Loading payments" />
      ) : (payments.data ?? []).length === 0 ? (
        <p className="py-6 text-center font-sans text-sm text-willow-soft">No payments yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left font-sans text-sm">
            <thead className="text-willow-soft">
              <tr>
                <th className="py-2 font-semibold">When</th>
                <th className="py-2 font-semibold">Plan</th>
                <th className="py-2 font-semibold">Paid</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {(payments.data ?? []).map((row: BillingPayment) => (
                <tr key={row.id} className="border-t border-pitch-line">
                  <td className="py-2 text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="py-2">{PLAN_NAME[row.plan]}</td>
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
        </div>
      )}
    </Modal>
  );
}

// -------------------------------------------------------- coupon request modal

function CouponRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState("");
  const mine = useQuery({
    queryKey: ["account-coupon-requests"],
    queryFn: () => account.couponRequests(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => account.createCouponRequest({ message: message.trim() || null }),
    onSuccess: () => {
      toast("Coupon request sent to the admin.", "success");
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: ["account-coupon-requests"] });
    },
    onError: (cause) => toastError(cause, "Could not send the request."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Coupon Request"
      description="Tell us what you need. The admin reviews it and issues a code if approved."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-xs font-semibold tracking-wide text-willow-soft">
            Message
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            data-autofocus
            placeholder="e.g. I run a club league and need a discount for 5 live matches."
            className="w-full rounded-[3px] border border-chalk-deep bg-chalk px-3 py-2 font-sans text-sm text-ink"
          />
        </label>
        {(mine.data ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            <SectionTitle>Your requests</SectionTitle>
            {(mine.data ?? []).map((row) => (
              <div key={row.id} className="rounded-[3px] border border-pitch-line p-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    tone={row.status === "approved" ? "live" : row.status === "rejected" ? "wicket" : "quiet"}
                  >
                    {row.status}
                  </Badge>
                  <span className="font-sans text-[11px] text-willow-soft">
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                </div>
                {row.coupon_code ? (
                  <p className="pt-1 font-mono text-sm font-bold text-flip">{row.coupon_code}</p>
                ) : null}
                {row.response ? (
                  <p className="pt-1 font-sans text-xs text-willow-soft">{row.response}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------- support request modal

function SupportRequestModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const mine = useQuery({
    queryKey: ["account-support-requests"],
    queryFn: () => account.supportRequests(),
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: () => account.createSupportRequest({ subject, message }),
    onSuccess: () => {
      toast("Support request sent. We will reply soon.", "success");
      setSubject("");
      setMessage("");
      void queryClient.invalidateQueries({ queryKey: ["account-support-requests"] });
    },
    onError: (cause) => toastError(cause, "Could not send the request."),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="ODCC Support Request"
      description="Send a message straight to the admin panel."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={subject.trim().length < 2 || message.trim().length < 2}
            onClick={() => mutation.mutate()}
          >
            Send request
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          data-autofocus
          required
        />
        <label className="flex flex-col gap-1.5">
          <span className="font-sans text-xs font-semibold tracking-wide text-willow-soft">
            Message
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Describe what you need help with."
            className="w-full rounded-[3px] border border-chalk-deep bg-chalk px-3 py-2 font-sans text-sm text-ink"
          />
        </label>
        {(mine.data ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            <SectionTitle>Your requests</SectionTitle>
            {(mine.data ?? []).map((row) => (
              <div key={row.id} className="rounded-[3px] border border-pitch-line p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-sm text-chalk">{row.subject}</span>
                  <Badge tone={row.status === "resolved" ? "live" : "quiet"}>{row.status}</Badge>
                </div>
                {row.response ? (
                  <p className="pt-1 font-sans text-xs text-willow-soft">
                    <span className="text-flip">Reply:</span> {row.response}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
