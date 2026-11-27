import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INVOICE_BODY, DEFAULT_INVOICE_SUBJECT, cleanTemplate, invoiceLineLabel, joinNames, renderInvoiceEmail, type InvoiceEmailData } from "./invoice-email.ts";

const data: InvoiceEmailData = {
  team: "U14 All Stars",
  coach: "Jake",
  number: 7,
  family: "Holden & Jude Smith",
  players: ["Holden Smith", "Jude Smith"],
  lines: [
    { label: "Quartz Hill Kickmas (Holden)", cents: 5800 },
    { label: "Quartz Hill Kickmas (Jude)", cents: 11600 },
  ],
  totalCents: 17400,
  balanceCents: 17400,
  payUrl: "https://benchtalk.app/pay/abc",
};

test("the default template reads like the old email", () => {
  const e = renderInvoiceEmail({ subject: null, body: null }, data);
  assert.equal(e.subject, "U14 All Stars: invoice #7 for $174.00");
  assert.match(e.text, /^Hi,\n\nHere's invoice #7 from U14 All Stars, for Holden & Jude Smith:/);
  assert.match(e.text, /  Quartz Hill Kickmas \(Holden\): \$58\.00\n  Quartz Hill Kickmas \(Jude\): \$116\.00\n  Total: \$174\.00/);
  assert.match(e.text, /You owe \$174\.00 in all\./);
  assert.match(e.text, /Pay \$174\.00 here, no sign-in needed:\nhttps:\/\/benchtalk\.app\/pay\/abc/);
  assert.match(e.html, /See it and pay \$174\.00/);
  assert.match(e.html, /<table/);
  assert.match(e.html, /Holden &amp; Jude Smith/);
});

test("the coach's words are escaped and placeholders filled", () => {
  const e = renderInvoiceEmail({ subject: "Fees for {players}\n<b>", body: "Hey {players} <script>!\nLine two\n\n{items}\n\nThanks, {coach}" }, data);
  assert.equal(e.subject, "Fees for Holden and Jude <b>");
  assert.doesNotMatch(e.html, /<script>/);
  assert.match(e.html, /Hey Holden and Jude &lt;script&gt;!<br>Line two/);
  // Pay link is added when the template leaves it out
  assert.match(e.text, /https:\/\/benchtalk\.app\/pay\/abc$/);
  assert.match(e.html, /See it and pay/);
});

test("a family due money back isn't told they owe", () => {
  const e = renderInvoiceEmail({ subject: null, body: null }, { ...data, lines: [{ label: "Settle-up", cents: -2000 }], totalCents: -2000, balanceCents: -2000 });
  assert.equal(e.subject, "U14 All Stars: invoice #7 for −$20.00");
  assert.match(e.text, /The team owes you \$20\.00/);
  assert.doesNotMatch(e.text, /You owe/);
  assert.match(e.html, /See your invoices/);
});

test("unknown placeholders stay as typed", () => {
  const e = renderInvoiceEmail({ subject: "{nope} {team}", body: "{nope}" }, data);
  assert.equal(e.subject, "{nope} U14 All Stars");
  assert.match(e.text, /^\{nope\}/);
});

test("saving the default stores nothing", () => {
  assert.deepEqual(cleanTemplate(DEFAULT_INVOICE_SUBJECT, DEFAULT_INVOICE_BODY), { subject: null, body: null });
  assert.deepEqual(cleanTemplate("  ", ""), { subject: null, body: null });
  assert.deepEqual(cleanTemplate("A\nB", "Hi\r\nthere"), { subject: "A B", body: "Hi\nthere" });
});

test("names and labels", () => {
  assert.equal(joinNames(["Ava", "Holden", "Jude"]), "Ava, Holden and Jude");
  assert.equal(invoiceLineLabel("Merch", "Jude Smith", true), "Merch (Jude)");
  assert.equal(invoiceLineLabel("Merch", "Jude Smith", false), "Merch");
});
