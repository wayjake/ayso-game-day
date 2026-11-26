// Reading Money form fields, and running a ledger action so rule errors come
// back to the form instead of as a 500.

import crypto from "node:crypto";
import { data } from "react-router";
import { LedgerError } from "~/utils/ledger";
import { FULL_SHARE, PAYMENT_METHODS, type Member, type PaymentMethod, type ShareSpec } from "~/utils/ledger";
import { parseCents, type Cents } from "~/utils/money";
import { todayISO } from "~/utils/dates";
import { parseId } from "~/utils/ids";

export class FormError extends Error {}

export function readCents(formData: FormData, name: string, label = "the amount"): Cents {
  const raw = String(formData.get(name) ?? "");
  const cents = parseCents(raw);
  if (cents === null || cents <= 0) throw new FormError(`Enter ${label} in dollars, like 85 or 85.50`);
  return cents;
}

export function readOptionalCents(formData: FormData, name: string): Cents | null {
  const raw = String(formData.get(name) ?? "").trim();
  if (!raw) return null;
  const cents = parseCents(raw);
  if (cents === null) throw new FormError("Enter amounts in dollars, like 85 or 85.50");
  return cents;
}

export function readMethod(formData: FormData): PaymentMethod {
  const value = String(formData.get("method") ?? "venmo");
  return (PAYMENT_METHODS as readonly string[]).includes(value) ? (value as PaymentMethod) : "other";
}

export function readDate(formData: FormData, name = "occurredOn") {
  const value = String(formData.get(name) ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : todayISO();
}

export function readText(formData: FormData, name: string, max = 200) {
  const value = String(formData.get(name) ?? "").trim();
  return value ? value.slice(0, max) : null;
}

export function readId(formData: FormData, name: string) {
  const id = parseId(formData.get(name));
  if (!id) throw new FormError("Something's missing from the form. Reload and try again.");
  return id;
}

export function readClientKey(formData: FormData) {
  return String(formData.get("clientKey") ?? "");
}

// "player:<uuid>" / "staff:<uuid>"
export function parseMember(value: string): Member | null {
  const m = value.match(/^(player|staff):(.+)$/);
  const id = m ? parseId(m[2]) : null;
  return m && id ? { type: m[1] as Member["type"], id } : null;
}

export function readMembers(formData: FormData, name = "member"): Member[] {
  const seen = new Set<string>();
  const out: Member[] = [];
  for (const v of formData.getAll(name)) {
    const m = parseMember(String(v));
    if (m && !seen.has(`${m.type}:${m.id}`)) {
      seen.add(`${m.type}:${m.id}`);
      out.push(m);
    }
  }
  return out;
}

// Who shares an expense, from ShareEditor: a ticked "share" box per person,
// with "weight:<key>" (2 full, 1 half) or "amount:<key>" (their own amount)
export function readShares(formData: FormData, mode: "split" | "fixed"): ShareSpec[] {
  return readMembers(formData, "share").map((member) => {
    const key = `${member.type}:${member.id}`;
    if (mode === "fixed") {
      const raw = String(formData.get(`amount:${key}`) ?? "").trim();
      const cents = raw ? parseCents(raw) : null;
      if (cents === null || cents < 0) throw new FormError("Enter each person's amount in dollars, like 49 or 49.50");
      return { member, weight: FULL_SHARE, fixedCents: cents };
    }
    const weight = Number(formData.get(`weight:${key}`) ?? FULL_SHARE);
    return { member, weight: weight === 1 ? 1 : FULL_SHARE, fixedCents: null };
  });
}

// A fresh key for each render of a page's forms (see LedgerForm)
export const newFormKey = () => crypto.randomUUID();

export async function runLedgerAction(fn: () => Promise<unknown>) {
  try {
    await fn();
    return data({ ok: true as const, error: undefined });
  } catch (e) {
    if (e instanceof LedgerError || e instanceof FormError) {
      return data({ ok: false as const, error: e.message }, { status: 400 });
    }
    throw e;
  }
}
