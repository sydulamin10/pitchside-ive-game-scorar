import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Badge, Panel, SectionTitle, Spinner } from "@/components/ui/Surface";
import { billing } from "@/lib/api/endpoints";
import type { BillingAccount } from "@/lib/api/types";
import { toast, toastError } from "@/store/toast";

function replaceAccount(list: BillingAccount[] | undefined, next: BillingAccount) {
  if (!list) return [next];
  return list.map((row) => (row.id === next.id ? next : row));
}

export function AccountControls({
  pendingOnly = false,
  unverifiedOnly = false,
}: {
  pendingOnly?: boolean;
  unverifiedOnly?: boolean;
}) {
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const users = useQuery({
    queryKey: [
      "billing-users",
      pendingOnly ? "pending" : unverifiedOnly ? "unverified" : "all",
      q,
    ],
    queryFn: () =>
      billing.users({
        q: q || undefined,
        pending: pendingOnly || undefined,
        unverified: unverifiedOnly || undefined,
        limit: 80,
      }),
  });

  const patchCaches = (next: BillingAccount) => {
    client.setQueriesData<BillingAccount[]>({ queryKey: ["billing-users"] }, (current) =>
      replaceAccount(current, next),
    );
    void client.invalidateQueries({ queryKey: ["billing-users"] });
    void client.invalidateQueries({ queryKey: ["admin-overview"] });
    void client.invalidateQueries({ queryKey: ["billing-payments"] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => billing.setApproval(id, on),
    onSuccess: (row) => {
      toast(row.is_approved ? "Account approved. They can log in now." : "Account turned off.", "success");
      patchCaches(row);
    },
    onError: (err) => toastError(err, "Could not update approval."),
  });

  const active = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => billing.setActive(id, on),
    onSuccess: (row) => {
      toast(row.is_active ? "Account activated." : "Account suspended.", "success");
      patchCaches(row);
    },
    onError: (err) => toastError(err, "Could not update account status."),
  });

  const verify = useMutation({
    mutationFn: (id: string) => billing.markVerified(id),
    onSuccess: (row) => {
      toast(`${row.display_name} is marked verified.`, "success");
      patchCaches(row);
    },
    onError: (err) => toastError(err, "Could not mark verified."),
  });

  const resend = useMutation({
    mutationFn: (id: string) => billing.resendVerification(id),
    onSuccess: (row) => toast(row.message, "success"),
    onError: (err) => toastError(err, "Could not send the verification email."),
  });

  const credits = useMutation({
    mutationFn: ({ id, amount, mode }: { id: string; amount: number; mode: "add" | "set" }) =>
      billing.grantCredits(id, { credits: amount, mode }),
    onSuccess: (row, vars) => {
      toast(
        vars.mode === "set"
          ? `Live credits set to ${row.live_credits}.`
          : `${row.display_name} now has ${row.live_credits} live credit(s).`,
        "success",
      );
      patchCaches(row);
    },
    onError: (err) => toastError(err, "Could not update live credits."),
  });

  if (users.isLoading) return <Spinner label="Loading accounts" />;
  const rows = users.data ?? [];

  return (
    <Panel className="p-5">
      <SectionTitle>
        {pendingOnly
          ? "Waiting for approval"
          : unverifiedOnly
            ? "Waiting for email verification"
            : "Users"}
      </SectionTitle>
      <p className="mt-2 font-sans text-xs text-willow-soft">
        Email verification, approval, suspend, and live credits. Admins stay verified and unlimited.
      </p>
      {!pendingOnly && !unverifiedOnly ? (
        <TextField
          className="mt-3 max-w-sm"
          label="Search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name or email"
        />
      ) : null}
      {rows.length === 0 ? (
        <p className="mt-3 font-sans text-sm text-willow-soft">
          {pendingOnly
            ? "No new accounts are waiting."
            : unverifiedOnly
              ? "Every listed account has confirmed email."
              : "No accounts match."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left font-sans text-sm">
            <thead className="text-willow-soft">
              <tr>
                <th className="py-2 font-semibold">Account</th>
                <th className="py-2 font-semibold">Email</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold">Live credits</th>
                <th className="py-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AccountRow
                  key={row.id}
                  row={row}
                  busy={
                    (toggle.isPending && toggle.variables?.id === row.id) ||
                    (credits.isPending && credits.variables?.id === row.id) ||
                    (active.isPending && active.variables?.id === row.id) ||
                    (verify.isPending && verify.variables === row.id) ||
                    (resend.isPending && resend.variables === row.id)
                  }
                  onApprove={(on) => toggle.mutate({ id: row.id, on })}
                  onActive={(on) => active.mutate({ id: row.id, on })}
                  onVerify={() => verify.mutate(row.id)}
                  onResend={() => resend.mutate(row.id)}
                  onCredits={(amount, mode) => credits.mutate({ id: row.id, amount, mode })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function AccountRow({
  row,
  busy,
  onApprove,
  onActive,
  onVerify,
  onResend,
  onCredits,
}: {
  row: BillingAccount;
  busy: boolean;
  onApprove: (on: boolean) => void;
  onActive: (on: boolean) => void;
  onVerify: () => void;
  onResend: () => void;
  onCredits: (amount: number, mode: "add" | "set") => void;
}) {
  const [amount, setAmount] = useState("1");
  const isAdmin = row.role === "admin";
  const verified = Boolean(row.is_email_verified) || isAdmin;
  const n = Math.max(0, Number.parseInt(amount, 10) || 0);

  return (
    <tr className="border-t border-pitch-line align-top">
      <td className="py-3 pr-3">
        <p className="font-semibold">{row.display_name}</p>
        <p className="text-xs text-willow-soft">{isAdmin ? "Administrator" : "User"}</p>
        {(row.team_names ?? []).length > 0 ? (
          <p className="text-xs text-willow-soft">{row.team_names?.join(", ")}</p>
        ) : null}
        {row.pro_until ? (
          <p className="text-xs text-willow-soft">Pro until {new Date(row.pro_until).toLocaleDateString()}</p>
        ) : null}
      </td>
      <td className="py-3 pr-3">
        <p className="text-chalk">{row.email}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {verified ? <Badge tone="live">Verified</Badge> : <Badge tone="quiet">Unverified</Badge>}
        </div>
      </td>
      <td className="py-3 pr-3">
        <div className="flex flex-col gap-1">
          {row.is_active ? <Badge tone="live">Active</Badge> : <Badge tone="wicket">Suspended</Badge>}
          {row.is_approved ? <Badge tone="neutral">Approved</Badge> : <Badge tone="quiet">Pending</Badge>}
        </div>
      </td>
      <td className="py-3 pr-3">
        <p className="tabular font-semibold">{isAdmin ? "Unlimited" : row.live_credits}</p>
        {!isAdmin ? (
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <TextField
              className="w-20"
              label="Credits"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button size="sm" type="button" disabled={n < 1 || busy} loading={busy} onClick={() => onCredits(n, "add")}>
              Add
            </Button>
          </div>
        ) : (
          <p className="text-xs text-willow-soft">Not needed</p>
        )}
      </td>
      <td className="py-3">
        {isAdmin ? (
          <span className="text-xs text-willow-soft">Always on</span>
        ) : (
          <div className="flex flex-wrap gap-2">
            {!verified ? (
              <>
                <Button size="sm" type="button" disabled={busy} onClick={onVerify}>
                  Mark verified
                </Button>
                <Button size="sm" type="button" variant="secondary" disabled={busy} onClick={onResend}>
                  Resend email
                </Button>
              </>
            ) : null}
            <Button
              size="sm"
              type="button"
              variant={row.is_approved ? "secondary" : "primary"}
              disabled={row.is_approved || busy}
              onClick={() => onApprove(true)}
            >
              Approve
            </Button>
            <Button
              size="sm"
              type="button"
              variant={row.is_active ? "danger" : "primary"}
              disabled={busy}
              onClick={() => onActive(!row.is_active)}
            >
              {row.is_active ? "Suspend" : "Activate"}
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}
