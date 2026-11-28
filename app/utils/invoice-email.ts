// The invoice email: a team's own subject and message, with placeholders
// filled in per family. Used by the server to send and by the Invoices page to
// preview, so what the coach sees is what goes out. Pure, unit tested.
//
// The coach writes only words. The line items, the amount-due sentence and the
// pay button are built here, so a family due money back never reads "You owe".

import { formatCents, type Cents } from "./money.ts";

export const DEFAULT_INVOICE_SUBJECT = "{team}: invoice #{number} for {total}";

export const DEFAULT_INVOICE_BODY = `Hi,

Here's invoice #{number} from {team}, for {family}:

{items}

{balance}

{pay_link}

Questions? Just reply to this email.

{coach}`;

export const SUBJECT_MAX = 200;
export const BODY_MAX = 5000;

export const INVOICE_PLACEHOLDERS: { key: string; label: string; hint: string }[] = [
  { key: "family", label: "Family", hint: "Who it's for, like “Holden & Jude Smith”" },
  { key: "players", label: "Kids' first names", hint: "Like “Holden and Jude”" },
  { key: "team", label: "Team", hint: "The team's name" },
  { key: "number", label: "Invoice #", hint: "The invoice number" },
  { key: "total", label: "Invoice total", hint: "This invoice's total" },
  { key: "items", label: "Line items", hint: "Each share on this invoice, as a table" },
  { key: "balance", label: "Amount due", hint: "“You owe $X in all”, or what's coming back to them" },
  { key: "pay_link", label: "Pay button", hint: "The button to see it and pay, no sign-in needed" },
  { key: "coach", label: "Your name", hint: "The sender's name" },
];

export type InvoiceEmailTemplate = { subject: string | null; body: string | null };

export type InvoiceEmailData = {
  team: string;
  coach: string;
  number: number;
  family: string;
  players: string[]; // full names; the email uses first names
  lines: { label: string; cents: Cents }[];
  totalCents: Cents;
  // What the family owes across all their invoices once this one is out (negative: due back)
  balanceCents: Cents;
  payUrl: string;
};

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

// "Holden", "Holden and Jude", "Ava, Holden and Jude"
export function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// A line on an invoice that covers more than one kid names whose it is
export function invoiceLineLabel(label: string, who: string, severalKids: boolean) {
  return severalKids ? `${label} (${firstName(who)})` : label;
}

// −$12.00 for money back, with a real minus sign
export function signedAmount(cents: Cents) {
  return `${cents < 0 ? "−" : ""}${formatCents(Math.abs(cents))}`;
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// What the coach saved, or the default when it's empty or the same as the default
export function cleanTemplate(subject: string, body: string): { subject: string | null; body: string | null } {
  const s = subject.replace(/[\r\n]+/g, " ").trim().slice(0, SUBJECT_MAX);
  const b = body.replace(/\r\n?/g, "\n").trim().slice(0, BODY_MAX);
  return {
    subject: !s || s === DEFAULT_INVOICE_SUBJECT ? null : s,
    body: !b || b === DEFAULT_INVOICE_BODY ? null : b,
  };
}

const PLACEHOLDER = /\{\s*([a-z_]+)\s*\}/gi;
const BLOCK = /(\{\s*(?:items|pay_link)\s*\})/i;

function values(d: InvoiceEmailData) {
  const owed = Math.max(0, d.balanceCents);
  const dueBack = Math.max(0, -d.balanceCents);
  return {
    owed,
    dueBack,
    plain: {
      family: d.family,
      players: joinNames(d.players.map(firstName)),
      team: d.team,
      number: String(d.number),
      total: signedAmount(d.totalCents),
      coach: d.coach,
      balance:
        owed > 0 ? `You owe ${formatCents(owed)} in all.`
        : dueBack > 0 ? `The team owes you ${formatCents(dueBack)}. The coach will pay it back.`
        : "You're all paid up.",
    } as Record<string, string>,
  };
}

// Shared with the receipt email (receipt-email.ts)
export function fillPlaceholders(text: string, plain: Record<string, string>, html: boolean) {
  const out = html ? escapeHtml(text) : text;
  return out.replace(PLACEHOLDER, (whole, key: string) => {
    const v = plain[key.toLowerCase()];
    if (v === undefined) return whole;
    return html ? escapeHtml(v) : v;
  });
}

export function renderInvoiceEmail(template: InvoiceEmailTemplate, d: InvoiceEmailData) {
  const subjectTpl = template.subject?.trim() || DEFAULT_INVOICE_SUBJECT;
  let body = template.body?.trim() || DEFAULT_INVOICE_BODY;
  // The pay link is the point of the email, so it's never left out
  if (!/\{\s*pay_link\s*\}/i.test(body)) body = `${body}\n\n{pay_link}`;
  const { owed, plain } = values(d);

  const subject = fillPlaceholders(subjectTpl.replace(BLOCK, "").replace(/[\r\n]+/g, " "), plain, false)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUBJECT_MAX);

  const parts = body.split(BLOCK);
  const isBlock = (p: string, key: string) => new RegExp(`^\\{\\s*${key}\\s*\\}$`, "i").test(p);

  // Plain text
  const text = parts
    .map((p) => {
      if (isBlock(p, "items")) return [...d.lines.map((l) => `  ${l.label}: ${signedAmount(l.cents)}`), `  Total: ${signedAmount(d.totalCents)}`].join("\n");
      if (isBlock(p, "pay_link")) return owed > 0 ? `Pay ${formatCents(owed)} here, no sign-in needed:\n${d.payUrl}` : `See your invoices here, no sign-in needed:\n${d.payUrl}`;
      return fillPlaceholders(p, plain, false);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // HTML: the coach's paragraphs, with the table and button between them
  const cell = "padding:6px 0;border-bottom:1px solid #e2e8f0";
  const html = parts
    .map((p) => {
      if (isBlock(p, "items")) {
        return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">
${d.lines.map((l) => `<tr><td style="${cell};color:#475569">${escapeHtml(l.label)}</td><td style="${cell};text-align:right;white-space:nowrap">${signedAmount(l.cents)}</td></tr>`).join("\n")}
<tr><td style="padding:8px 0;font-weight:600">Total</td><td style="padding:8px 0;text-align:right;font-weight:600">${signedAmount(d.totalCents)}</td></tr>
</table>`;
      }
      if (isBlock(p, "pay_link")) {
        return `<p style="margin:0 0 16px"><a href="${escapeHtml(d.payUrl)}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${owed > 0 ? `See it and pay ${formatCents(owed)}` : "See your invoices"}</a><br><span style="color:#64748b;font-size:13px">No sign-in needed.</span></p>`;
      }
      return paragraphsHtml(p, plain);
    })
    .filter(Boolean)
    .join("\n");

  return { subject, text, html: emailHtml(html) };
}

// The coach's words as HTML paragraphs: a blank line starts a new one
export function paragraphsHtml(text: string, plain: Record<string, string>) {
  return text
    .split(/\n\s*\n/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p style="margin:0 0 16px">${fillPlaceholders(para, plain, true).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function emailHtml(inner: string) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:520px">\n${inner}\n</div>`;
}
