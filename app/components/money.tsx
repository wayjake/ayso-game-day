// Shared pieces for the Finances pages (staff) and the family Finances page.

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { CaretDown, CaretRight, Wallet } from "@phosphor-icons/react";
import { navMotion } from "~/utils/nav-motion";
import { formatCents, parseCents, plainAmount, sumCents, type Cents } from "~/utils/money";
import { FULL_SHARE, METHOD_LABELS, PAYMENT_METHODS, shareTargets, type PaymentMethod, type Rounding, type TxnKind } from "~/utils/ledger";
import { Alert, Badge, Button, Card, cx, hintClass, inputClass, labelClass } from "~/components/ui";

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

export type ShareOption = PickOption & { checked: boolean; weight: number; fixedCents: Cents | null };

// Who shares an expense, and how much each person's share comes to as you
// pick. Split: a full or half share of the total. Fixed: each person's own
// amount. Fields: "share" (ticked people), "weight:<key>", "amount:<key>".
export function ShareEditor({
  mode,
  options,
  totalCents,
  rounding,
  unitCents = null,
  cantGo,
}: {
  mode: "split" | "fixed";
  options: ShareOption[];
  totalCents: Cents | null;
  rounding: Rounding;
  unitCents?: Cents | null;
  // From RSVPs to the expense's games: players who can't make any of them
  cantGo?: { games: number; keys: string[] };
}) {
  const [rows, setRows] = useState(() =>
    Object.fromEntries(
      options.map((o) => [o.key, { checked: o.checked, weight: o.weight, amount: o.fixedCents !== null ? plainAmount(o.fixedCents) : "" }])
    )
  );
  const set = (key: string, patch: Partial<(typeof rows)[string]>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }));
  const picked = options.filter((o) => rows[o.key]?.checked);

  // Each picked person's share, worked out the same way the server will
  let amounts = new Map<string, Cents>();
  if (mode === "split" && totalCents && totalCents > 0 && picked.length) {
    try {
      const t = shareTargets(
        { mode: "split", totalCents, rounding, unitCents },
        picked.map((o) => ({ member: { type: o.key.startsWith("staff:") ? "staff" : "player", id: Number(o.key.split(":")[1]) }, weight: rows[o.key].weight, fixedCents: null }))
      );
      amounts = new Map(picked.map((o, i) => [o.key, t[i].cents]));
    } catch {
      amounts = new Map();
    }
  }
  if (mode === "fixed") {
    amounts = new Map(picked.map((o) => [o.key, parseCents(rows[o.key].amount) ?? 0]));
  }
  const billed = sumCents([...amounts.values()]);

  if (options.length === 0) return <p className="text-sm text-muted">No one to pick.</p>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">{picked.length} of {options.length} picked</span>
        <span className="flex gap-3">
          {cantGo && cantGo.games > 0 && (
            <button
              type="button"
              className="tap font-semibold text-primary"
              title={cantGo.keys.length ? `Leaves off ${cantGo.keys.length} who can't make ${cantGo.games === 1 ? "the game" : "any of the games"}` : "Nobody has said they can't go"}
              onClick={() =>
                setRows((r) =>
                  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, checked: k.startsWith("player:") ? !cantGo.keys.includes(k) : v.checked }]))
                )
              }
            >
              Match RSVPs{cantGo.keys.length ? ` (−${cantGo.keys.length})` : ""}
            </button>
          )}
          <button type="button" className="tap font-semibold text-primary" onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, checked: true }])))}>
            Everyone
          </button>
          <button type="button" className="tap font-semibold text-muted" onClick={() => setRows((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, { ...v, checked: false }])))}>
            No one
          </button>
        </span>
      </div>
      <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
        {options.map((o) => {
          const row = rows[o.key];
          return (
            <li key={o.key} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1">
                <input type="checkbox" name="share" value={o.key} checked={row.checked} onChange={(e) => set(o.key, { checked: e.target.checked })} />
                <span className="min-w-0 truncate text-sm">{o.label}</span>
                {o.detail && <span className="hidden shrink-0 text-xs text-muted sm:inline">{o.detail}</span>}
              </label>
              {row.checked && mode === "split" && (
                <select
                  name={`weight:${o.key}`}
                  aria-label={`${o.label}'s share`}
                  value={row.weight}
                  onChange={(e) => set(o.key, { weight: Number(e.target.value) })}
                  className={cx(inputClass, "h-9 w-auto! shrink-0 py-0 pr-8 text-sm pointer-coarse:h-11")}
                >
                  <option value={FULL_SHARE}>Full</option>
                  <option value={1}>Half</option>
                </select>
              )}
              {row.checked && mode === "fixed" && (
                <span className="relative w-24 shrink-0">
                  <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-muted" aria-hidden>$</span>
                  <input
                    name={`amount:${o.key}`}
                    aria-label={`${o.label}'s amount`}
                    inputMode="decimal"
                    autoComplete="off"
                    required
                    value={row.amount}
                    onChange={(e) => set(o.key, { amount: e.target.value })}
                    placeholder="0.00"
                    className={cx(inputClass, "h-9 pl-6 text-sm tabular pointer-coarse:h-11")}
                  />
                </span>
              )}
              {row.checked && mode === "split" && (
                <span className="w-16 shrink-0 text-right text-sm font-semibold tabular">{amounts.has(o.key) ? formatCents(amounts.get(o.key)!) : "–"}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className={hintClass}>
        {picked.length === 0
          ? "Pick who shares it."
          : mode === "split" && totalCents
            ? billed === totalCents
              ? `Shares add up to ${formatCents(billed)}.`
              : `Shares add up to ${formatCents(billed)} for a ${formatCents(totalCents)} total. ${billed > totalCents ? "The extra" : "The difference"} is sorted out when you settle up at the end.`
            : mode === "fixed"
              ? `Comes to ${formatCents(billed)} in all.`
              : "Enter the total to see each share."}
      </p>
    </div>
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
      return `Share of ${item}`;
    case "adjust":
      return `Change to share of ${item}`;
    case "settle":
      return `Settle-up for ${item}`;
    case "payment":
      return `Payment${row.method ? ` · ${METHOD_LABELS[row.method]}` : ""}`;
    case "cover":
      return `${item}: covered by ${row.fundName ?? "the team"}`;
    case "credit":
      return `Refund on ${item}`;
    case "refund":
    case "reimburse":
      return `Paid back${row.method ? ` · ${METHOD_LABELS[row.method]}` : ""}`;
    case "donation":
      return `Credit donated to ${row.fundName ?? "the team"}`;
    case "expense":
      return `Paid out for ${item}`;
    case "reversal":
      return "Undone";
    default:
      return row.kind;
  }
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


// The family Schedule page's link to Finances
export function MoneyCard({ owed, dueBack, pending, className }: { owed: Cents; dueBack: Cents; pending: number; className?: string }) {
  const line =
    owed > 0 ? (
      <>You owe <Amount cents={owed} className="font-semibold text-danger" /></>
    ) : dueBack > 0 ? (
      <>The team owes you <Amount cents={dueBack} className="font-semibold text-success" /></>
    ) : (
      <>You're all paid up</>
    );
  return (
    <Link to="/family/finances" {...navMotion("push")} className={cx("flex items-center gap-4 rounded-2xl bg-surface p-4 shadow-card ring-1 ring-line transition hover:ring-line-strong", className)}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Wallet size={22} weight="fill" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Finances</span>
        <span className="block text-sm text-muted">
          {line}
          {pending > 0 && " · waiting for the coach to confirm a payment"}
        </span>
      </span>
      <CaretRight size={18} className="shrink-0 text-muted" />
    </Link>
  );
}

type InvoiceView = {
  id: number;
  number: number;
  issuedAt: string;
  totalCents: Cents;
  paid: Cents;
  remaining: Cents;
  lines: { label: string; cents: Cents }[];
};

// One invoice for a family: open ones start expanded
export function InvoiceCard({ inv }: { inv: Pick<InvoiceView, "id" | "number" | "issuedAt" | "totalCents" | "paid" | "remaining" | "lines"> }) {
  const open = inv.remaining > 0;
  const status =
    inv.totalCents <= 0 ? <Badge tone="success">Money back</Badge>
    : inv.remaining === 0 ? <Badge tone="success">Paid</Badge>
    : inv.paid > 0 ? <Badge tone="warning">{formatCents(inv.remaining)} left</Badge>
    : <Badge tone="danger">Due</Badge>;
  return (
    <li>
      <Card className="overflow-hidden">
        <details className="group" open={open}>
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-5 py-3 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Invoice #{inv.number}</span>
              <span className="block text-xs text-muted">{inv.issuedAt.slice(0, 10)}</span>
            </span>
            {status}
            <span className={cx("font-semibold tabular", inv.totalCents < 0 && "text-success")}>
              {inv.totalCents < 0 ? "−" : ""}
              {formatCents(Math.abs(inv.totalCents))}
            </span>
          </summary>
          <ul className="space-y-1.5 border-t border-line px-5 py-3 text-sm">
            {inv.lines.map((l, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 text-muted">{l.label}</span>
                <span className={cx("shrink-0 tabular", l.cents < 0 && "text-success")}>
                  {l.cents < 0 ? "−" : ""}
                  {formatCents(Math.abs(l.cents))}
                </span>
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </li>
  );
}

