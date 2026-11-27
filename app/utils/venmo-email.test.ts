import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanVenmoNote,
  invoiceNumbersIn,
  parseGmailForwardingConfirmation,
  parseVenmoForwardAddress,
  parseVenmoPaymentEmail,
  refCodesIn,
  venmoForwardAddress,
} from "./venmo-email.ts";

// The shape of a real "paid you" email (Nov 2026), names and ids changed. Its
// text part is empty; everything is in the HTML.
const html = `<html><head><title>Pat Rivera paid you $356.00</title><style>.x{color:red}</style></head><body>
<span class="preheader" style="display:none">Pat Rivera paid you $356.00</span>
<p class="text-center secondary-text title" style="margin:0">Pat Rivera paid you</p>
<div class="amount-container"><div class="amount-container__text-high">$</div><div class="amount-container__amount-text">356</div><span style="display:none">.</span><div class="amount-container__text-high">00</div></div>
<p class="transaction-note secondary-text" style="margin:0;color:#6b6e76">U14+All+Stars+&middot;+invoice+#1</p>
<p class="text-center"><a class="venmo-button-v2" href="https://venmo.com/story/1?k=2">See transaction</a></p>
<h2 class="transaction-detail__title">Transaction details</h2>
<h3>Date</h3><p class="transaction-value">Nov 27, 2026</p>
<h3>Transaction ID</h3><p class="transaction-value">4739959702313630000</p>
<h3>Sent to</h3><p class="transaction-value"> @coach-sam </p>
</body></html>`;

test("reads a Venmo payment email", () => {
  const parsed = parseVenmoPaymentEmail({ subject: "Pat Rivera paid you $356.00", html, text: "" });
  assert.deepEqual(parsed, {
    payerName: "Pat Rivera",
    cents: 35600,
    note: "U14 All Stars · invoice #1",
    transactionId: "4739959702313630000",
    sentTo: "coach-sam",
    paidOn: "2026-11-27",
  });
});

test("amounts with commas, no cents, or a request", () => {
  assert.equal(parseVenmoPaymentEmail({ subject: "A B paid you $1,250.50", html: null, text: null })?.cents, 125050);
  assert.equal(parseVenmoPaymentEmail({ subject: "A B paid you $20", html: null, text: null })?.cents, 2000);
  assert.equal(parseVenmoPaymentEmail({ subject: "A B paid your $40.00 request", html: null, text: null })?.cents, 4000);
});

test("ignores anything that isn't money in", () => {
  for (const subject of ["You paid Pat Rivera $10.00", "Pat Rivera requests $10.00", "Your Venmo code is 123456", "Pat Rivera paid you $0.00", null]) {
    assert.equal(parseVenmoPaymentEmail({ subject, html, text: null }), null, String(subject));
  }
});

test("a note keeps real spaces and plus signs", () => {
  assert.equal(cleanVenmoNote("U14+All+Stars+·+invoice+#1"), "U14 All Stars · invoice #1");
  assert.equal(cleanVenmoNote("snacks + drinks"), "snacks + drinks");
  assert.equal(cleanVenmoNote("  Thunder · ref AB2CD  "), "Thunder · ref AB2CD");
});

test("finds invoice numbers and ref codes in a note", () => {
  assert.deepEqual(invoiceNumbersIn("U14 All Stars · invoice #3, #5"), [3, 5]);
  assert.deepEqual(invoiceNumbersIn("thanks!"), []);
  assert.deepEqual(invoiceNumbersIn(null), []);
  assert.deepEqual(refCodesIn("Thunder · ref ab2cd"), ["AB2CD"]);
  assert.deepEqual(refCodesIn("ref: XYZ23 and ref XYZ23"), ["XYZ23"]);
  // I, O, 0 and 1 aren't in ref codes
  assert.deepEqual(refCodesIn("ref ABCD1"), []);
});

test("forwarding addresses carry a team's token", () => {
  const token = "k7xm2pq9abcd";
  const address = venmoForwardAddress(token, "benchtalk.app");
  assert.equal(address, "venmo-k7xm2pq9abcd@benchtalk.app");
  assert.equal(parseVenmoForwardAddress("Venmo-K7XM2PQ9ABCD@BenchTalk.app", "benchtalk.app"), token);
  assert.equal(parseVenmoForwardAddress(address, "other.app"), null);
  assert.equal(parseVenmoForwardAddress("venmo-short@benchtalk.app", "benchtalk.app"), null);
  assert.equal(parseVenmoForwardAddress("venmo-k7xm2pq9abc1@benchtalk.app", "benchtalk.app"), null);
});

test("reads Gmail's forwarding confirmation code", () => {
  assert.deepEqual(
    parseGmailForwardingConfirmation("(#123456789) Gmail Forwarding Confirmation - Receive Mail from coach@example.com", ""),
    { code: "123456789", from: "coach@example.com" }
  );
  assert.deepEqual(parseGmailForwardingConfirmation("Gmail Forwarding Confirmation", "Confirmation code: 987654321"), { code: "987654321", from: null });
  assert.equal(parseGmailForwardingConfirmation("Pat Rivera paid you $5.00", ""), null);
});
