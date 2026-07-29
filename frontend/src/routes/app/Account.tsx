/**
 * Account and security.
 *
 * Sessions are shown with the device and address they were created from, and any
 * one of them can be revoked — a scorer who left their phone in a kit bag can cut
 * it off from here. Changing a password revokes every other session by design.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Badge, Panel, Seam, SectionTitle, Spinner } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { auth } from "@/lib/api/endpoints";
import { formatDateTime, relativeTime } from "@/lib/utils";
import { useAuth } from "@/store/auth";
import { toast, toastError } from "@/store/toast";

export default function Account() {
  const queryClient = useQueryClient();
  const user = useAuth((state) => state.user);
  const logout = useAuth((state) => state.logout);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | undefined>();

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: () => auth.sessions() });

  const changePassword = useMutation({
    mutationFn: () => auth.changePassword({ current_password: current, new_password: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setError(undefined);
      toast("Password changed. Other devices have been signed out.", "success");
      void queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (cause) => {
      if (cause instanceof ApiError) setError(cause.message);
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

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-sans text-lg font-semibold text-chalk">Account</h1>
        <p className="pt-1 font-sans text-xs text-willow">
          {user?.display_name} · {user?.email}
        </p>
      </header>

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
            error={error}
            hint="At least ten characters. A short phrase you will remember beats a clever short one."
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
          Balls scored offline are stored on this device until they sync. Signing out leaves
          them in place, but sign in again on the same browser to send them.
        </p>
        <Button variant="ghost" className="mt-3" onClick={() => void logout()}>
          Sign out of this device
        </Button>
      </Panel>
    </div>
  );
}
