/**
 * The toss tools: a coin and a wheel.
 *
 * Both are decided by the *server* with a cryptographic randomness source, and
 * both come back with an HMAC receipt over the result and the time. That is the
 * point: two captains who do not trust each other's phone can both check that the
 * result was not re-rolled, because the receipt would not match.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { Panel, Seam, SectionTitle } from "@/components/ui/Surface";
import { FlapText } from "@/components/board/SplitFlap";
import { tools } from "@/lib/api/endpoints";
import type { CoinFlipResult, SpinWheelResult } from "@/lib/api/types";
import { formatDateTime } from "@/lib/utils";
import { toastError } from "@/store/toast";

export default function ToolsPage({ initial = "coin" }: { initial?: "coin" | "wheel" }) {
  const [tab, setTab] = useState<"coin" | "wheel">(initial);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header>
        <h1 className="font-sans text-lg font-semibold text-chalk">Toss tools</h1>
        <p className="pt-1 font-sans text-sm text-willow-soft">
          Decided on the server and stamped with a receipt, so nobody can re-roll a result they
          did not like.
        </p>
      </header>

      <nav className="flex gap-2" aria-label="Tools">
        <Button
          size="sm"
          variant={tab === "coin" ? "secondary" : "ghost"}
          onClick={() => setTab("coin")}
        >
          Coin flip
        </Button>
        <Button
          size="sm"
          variant={tab === "wheel" ? "secondary" : "ghost"}
          onClick={() => setTab("wheel")}
        >
          Spin the wheel
        </Button>
      </nav>

      {tab === "coin" ? <CoinFlip /> : <SpinWheel />}
    </div>
  );
}

function CoinFlip() {
  const [call, setCall] = useState<"heads" | "tails" | null>(null);
  const [calledBy, setCalledBy] = useState("");
  const [result, setResult] = useState<CoinFlipResult | null>(null);

  const flip = useMutation({
    mutationFn: () => tools.coinFlip({ call, called_by: calledBy.trim() || null }),
    onSuccess: setResult,
    onError: (error) => toastError(error, "The coin could not be flipped."),
  });

  return (
    <Panel className="flex flex-col">
      <div className="flex flex-col items-center gap-4 px-4 py-8">
        <FlapText
          text={result ? result.result : "ready"}
          className="px-4 py-3 text-3xl tracking-[0.2em]"
        />
        {result && (
          <p className="font-sans text-sm text-chalk">
            {result.call
              ? result.call_correct
                ? `${result.called_by || "The caller"} called ${result.call} and won the toss.`
                : `${result.called_by || "The caller"} called ${result.call} and lost the toss.`
              : "No call was made."}
          </p>
        )}
      </div>

      <Seam />

      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="Who is calling"
            className="min-w-40 flex-1"
            value={calledBy}
            maxLength={80}
            onChange={(event) => setCalledBy(event.target.value)}
          />
          <div className="flex gap-2">
            {(["heads", "tails"] as const).map((side) => (
              <Button
                key={side}
                variant={call === side ? "secondary" : "ghost"}
                onClick={() => setCall(call === side ? null : side)}
                aria-pressed={call === side}
              >
                {side}
              </Button>
            ))}
          </div>
        </div>
        <Button loading={flip.isPending} onClick={() => flip.mutate()} className="self-start">
          Flip the coin
        </Button>
      </div>

      {result && <Receipt receipt={result.receipt} at={result.flipped_at} />}
    </Panel>
  );
}

function SpinWheel() {
  const [text, setText] = useState("");
  const [picks, setPicks] = useState(1);
  const [result, setResult] = useState<SpinWheelResult | null>(null);

  const options = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const spin = useMutation({
    mutationFn: () => tools.spinWheel({ options, picks }),
    onSuccess: setResult,
    onError: (error) => toastError(error, "The wheel could not be spun."),
  });

  return (
    <Panel className="flex flex-col">
      <div className="flex flex-col gap-3 px-4 py-4">
        <SectionTitle>Options, one per line</SectionTitle>
        <textarea
          value={text}
          rows={6}
          onChange={(event) => setText(event.target.value)}
          placeholder={"Ali\nRahim\nKarim"}
          className="w-full rounded-[3px] border border-chalk-deep bg-chalk px-3 py-2 font-sans text-sm text-ink"
        />
        <div className="flex flex-wrap items-end gap-3">
          <TextField
            label="How many to pick"
            type="number"
            min={1}
            max={Math.max(1, options.length)}
            value={picks}
            className="w-40"
            onChange={(event) => setPicks(Math.max(1, Number(event.target.value) || 1))}
          />
          <Button
            loading={spin.isPending}
            disabled={options.length < 2}
            onClick={() => spin.mutate()}
          >
            Spin
          </Button>
        </div>
      </div>

      {result && (
        <>
          <Seam />
          <div className="px-4 py-4">
            <SectionTitle>Picked</SectionTitle>
            <ol className="flex flex-col gap-1 pt-2">
              {result.winners.map((winner, index) => (
                <li key={`${winner}-${index}`} className="font-sans text-base text-chalk">
                  <span className="mr-2 font-mono text-xs text-willow">{index + 1}</span>
                  {winner}
                </li>
              ))}
            </ol>
            {result.order.length > result.winners.length && (
              <p className="pt-3 font-sans text-xs text-willow">
                Full order: {result.order.join(" · ")}
              </p>
            )}
          </div>
          <Receipt receipt={result.receipt} at={result.spun_at} />
        </>
      )}
    </Panel>
  );
}

function Receipt({ receipt, at }: { receipt: string; at: string }) {
  return (
    <>
      <Seam />
      <p className="px-4 py-3 font-mono text-[0.7rem] break-all text-willow">
        receipt {receipt} · {formatDateTime(at)}
      </p>
    </>
  );
}
