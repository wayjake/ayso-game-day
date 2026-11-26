// Shared pieces for the Money pages (staff) and the family Money page.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { CaretDown, Check } from "@phosphor-icons/react";
import { formatCents, plainAmount, type Cents } from "~/utils/money";
import { METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod, type TxnKind } from "~/utils/ledger";
import { Alert, Button, Card, cx, hintClass, inputClass, labelClass } from "~/components/ui";

export function Amount({ cents, className, tone }: { cents: Cents; className?: string; tone?: "owed" | "credit" | "plain" }) {
  const color = tone === "owed" ? "text-danger" : tone === "credit" ? "text-success" : "";
  return <span className={cx("tabular", color, className)}>{formatCents(cents)}</span>;
}

// A dollar amount typed as text and read on the server with parseCents (never parseFloat)
export function MoneyField({
  name,
  label,
  defaultCents,
  hint,
  required = true,
  id,
}: {
  name: string;
  label: ReactNode;
  defaultCents?: Cents | null;
  hint?: ReactNode;
  required?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div>
      <label htmlFor={fieldId} className={labelClass}>{label}</label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted" aria-hidden>$</span>
        <input
          id={fieldId}
          name={name}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          required={required}
          defaultValue={defaultCents ? plainAmount(defaultCents) : ""}
          placeholder="0.00"
          pattern="^\$?[0-9,]*(\.[0-9]{0,2})?$"
          className={cx(inputClass, "pl-7 tabular")}
        />
      </div>
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

export function MethodField({ defaultValue = "venmo", name = "method" }: { defaultValue?: PaymentMethod; name?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>How</label>
      <select id={id} name={name} defaultValue={defaultValue} className={inputClass}>
        {PAYMENT_METHODS.map((m) => (
          <option key={m} value={m}>{METHOD_LABELS[m]}</option>
        ))}
      </select>
    </div>
  );
}

export function DateField({ today, name = "occurredOn", label = "Date" }: { today: string; name?: string; label?: string }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{label}</label>
      <input id={id} name={name} type="date" defaultValue={today} max={today} className={inputClass} />
    </div>
  );
}

export function TextField({ name, label, placeholder, optional = true, defaultValue }: { name: string; label: string; placeholder?: string; optional?: boolean; defaultValue?: string | null }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label} {optional && <span className="font-normal text-muted">(optional)</span>}
      </label>
      <input id={id} name={name} maxLength={200} required={!optional} placeholder={placeholder} defaultValue={defaultValue ?? ""} className={inputClass} />
    </div>
  );
}

type ActionResult = { ok?: boolean; error?: string; message?: string };

// A form for one ledger action. Carries a key from the loader so a double
// submit posts once; the loader hands out a new key after each save, which
// also remounts (clears) the form.
export function LedgerForm({
  intent,
  formKey,
  submitLabel,
  children,
  className,
  variant = "primary",
  onDone,
  action,
}: {
  intent: string;
  formKey: string;
  submitLabel: string;
  children?: ReactNode;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
  onDone?: () => void;
  action?: string;
}) {
  const fetcher = useFetcher<ActionResult>();
  const busy = fetcher.state !== "idle";
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) done.current?.();
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form method="post" action={action} key={formKey} className={cx("space-y-4", className)}>
      <input type="hidden" name="_action" value={intent} />
      <input type="hidden" name="clientKey" value={`${formKey}:${intent}`} />
      {fetcher.data?.error && <Alert>{fetcher.data.error}</Alert>}
      {children}
      <div className="flex justify-end">
        <Button type="submit" variant={variant} disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </fetcher.Form>
  );
}

// A section that opens to show its form. <details> works before hydration and needs no state.
export function ActionPanel({ title, hint, icon, children, defaultOpen }: { title: string; hint?: string; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <Card className="overflow-hidden">
      <details className="group" open={defaultOpen}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
          {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</span>}
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{title}</span>
            {hint && <span className="block text-sm text-muted">{hint}</span>}
          </span>
          <CaretDown size={18} className="shrink-0 text-muted transition group-open:rotate-180" aria-hidden />
        </summary>
        <div className="border-t border-line px-5 py-4">{children}</div>
      </details>
    </Card>
  );
}

export type PickOption = { key: string; label: string; detail?: ReactNode; disabled?: boolean };

// Checkboxes for who an action applies to. Values are "player:12" / "staff:3".
export function MemberChecklist({ name = "member", options, defaultChecked }: { name?: string; options: PickOption[]; defaultChecked?: (o: PickOption) => boolean }) {
  if (options.length === 0) return <p className="text-sm text-muted">No one to pick.</p>;
  return (
    <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl ring-1 ring-line">
      {options.map((o) => (
        <li key={o.key}>
          <label className={cx("flex min-h-11 items-center gap-3 px-3 py-2", o.disabled ? "opacity-50" : "cursor-pointer hover:bg-surface-2")}>
            <input type="checkbox" name={name} value={o.key} disabled={o.disabled} defaultChecked={!o.disabled && (defaultChecked?.(o) ?? false)} />
            <span className="min-w-0 flex-1 truncate text-sm">{o.label}</span>
            {o.detail && <span className="shrink-0 text-sm text-muted">{o.detail}</span>}
          </label>
        </li>
      ))}
    </ul>
  );
}

export function Choice({ name, options, defaultValue }: { name: string; options: { value: string; label: string; hint?: string }[]; defaultValue: string }) {
  return (
    <div className="space-y-2" role="radiogroup">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary">
          <input type="radio" name={name} value={o.value} defaultChecked={o.value === defaultValue} className="mt-0.5" />
          <span>
            <span className="block text-sm font-semibold">{o.label}</span>
            {o.hint && <span className="block text-sm text-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function UndoButton({ txnId, formKey, action }: { txnId: number; formKey: string; action?: string }) {
  const fetcher = useFetcher<ActionResult>();
  // A browser confirm() would block the page; a second tap is the confirmation instead
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <fetcher.Form method="post" action={action} className="inline">
      <input type="hidden" name="_action" value="reverse" />
      <input type="hidden" name="txnId" value={txnId} />
      <input type="hidden" name="clientKey" value={`${formKey}:reverse:${txnId}`} />
      <button
        type="submit"
        disabled={fetcher.state !== "idle"}
        className={cx("tap text-sm font-semibold underline-offset-2 hover:underline disabled:opacity-50", armed ? "text-danger" : "text-muted hover:text-danger")}
        onClick={(e) => {
          if (!armed) {
            e.preventDefault();
            setArmed(true);
          }
        }}
      >
        {fetcher.state !== "idle" ? "Undoing…" : armed ? "Tap again to undo" : "Undo"}
      </button>
      {fetcher.data?.error && <span className="ml-2 text-sm text-danger">{fetcher.data.error}</span>}
    </fetcher.Form>
  );
}

// How a line on a member's account reads, from the member's side
export function memberLineText(row: { kind: TxnKind; cents: Cents; itemName: string | null; fundName: string | null; method: PaymentMethod | null }) {
  const item = row.itemName ?? "Team costs";
  switch (row.kind) {
    case "charge":
      return item;
    case "payment":
      return `Payment${row.method ? ` · ${METHOD_LABELS[row.method]}` : ""}`;
    case "cover":
      return `${item}: covered by ${row.fundName ?? "the team"}`;
    case "credit":
      return `${item}: money back`;
    case "refund":
    case "reimburse":
      return `Paid back${row.method ? ` · ${METHOD_LABELS[row.method]}` : ""}`;
    case "donation":
      return `Credit donated to ${row.fundName ?? "the team"}`;
    case "expense":
      return `Paid for ${item}`;
    case "reversal":
      return "Undone";
    default:
      return row.kind;
  }
}

export function SavedNote({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show) return null;
  return (
    <p className="flex items-center gap-1.5 text-sm font-medium text-success" role="status">
      <Check size={16} weight="bold" />
      {children}
    </p>
  );
}

// > 0 owes, < 0 is owed
export function Balance({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-muted">Settled</span>;
  return cents > 0 ? (
    <span className="text-right">
      <Amount cents={cents} tone="owed" className="font-semibold" /> <span className="text-xs text-muted">owes</span>
    </span>
  ) : (
    <span className="text-right">
      <Amount cents={-cents} tone="credit" className="font-semibold" /> <span className="text-xs text-muted">due back</span>
    </span>
  );
}

