import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Panel, Seam } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      void navigate(destination, { replace: true });
    } catch (cause) {
      setError(
        cause instanceof ApiError
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
          <Button type="submit" loading={busy} fullWidth size="lg">
            Log in
          </Button>
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
