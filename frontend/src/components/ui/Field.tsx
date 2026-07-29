import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { useId } from "react";

import { cn } from "@/lib/utils";

const CONTROL =
  "w-full min-h-11 rounded-[3px] border border-chalk-deep bg-chalk px-3 font-sans text-sm text-ink " +
  "placeholder:text-ink-soft/55 disabled:opacity-55 aria-[invalid=true]:border-boundary";

interface LabelledProps {
  label: string;
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  className?: string;
}

function Wrapper({
  label,
  hint,
  error,
  required,
  className,
  id,
  children,
}: LabelledProps & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className="font-sans text-xs font-semibold tracking-wide text-willow-soft"
      >
        {label}
        {required && <span className="ml-1 text-boundary-soft">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="font-sans text-xs text-boundary-soft">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="font-sans text-xs text-willow">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className">, LabelledProps {}

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Wrapper
      label={label}
      hint={hint}
      error={error}
      required={rest.required}
      className={className}
      id={id}
    >
      <input
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, rest.type === "number" && "tabular")}
      />
    </Wrapper>
  );
}

interface SelectFieldProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">, LabelledProps {
  children: ReactNode;
}

export function SelectField({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: SelectFieldProps) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <Wrapper
      label={label}
      hint={hint}
      error={error}
      required={rest.required}
      className={className}
      id={id}
    >
      <select
        {...rest}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, "appearance-none pr-8")}
      >
        {children}
      </select>
    </Wrapper>
  );
}

export function CheckField({
  label,
  hint,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; hint?: string }) {
  const generated = useId();
  const id = rest.id ?? generated;
  return (
    <label htmlFor={id} className="tap flex items-start gap-3 py-1">
      <input
        {...rest}
        id={id}
        type="checkbox"
        className="mt-1 size-4 shrink-0 accent-[var(--color-flip)]"
      />
      <span>
        <span className="block font-sans text-sm text-chalk">{label}</span>
        {hint && <span className="block font-sans text-xs text-willow">{hint}</span>}
      </span>
    </label>
  );
}
