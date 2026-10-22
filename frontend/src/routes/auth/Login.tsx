import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Panel, Seam } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { auth } from "@/lib/api/endpoints";
import { useAuth } from "@/store/auth";

export function Login() {
  const login = useAuth((state) => state.login);
  const navigate = useNavigate();
  const location = useLocation();
  const destination = (location.state as { from?: string } | null)?.from ?? "/app";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsVerify, setNeedsVerify] = useState(false);
  const [resent, setResent] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNeedsVerify(false);
    setResent(null);
    try {
      await login(email.trim(), password);
      const role = useAuth.getState().user?.role;
      const next =
        destination !== "/app" ? destination : role === "admin" ? "/app/admin" : "/app";
      void navigate(next, { replace: true });
    } catch (cause) {
      const dbSleeping =
        cause instanceof ApiError &&
        (cause.code === "database_unavailable" || cause.code === "upstream_unavailable");
      const unverified = cause instanceof ApiError && cause.code === "email_not_verified";
      setNeedsVerify(unverified);
      setError(
        dbSleeping
          ? "The database is still starting. Wait a few seconds and tap Log in again."
          : cause instanceof ApiError
            ? cause.message
            : "Could not sign in. Please check your connection.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <h1 className="text-2xl">Log in</h1>
      <p className="mt-1 text-sm text-willow-soft">
        Scorers sign in. Anyone following a match on a shared link does not need an account.
      </p>
      <Seam className="my-5" />

      <Panel className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error && (
            <p role="alert" className="font-sans text-sm text-boundary-soft">
              {error}
            </p>
          )}
          {resent && (
            <p className="font-sans text-sm text-willow-soft" role="status">
              {resent}
            </p>
          )}
          <Button type="submit" loading={busy} fullWidth size="lg">
            Log in
          </Button>
          {needsVerify && (
            <Button
              type="button"
              variant="secondary"
              fullWidth
              disabled={busy || !email.trim()}
              onClick={async () => {
                setBusy(true);
                setResent(null);
                try {
                  const result = await auth.resendVerification(email.trim());
                  setResent(result.message);
                } catch (cause) {
                  setError(
                    cause instanceof ApiError
                      ? cause.message
                      : "Could not send another link. Try again shortly.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Resend verification email
            </Button>
          )}
        </form>
      </Panel>

      <p className="mt-4 font-sans text-sm text-willow-soft">
        No account yet?{" "}
        <Link to="/register" className="text-flip underline underline-offset-4">
          Create one
        </Link>
        .
      </p>
    </div>
  );
}
