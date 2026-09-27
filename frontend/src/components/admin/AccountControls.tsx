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

export function AccountControls({ pendingOnly = false }: { pendingOnly?: boolean }) {
  const client = useQueryClient();
  const [q, setQ] = useState("");
  const users = useQuery({
    queryKey: ["billing-users", pendingOnly ? "pending" : "all", q],
    queryFn: () =>
      billing.users({
        q: q || undefined,
        pending: pendingOnly || undefined,
        limit: 80,
      }),
  });

  const patchCaches = (next: BillingAccount) => {
    client.setQueriesData<BillingAccount[]>({ queryKey: ["billing-users"] }, (current) =>
      replaceAccount(current, next),
    );
    void client.invalidateQueries({ queryKey: ["billing-users"] });
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
      <SectionTitle>{pendingOnly ? "Waiting for approval" : "Accounts, approval and live credits"}</SectionTitle>
      <p className="mt-2 font-sans text-xs text-willow-soft">
        Approval on lets them log in. Live count is the credits you add, or a payment you record.
        Approval off kicks them out and they cannot go live.
      </p>
      {!pendingOnly ? (
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
          {pendingOnly ? "No new accounts are waiting." : "No accounts match."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[46rem] text-left font-sans text-sm">
            <thead className="text-willow-soft">
              <tr>
                <th className="py-2 font-semibold">Account</th>
                <th className="py-2 font-semibold">Live credits</th>
                <th className="py-2 font-semibold">Add / set</th>
                <th className="py-2 font-semibold">Approval</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AccountRow
                  key={row.id}
                  row={row}
                  busy={
                    (toggle.isPending && toggle.variables?.id === row.id) ||
                    (credits.isPending && credits.variables?.id === row.id)
                  }
                  onApprove={(on) => toggle.mutate({ id: row.id, on })}
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
  onCredits,
}: {
  row: BillingAccount;
  busy: boolean;
  onApprove: (on: boolean) => void;
  onCredits: (amount: number, mode: "add" | "set") => void;
}) {
  const [amount, setAmount] = useState("1");
  const isAdmin = row.role === "admin";
  const n = Math.max(0, Number.parseInt(amount, 10) || 0);

  return (
    <tr className="border-t border-pitch-line align-top">
      <td className="py-3">
        <p className="font-semibold">{row.display_name}</p>
        <p className="text-xs text-willow-soft">{row.email}</p>
        {row.pro_until ? (
          <p className="text-xs text-willow-soft">Pro until {new Date(row.pro_until).toLocaleDateString()}</p>
        ) : null}
      </td>
      <td className="py-3">
        <p className="tabular font-semibold">{isAdmin ? "Unlimited" : row.live_credits}</p>
        <p className="text-xs text-willow-soft">
          {isAdmin ? "Admin" : row.can_go_live ? "Can go live" : "Cannot go live"}
        </p>
      </td>
      <td className="py-3">
        {isAdmin ? (
          <span className="text-xs text-willow-soft">Not needed</span>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <TextField
              className="w-24"
              label="Credits"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <Button
              size="sm"
              type="button"
              disabled={n < 1 || busy}
              loading={busy}
              onClick={() => onCredits(n, "add")}
            >
              Add
            </Button>
            <Button
              size="sm"
              type="button"
              variant="secondary"
              disabled={busy}
              loading={busy}
              onClick={() => onCredits(n, "set")}
            >
              Set
            </Button>
          </div>
        )}
      </td>
      <td className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          {row.is_approved ? <Badge tone="live">On</Badge> : <Badge tone="quiet">Off</Badge>}
          {isAdmin ? (
            <span className="text-xs text-willow-soft">Always on</span>
          ) : (
            <>
              <Button
                size="sm"
                type="button"
                variant={row.is_approved ? "secondary" : "primary"}
                disabled={row.is_approved || busy}
                loading={busy && !row.is_approved}
                onClick={() => onApprove(true)}
              >
                On
              </Button>
              <Button
                size="sm"
                type="button"
                variant={row.is_approved ? "danger" : "ghost"}
                disabled={!row.is_approved || busy}
                loading={busy && row.is_approved}
                onClick={() => onApprove(false)}
              >
                Off
              </Button>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}
