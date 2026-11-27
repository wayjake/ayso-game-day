// The payment receipt email: what a family gets once a payment is recorded. A
// team's own subject and message, with placeholders filled in, like the
// invoice email (invoice-email.ts, whose helpers this shares). Used by the
// server to send and by the Invoices page to preview. Pure, unit tested.
//
// It never carries the staff note or who paid, since it goes to every parent
// email on the family's kids and a payer's name is shown only to that payer.

import { formatCents, type Cents } from "./money.ts";
import { emailHtml, escapeHtml, fillPlaceholders, joinNames, paragraphsHtml, SUBJECT_MAX, BODY_MAX } from "./invoice-email.ts";

export const DEFAULT_RECEIPT_SUBJECT = "{team}: we got your {amount} payment";

export const DEFAULT_RECEIPT_BODY = `Hi,

Thanks! {team} got your payment of {amount} for {players}.

{details}

{balance}

{pay_link}

Questions? Just reply to this email.

{coach}`;

export { SUBJECT_MAX, BODY_MAX };

export const RECEIPT_PLACEHOLDERS: { key: string; label: string; hint: string }[] = [
  { key: "family", label: "Family", hint: "Who it's for, like “Holden & Jude Smith”" },
  { key: "players", label: "Kids' first names", hint: "Like “Holden and Jude”" },
  { key: "team", label: "Team", hint: "The team's name" },
  { key: "amount", label: "Amount", hint: "How much arrived" },
  { key: "method", label: "Paid with", hint: "Venmo, cash, check…" },
  { key: "date", label: "Date", hint: "When it arrived" },
  { key: "details", label: "Receipt", hint: "Amount, how it was paid and the date, as a table" },
  { key: "balance", label: "What's left", hint: "“You still owe $X”, their credit, or that they're paid up" },
  { key: "pay_link", label: "Invoices button", hint: "A button to see their invoices (and pay what's left), no sign-in needed" },
  { key: "coach", label: "Your name", hint: "The name of whoever recorded it" },
];

export type ReceiptEmailTemplate = { subject: string | null; body: string | null };

export type ReceiptEmailData = {
  team: string;
  coach: string;
  family: string;
  players: string[]; // full names; the email uses first names
  cents: Cents;
  method: string; // "Venmo", "Cash"…
  date: string; // YYYY-MM-DD
  // What the family owes across all their kids now that it's recorded (negative: credit)
  balanceCents: Cents;
  payUrl: string | null;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Nov 27, 2026", without time zones getting a say
export function receiptDate(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

export function cleanReceiptTemplate(subject: string, body: string): ReceiptEmailTemplate {
  const s = subject.replace(/[\r\n]+/g, " ").trim().slice(0, SUBJECT_MAX);
  const b = body.replace(/\r\n?/g, "\n").trim().slice(0, BODY_MAX);
  return {
    subject: !s || s === DEFAULT_RECEIPT_SUBJECT ? null : s,
    body: !b || b === DEFAULT_RECEIPT_BODY ? null : b,
  };
}

const BLOCK = /(\{\s*(?:details|pay_link)\s*\})/i;

export function renderReceiptEmail(template: ReceiptEmailTemplate, d: ReceiptEmailData) {
  const subjectTpl = template.subject?.trim() || DEFAULT_RECEIPT_SUBJECT;
  const body = template.body?.trim() || DEFAULT_RECEIPT_BODY;
  const owed = Math.max(0, d.balanceCents);
  const credit = Math.max(0, -d.balanceCents);
  const plain: Record<string, string> = {
    family: d.family,
    players: joinNames(d.players.map(firstName)),
    team: d.team,
    amount: formatCents(d.cents),
    method: d.method,
    date: receiptDate(d.date),
    coach: d.coach,
    balance:
      owed > 0 ? `You still owe ${formatCents(owed)} in all.`
      : credit > 0 ? `You have ${formatCents(credit)} in credit with the team.`
      : "You're all paid up.",
  };

  const subject = fillPlaceholders(subjectTpl.replace(BLOCK, "").replace(/[\r\n]+/g, " "), plain, false)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SUBJECT_MAX);

  const parts = body.split(BLOCK);
  const isBlock = (p: string, key: string) => new RegExp(`^\\{\\s*${key}\\s*\\}$`, "i").test(p);
  const rows: [string, string][] = [
    ["Amount", formatCents(d.cents)],
    ["Paid with", d.method],
    ["Date", receiptDate(d.date)],
    ["For", d.players.join(", ")],
  ];

  const text = parts
    .map((p) => {
      if (isBlock(p, "details")) return rows.map(([k, v]) => `  ${k}: ${v}`).join("\n");
      if (isBlock(p, "pay_link")) {
        if (!d.payUrl) return "";
        return owed > 0 ? `Pay what's left here, no sign-in needed:\n${d.payUrl}` : `See your invoices here, no sign-in needed:\n${d.payUrl}`;
      }
      return fillPlaceholders(p, plain, false);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const cell = "padding:6px 0;border-bottom:1px solid #e2e8f0";
  const html = parts
    .map((p) => {
      if (isBlock(p, "details")) {
        return `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 16px">
${rows.map(([k, v]) => `<tr><td style="${cell};color:#475569">${k}</td><td style="${cell};text-align:right">${escapeHtml(v)}</td></tr>`).join("\n")}
</table>`;
      }
      if (isBlock(p, "pay_link")) {
        if (!d.payUrl) return "";
        return `<p style="margin:0 0 16px"><a href="${escapeHtml(d.payUrl)}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${owed > 0 ? `See it and pay ${formatCents(owed)}` : "See your invoices"}</a><br><span style="color:#64748b;font-size:13px">No sign-in needed.</span></p>`;
      }
      return paragraphsHtml(p, plain);
    })
    .filter(Boolean)
    .join("\n");

  return { subject, text, html: emailHtml(html) };
}
