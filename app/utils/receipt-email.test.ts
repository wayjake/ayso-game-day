import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RECEIPT_BODY, DEFAULT_RECEIPT_SUBJECT, cleanReceiptTemplate, receiptDate, renderReceiptEmail, type ReceiptEmailData } from "./receipt-email.ts";

const data: ReceiptEmailData = {
  team: "U14 All Stars",
  coach: "Jake",
  family: "Holden & Jude Smith",
  players: ["Holden Smith", "Jude Smith"],
  cents: 8500,
  method: "Venmo",
  date: "2026-11-27",
  balanceCents: 3100,
  payUrl: "https://benchtalk.app/pay/abc",
};

test("the default receipt names the payment and what's left", () => {
  const email = renderReceiptEmail({ subject: null, body: null }, data);
  assert.equal(email.subject, "U14 All Stars: we got your $85.00 payment");
  assert.match(email.text, /got your payment of \$85\.00 for Holden and Jude\./);
  assert.match(email.text, /Paid with: Venmo/);
  assert.match(email.text, /Date: Nov 27, 2026/);
  assert.match(email.text, /You still owe \$31\.00 in all\./);
  assert.match(email.text, /Pay what's left here/);
  assert.match(email.html, /See it and pay \$31\.00/);
});

test("paid up and credit read right, and the button doesn't ask for money", () => {
  const paid = renderReceiptEmail({ subject: null, body: null }, { ...data, balanceCents: 0 });
  assert.match(paid.text, /You're all paid up\./);
  assert.match(paid.html, /See your invoices/);
  assert.doesNotMatch(paid.html, /pay \$/);
  const credit = renderReceiptEmail({ subject: null, body: null }, { ...data, balanceCents: -1500 });
  assert.match(credit.text, /You have \$15\.00 in credit with the team\./);
});

test("no pay link leaves the button out", () => {
  const email = renderReceiptEmail({ subject: null, body: null }, { ...data, payUrl: null });
  assert.doesNotMatch(email.text, /no sign-in/);
  assert.doesNotMatch(email.html, /<a /);
});

test("what the coach typed is escaped and placeholders fill in", () => {
  const email = renderReceiptEmail({ subject: "Thanks {family}!", body: "<b>Hi</b> {players}, {amount} by {method} on {date}." }, data);
  assert.equal(email.subject, "Thanks Holden & Jude Smith!");
  assert.match(email.html, /&lt;b&gt;Hi&lt;\/b&gt; Holden and Jude, \$85\.00 by Venmo on Nov 27, 2026\./);
  // A custom body without {pay_link} isn't given one
  assert.doesNotMatch(email.html, /<a /);
});

test("saving the default stores nothing", () => {
  assert.deepEqual(cleanReceiptTemplate(DEFAULT_RECEIPT_SUBJECT, DEFAULT_RECEIPT_BODY), { subject: null, body: null });
  assert.deepEqual(cleanReceiptTemplate("  Got it\n", "Thanks"), { subject: "Got it", body: "Thanks" });
});

test("dates print without a time zone shift", () => {
  assert.equal(receiptDate("2026-01-01"), "Jan 1, 2026");
  assert.equal(receiptDate("nope"), "nope");
});
