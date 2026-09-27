import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { AccountControls } from "@/components/admin/AccountControls";
import { BrandLogo } from "@/components/layout/Brand";
import { Button } from "@/components/ui/Button";
import { CheckField, SelectField, TextField } from "@/components/ui/Field";
import { Badge, Panel, SectionTitle, Spinner } from "@/components/ui/Surface";
import { billing } from "@/lib/api/endpoints";
import type { BillingPlanId } from "@/lib/api/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { toast, toastError } from "@/store/toast";

type Tab = "approvals" | "accounts" | "payment" | "ledger" | "coupons";

const TABS: Array<[Tab, string]> = [
  ["approvals", "Approvals"],
  ["accounts", "Accounts"],
  ["payment", "Record payment"],
  ["ledger", "Transactions"],
  ["coupons", "Coupons"],
];

const PLAN_LABEL: Record<BillingPlanId, string> = {
  free: "Community Scoring",
  live_match: "Live Broadcast · $1.20 / match",
  pro: "ODCC LIVE Pro · $9.99 / month",
  tournament: "Tournament Package · $15.99",
};

export default function BillingAdmin() {
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);
  const [tab, setTab] = useState<Tab>("approvals");

  return (
    <div className="min-h-dvh bg-pitch text-chalk">
      <header className="border-b border-pitch-line bg-pitch-deep">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <BrandLogo />
            <div>
              <p className="font-sans text-[0.62rem] font-bold tracking-[0.16em] text-willow-soft uppercase">
                ODCC LIVE
              </p>
              <h1 className="font-sans text-lg font-semibold">Billing admin</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-sans text-xs text-willow-soft">{user?.email}</span>
            <Link to="/app">
              <Button size="sm" variant="ghost">
                Scoring
              </Button>
            </Link>
            <Link to="/app/admin">
              <Button size="sm" variant="secondary">
                Admin Portal
              </Button>
            </Link>
            <Button size="sm" variant="primary">
              Billing Portal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void logout()}>
              Sign out
            </Button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "rounded-[3px] px-3 py-1.5 font-sans text-sm",
                tab === id ? "bg-pitch-line text-flip" : "text-willow-soft hover:text-chalk",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <p className="font-sans text-sm text-willow-soft">
          Plans follow the public pricing page: scoring is free; live broadcast is $1.20 per match
          (member $0.90), Pro is $9.99/month unlimited, tournament package is $15.99. Coupons can
          cut any amount.
        </p>
        {tab === "approvals" ? <AccountControls pendingOnly /> : null}
        {tab === "accounts" ? <AccountControls /> : null}
        {tab === "payment" ? <PaymentPanel /> : null}
        {tab === "ledger" ? <LedgerPanel /> : null}
        {tab === "coupons" ? <CouponsPanel /> : null}
      </main>
    </div>
  );
}

function PaymentPanel() {
  const client = useQueryClient();
  const [userId, setUserId] = useState("");
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState<BillingPlanId>("live_match");
  const [quantity, setQuantity] = useState("1");
  const [member, setMember] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [tournamentId, setTournamentId] = useState("");
  const [note, setNote] = useState("");
  const [paidOverride, setPaidOverride] = useState("");

  const users = useQuery({
    queryKey: ["billing-users", "pay", q],
    queryFn: () => billing.users({ q: q || undefined, limit: 20 }),
  });
  const quote = useQuery({
    queryKey: ["billing-quote", plan, quantity, member, coupon],
    queryFn: () =>
      billing.quote({
        plan,
        quantity: Number(quantity) || 1,
        member_discount: member,
        coupon_code: coupon.trim() || null,
      }),
    enabled: plan !== "free",
  });

  const save = useMutation({
    mutationFn: () =>
      billing.recordPayment({
        user_id: userId,
        plan,
        quantity: Number(quantity) || 1,
        member_discount: member,
        coupon_code: coupon.trim() || null,
        tournament_id: tournamentId.trim() || null,
        paid_amount: paidOverride.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast("Payment recorded. Live access is updated.", "success");
      void client.invalidateQueries({ queryKey: ["billing-users"] });
      void client.invalidateQueries({ queryKey: ["billing-payments"] });
    },
    onError: (err) => toastError(err, "Could not record payment."),
  });

  const picked = useMemo(() => (users.data ?? []).find((u) => u.id === userId), [users.data, userId]);

  return (
    <Panel className="p-5">
      <SectionTitle>Record a payment</SectionTitle>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <TextField label="Find account" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" />
        <SelectField label="Account" value={userId} onChange={(e) => setUserId(e.target.value)} required>
          <option value="">Select…</option>
          {(users.data ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.display_name} · {row.email}
            </option>
          ))}
        </SelectField>
        <SelectField label="Plan" value={plan} onChange={(e) => setPlan(e.target.value as BillingPlanId)}>
          <option value="live_match">{PLAN_LABEL.live_match}</option>
          <option value="pro">{PLAN_LABEL.pro}</option>
          <option value="tournament">{PLAN_LABEL.tournament}</option>
        </SelectField>
        <TextField
          label={plan === "pro" ? "Months" : plan === "live_match" ? "Matches" : "Quantity"}
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        {plan === "tournament" ? (
          <TextField
            label="Tournament id"
            value={tournamentId}
            onChange={(e) => setTournamentId(e.target.value)}
            hint="UUID of the tournament this package covers."
          />
        ) : null}
        <TextField label="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
        <TextField
          label="Paid amount override (USD)"
          value={paidOverride}
          onChange={(e) => setPaidOverride(e.target.value)}
          hint="Leave blank to use the quoted price."
        />
        <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <CheckField
        className="mt-3"
        label="ODCC community member 25% discount"
        checked={member}
        onChange={(e) => setMember(e.target.checked)}
      />
      {quote.data ? (
        <p className="mt-3 font-sans text-sm text-chalk">
          Quote: ${quote.data.list_amount} list − ${quote.data.discount_amount} discount ={" "}
          <strong>${quote.data.paid_amount}</strong>
          {quote.data.live_credits ? ` · ${quote.data.live_credits} live match credit(s)` : ""}
          {quote.data.period_days ? ` · ${quote.data.period_days} days Pro` : ""}
        </p>
      ) : null}
      {picked ? (
        <p className="mt-1 font-sans text-xs text-willow-soft">
          {picked.display_name} currently has {picked.live_credits} live credit(s)
          {picked.pro_until ? ` · Pro until ${new Date(picked.pro_until).toLocaleDateString()}` : ""}.
        </p>
      ) : null}
      <div className="mt-4">
        <Button disabled={!userId} loading={save.isPending} onClick={() => save.mutate()}>
          Save transaction
        </Button>
      </div>
    </Panel>
  );
}

function LedgerPanel() {
  const client = useQueryClient();
  const payments = useQuery({
    queryKey: ["billing-payments"],
    queryFn: () => billing.payments({ limit: 80 }),
  });
  const voidPay = useMutation({
    mutationFn: (id: string) => billing.voidPayment(id),
    onSuccess: () => {
      toast("Payment voided.", "success");
      void client.invalidateQueries({ queryKey: ["billing-payments"] });
      void client.invalidateQueries({ queryKey: ["billing-users"] });
    },
    onError: (err) => toastError(err, "Could not void payment."),
  });

  if (payments.isLoading) return <Spinner label="Loading transactions" />;
  return (
    <Panel className="p-5">
      <SectionTitle>Transactions</SectionTitle>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[48rem] text-left font-sans text-sm">
          <thead className="text-willow-soft">
            <tr>
              <th className="py-2 font-semibold">When</th>
              <th className="py-2 font-semibold">Account</th>
              <th className="py-2 font-semibold">Plan</th>
              <th className="py-2 font-semibold">Paid</th>
              <th className="py-2 font-semibold">Coupon</th>
              <th className="py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {(payments.data ?? []).map((row) => (
              <tr key={row.id} className="border-t border-pitch-line">
                <td className="py-2 text-xs">{new Date(row.created_at).toLocaleString()}</td>
                <td className="py-2">
                  {row.user_name}
                  <span className="block text-xs text-willow-soft">{row.user_email}</span>
                </td>
                <td className="py-2">{row.plan.replace("_", " ")}</td>
                <td className="py-2 tabular">
                  ${row.paid_amount} {row.currency}
                </td>
                <td className="py-2">{row.coupon_code ?? "—"}</td>
                <td className="py-2">
                  <Badge tone={row.status === "paid" ? "live" : "quiet"}>{row.status}</Badge>
                  {row.status === "paid" ? (
                    <Button
                      className="ml-2"
                      size="sm"
                      variant="ghost"
                      onClick={() => voidPay.mutate(row.id)}
                    >
                      Void
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function CouponsPanel() {
  const client = useQueryClient();
  const coupons = useQuery({ queryKey: ["billing-coupons"], queryFn: () => billing.coupons() });
  const [code, setCode] = useState("");
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("25");
  const [maxUses, setMaxUses] = useState("");
  const [note, setNote] = useState("");

  const create = useMutation({
    mutationFn: () =>
      billing.createCoupon({
        code,
        discount_type: type,
        discount_value: value,
        max_uses: maxUses.trim() ? Number(maxUses) : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      toast("Coupon saved.", "success");
      setCode("");
      void client.invalidateQueries({ queryKey: ["billing-coupons"] });
    },
    onError: (err) => toastError(err, "Could not save coupon."),
  });
  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => billing.updateCoupon(id, { is_active: on }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["billing-coupons"] }),
    onError: (err) => toastError(err, "Could not update coupon."),
  });

  return (
    <div className="flex flex-col gap-4">
      <Panel className="p-5">
        <SectionTitle>New coupon</SectionTitle>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <TextField label="Code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ODCC25" />
          <SelectField label="Type" value={type} onChange={(e) => setType(e.target.value as "percent" | "amount")}>
            <option value="percent">Percent</option>
            <option value="amount">Fixed USD amount</option>
          </SelectField>
          <TextField
            label={type === "percent" ? "Percent off" : "Amount off (USD)"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <TextField label="Max uses (optional)" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="mt-4">
          <Button disabled={!code.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create coupon
          </Button>
        </div>
      </Panel>
      <Panel className="p-5">
        <SectionTitle>Coupons</SectionTitle>
        {coupons.isLoading ? (
          <Spinner label="Loading coupons" />
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {(coupons.data ?? []).map((row) => (
              <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-pitch-line py-2">
                <div>
                  <p className="font-mono text-sm font-bold">{row.code}</p>
                  <p className="font-sans text-xs text-willow-soft">
                    {row.discount_type === "percent" ? `${row.discount_value}%` : `$${row.discount_value}`} off
                    {row.max_uses ? ` · ${row.used_count}/${row.max_uses} used` : ` · ${row.used_count} used`}
                    {row.note ? ` · ${row.note}` : ""}
                  </p>
                </div>
                <label className="flex items-center gap-2 font-sans text-xs">
                  <input
                    type="checkbox"
                    checked={row.is_active}
                    onChange={(e) => toggle.mutate({ id: row.id, on: e.target.checked })}
                  />
                  {row.is_active ? "On" : "Off"}
                </label>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
