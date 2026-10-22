import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Panel, Seam } from "@/components/ui/Surface";
import { ApiError } from "@/lib/api/client";
import { auth } from "@/lib/api/endpoints";

export function VerifyEmail() {
  const [params] = useSearchParams();
  const token = (params.get("token") ?? "").trim();
  const [status, setStatus] = useState<"working" | "ok" | "error">(token ? "working" : "error");
  const [message, setMessage] = useState(
    token ? "Confirming your email…" : "This verification link is missing or incomplete.",
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void auth
      .verifyEmail(token)
      .then(() => {
        if (cancelled) return;
        setStatus("ok");
        setMessage("Email confirmed. You can log in now.");
      })
      .catch((cause) => {
        if (cancelled) return;
        setStatus("error");
        setMessage(
          cause instanceof ApiError
            ? cause.message
            : "This link is invalid or has expired. Request a new one from the login page.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <h1 className="text-2xl">Verify your email</h1>
      <p className="mt-1 text-sm text-willow-soft">
        Open the link we sent to your inbox to finish creating the account.
      </p>
      <Seam className="my-5" />
      <Panel className="p-5">
        <p className="font-sans text-sm text-chalk">{message}</p>
        <div className="mt-4">
          <Link to="/login" className="text-flip underline underline-offset-4">
            {status === "ok" ? "Log in" : "Back to log in"}
          </Link>
        </div>
      </Panel>
    </div>
  );
}
