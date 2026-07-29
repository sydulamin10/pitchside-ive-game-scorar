import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Panel, Seam } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/store/auth";

const MIN_PASSWORD = 10;

export function Register() {
  const register = useAuth((state) => state.register);
  const navigate = useNavigate();

  const [form, setForm] = useState({ display_name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await register({
        display_name: form.display_name.trim(),
        email: form.email.trim(),
        password: form.password,
      });
      void navigate("/app", { replace: true });
    } catch (cause) {
      if (cause instanceof ApiError) {
        setFieldErrors(cause.fieldErrors);
        setError(cause.message);
      } else {
        setError("Could not create your account. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <h1 className="text-2xl">Create an account</h1>
      <p className="mt-1 text-sm text-willow-soft">
        Free, and no card. You need an account to score a match; nobody needs one to watch it.
      </p>
      <Seam className="my-5" />

      <Panel className="p-5">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <TextField
            label="Your name"
            name="display_name"
            autoComplete="name"
            required
            value={form.display_name}
            onChange={update("display_name")}
            error={fieldErrors.display_name}
          />
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={update("email")}
            error={fieldErrors.email}
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            value={form.password}
            onChange={update("password")}
            error={fieldErrors.password}
            hint={`At least ${MIN_PASSWORD} characters. Common passwords are refused.`}
          />
          {error && (
            <p role="alert" className="font-sans text-sm text-boundary-soft">
              {error}
            </p>
          )}
          <Button type="submit" loading={busy} fullWidth size="lg">
            Create account
          </Button>
        </form>
      </Panel>

      <p className="mt-4 font-sans text-sm text-willow-soft">
        Already have one?{" "}
        <Link to="/login" className="text-flip underline underline-offset-4">
          Log in
        </Link>
        .
      </p>
    </div>
  );
}
