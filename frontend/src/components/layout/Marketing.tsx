/**
 * Shared furniture for the written pages.
 *
 * These pages are prose, not product, so they get one narrow column, generous
 * line length, and the same seam rules as the rest of the app. Keeping the layout
 * here means a new guide is a file of sentences rather than a file of Tailwind.
 */

import type { ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/Button";
import { Badge, Paper, Seam, SectionTitle } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";

export function PageHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="mx-auto max-w-3xl px-4 pt-12 pb-8">
      {eyebrow && <Badge tone="quiet">{eyebrow}</Badge>}
      <h1 className="mt-4 text-3xl sm:text-4xl">{title}</h1>
      <p className="mt-4 text-base text-chalk/85">{lede}</p>
    </header>
  );
}

/** A readable column of paragraphs, headings and lists. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-8">{children}</div>;
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 className="pt-4 text-xl">{children}</h2>;
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("text-sm leading-relaxed text-willow-soft", className)}>{children}</p>
  );
}

/** A numbered walkthrough, numbered the way an over is: 1.1, 1.2, 1.3. */
export function Steps({ steps }: { steps: Array<{ title: string; body: ReactNode }> }) {
  return (
    <ol className="flex flex-col gap-5 pt-2">
      {steps.map((step, index) => (
        <li key={step.title}>
          <p className="font-mono text-sm font-semibold tabular text-flip">1.{index + 1}</p>
          <h3 className="mt-1 text-base text-chalk">{step.title}</h3>
          <div className="mt-1 text-sm leading-relaxed text-willow-soft">{step.body}</div>
        </li>
      ))}
    </ol>
  );
}

export function Faq({ items }: { items: Array<{ q: string; a: ReactNode }> }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-8">
      <SectionTitle>Questions people actually ask</SectionTitle>
      <dl className="mt-4 flex flex-col">
        {items.map((item, index) => (
          <div key={item.q}>
            {index > 0 && <Seam />}
            <div className="py-4">
              <dt className="font-sans text-sm font-semibold text-chalk">{item.q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-willow-soft">{item.a}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A pull-out on chalk paper, for the one thing on the page worth remembering. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Paper className="mt-2 p-5">
      <h3 className="text-lg text-ink">{title}</h3>
      <div className="mt-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </Paper>
  );
}

export function CtaRow({
  title,
  body,
  primary = { to: "/register", label: "Start scoring" },
  secondary,
}: {
  title: string;
  body: string;
  primary?: { to: string; label: string };
  secondary?: { to: string; label: string };
}) {
  return (
    <>
      <Seam />
      <section className="mx-auto flex max-w-3xl flex-col items-start gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl">{title}</h2>
          <p className="mt-1 text-sm text-willow-soft">{body}</p>
        </div>
        <div className="flex gap-3">
          <Link to={primary.to}>
            <Button size="lg">{primary.label}</Button>
          </Link>
          {secondary && (
            <Link to={secondary.to}>
              <Button variant="ghost" size="lg">
                {secondary.label}
              </Button>
            </Link>
          )}
        </div>
      </section>
    </>
  );
}
