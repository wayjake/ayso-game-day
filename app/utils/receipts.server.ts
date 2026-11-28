import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, ledgerEntries, ledgerReceipts, ledgerTxns, players, teams, users } from "~/db";
import { familyEmails, payPath, payView, teamFamilies } from "~/utils/billing.server";
import { coachFromAddress, familyDeliveryAddress, isFamilyDeliveryRedirected, sendEmail } from "~/utils/email.server";
import { LedgerError, METHOD_LABELS } from "~/utils/ledger";
import { formatCents } from "~/utils/money";
import { renderReceiptEmail, type ReceiptEmailData, type ReceiptEmailTemplate } from "~/utils/receipt-email";
import { alertStaff } from "~/utils/staff-alerts.server";
import { teamPath } from "~/utils/team-path";

// Payment receipts: an email to the family once a payment is recorded, in the
// team's own words (utils/receipt-email.ts). Sent on its own when a Venmo
// payment is recorded, when staff tick "Email a receipt" on a payment they
// record or confirm, and any time later from the family's page. Each send is
// kept in ledgerReceipts. Like invoices, outside production it goes to the
// sender instead (familyDeliveryAddress).

export function appOrigin(request: Request) {
  return process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
}

export type ReceiptResult = { sent: true; to: string[] } | { sent: false; reason: string };

// Who a payment is for, worked out from its own lines (not from the form)
async function receiptContext(teamId: string, txnId: string) {
  const [txn] = await db.select().from(ledgerTxns).where(and(eq(ledgerTxns.id, txnId), eq(ledgerTxns.teamId, teamId))).limit(1);
  if (!txn || txn.kind !== "payment") throw new LedgerError("That isn't a payment on this team");
  const [reversal] = await db.select({ id: ledgerTxns.id }).from(ledgerTxns).where(eq(ledgerTxns.reversesId, txn.id)).limit(1);
  if (reversal) throw new LedgerError("That payment was undone, so there's nothing to send a receipt for");
  const lines = await db.select().from(ledgerEntries).where(eq(ledgerEntries.txnId, txn.id));
  const cash = lines.filter((l) => l.accountType === "cash").reduce((a, l) => a + l.cents, 0);
  const playerIds = [...new Set(lines.filter((l) => l.accountType === "player" && l.playerId).map((l) => l.playerId!))];
  const family = playerIds.length ? (await teamFamilies(db, teamId)).find((f) => f.members.some((m) => m.type === "player" && playerIds.includes(m.id))) ?? null : null;
  return { txn, cents: cash, playerIds, family };
}

// What a payment's receipt says, apart from the team's words. The balance is
// the family's as it stands now, so a receipt sent later shows what's left then.
async function receiptData(teamId: string, txnId: string, coach: string, origin: string) {
  const { txn, cents, playerIds, family } = await receiptContext(teamId, txnId);
  if (!family) return null;
  const familyIds = family.members.filter((m) => m.type === "player").map((m) => m.id);
  const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1);
  const kids = await db.select({ id: players.id, name: players.name }).from(players).where(and(eq(players.teamId, teamId), inArray(players.id, playerIds))).orderBy(asc(players.name));
  const { owed, dueBack } = await payView(teamId, familyIds);
  const path = payPath(teamId, family.key);
  const data: ReceiptEmailData = {
    team: team?.name ?? "Your team",
    coach,
    family: family.name,
    players: kids.map((k) => k.name),
    cents,
    method: txn.method ? METHOD_LABELS[txn.method] : "Other",
    date: txn.occurredOn,
    balanceCents: owed - dueBack,
    payUrl: path ? `${origin}${path}` : null,
  };
  return { data, familyIds, txn };
}

// For the editor's preview: the team's latest family payment, if there is one
export async function latestReceiptPreview(teamId: string, coach: string, origin: string) {
  const recent = await db
    .selectDistinct({ id: ledgerTxns.id })
    .from(ledgerTxns)
    .innerJoin(ledgerEntries, eq(ledgerEntries.txnId, ledgerTxns.id))
    .where(and(eq(ledgerTxns.teamId, teamId), eq(ledgerTxns.kind, "payment"), eq(ledgerEntries.accountType, "player")))
    .orderBy(desc(ledgerTxns.id))
    .limit(5);
  for (const r of recent) {
    try {
      const found = await receiptData(teamId, r.id, coach, origin);
      if (found) return found.data;
    } catch {
      // Undone: try the one before
    }
  }
  return null;
}

export async function sendReceipt(teamId: string, txnId: string, by: string, origin: string, again = false): Promise<ReceiptResult> {
  const [sender] = await db.select({ id: users.id, name: users.name, email: users.email, sendingEmail: users.sendingEmail }).from(users).where(eq(users.id, by)).limit(1);
  const [team] = await db
    .select({ id: teams.id, code: teams.code, name: teams.name, subject: teams.receiptEmailSubject, body: teams.receiptEmailBody })
    .from(teams)
    .where(eq(teams.id, teamId))
    .limit(1);
  if (!sender || !team) return { sent: false, reason: "Something's missing. Reload and try again." };
  const found = await receiptData(teamId, txnId, sender.name || sender.email.split("@")[0], origin);
  if (!found) return { sent: false, reason: "It was a staff member's own money, so there's no family to send it to" };
  const { data, familyIds, txn } = found;
  const emails = await familyEmails(teamId, familyIds);
  if (emails.length === 0) return { sent: false, reason: "There's no parent email on file for them" };

  const email = renderReceiptEmail({ subject: team.subject, body: team.body }, data);
  const from = coachFromAddress(sender, team);
  const sentTo: string[] = [];
  for (const to of emails) {
    const result = await sendEmail({
      to: familyDeliveryAddress(to, sender.email),
      from: from.header,
      replyTo: from.address,
      subject: email.subject,
      text: email.text,
      html: email.html,
      tags: [{ name: "kind", value: "receipt" }],
      idempotencyKey: `receipt-${txn.id}-${to}${again ? `-again-${Date.now()}` : ""}`.slice(0, 250),
    });
    if (result.sent) sentTo.push(to);
  }
  if (sentTo.length === 0) return { sent: false, reason: "The email didn't go out. Try again in a minute." };
  await db.insert(ledgerReceipts).values({ teamId, txnId: txn.id, sentTo: JSON.stringify(sentTo), sentBy: by });
  return { sent: true, to: sentTo };
}

// The same, for right after a payment posts: never throws, so a mail problem
// can't make a recorded payment look like it failed
export async function sendReceiptQuietly(teamId: string, txnId: string, by: string, origin: string): Promise<ReceiptResult> {
  try {
    return await sendReceipt(teamId, txnId, by, origin);
  } catch (e) {
    console.error("Receipt failed:", e);
    return { sent: false, reason: "The email didn't go out" };
  }
}

// After a payment posts: the receipt (when asked for), then tell the rest of
// the staff. `duplicate`: the form was sent twice and nothing new posted.
export async function afterPayment(input: {
  teamId: string;
  txnId: string;
  duplicate: boolean;
  by: { id: string; name: string | null; email: string };
  receipt: boolean;
  origin: string;
  how: string; // "a Venmo payment", "a cash payment"…
}) {
  if (input.duplicate) return null;
  const receipt = input.receipt ? await sendReceiptQuietly(input.teamId, input.txnId, input.by.id, input.origin) : null;
  try {
    const { cents, family } = await receiptContext(input.teamId, input.txnId);
    const [team] = await db.select({ code: teams.code }).from(teams).where(eq(teams.id, input.teamId)).limit(1);
    const who = input.by.name || input.by.email.split("@")[0];
    const forWhom = family?.name ?? "a staff member";
    const receiptLine = !receipt ? "No receipt was sent." : receipt.sent ? "The family got a receipt by email." : `No receipt: ${receipt.reason.toLowerCase()}.`;
    await alertStaff(
      input.teamId,
      "paymentsRecorded",
      {
        title: `${who} recorded ${formatCents(cents)} from ${forWhom}`,
        body: `${input.how[0].toUpperCase()}${input.how.slice(1)}. ${receiptLine}`,
        url: team ? teamPath(team.code, "finances") : "/dashboard",
        tag: `ledger-recorded-${input.txnId}`,
        emailKey: `recorded-${input.txnId}`,
      },
      { exclude: input.by.id, actor: input.by, origin: input.origin }
    );
  } catch (e) {
    console.error("Payment alert failed:", e);
  }
  return receipt;
}

// What the payment form says once it's saved
export function receiptMessage(receipt: ReceiptResult | null) {
  if (!receipt) return { message: "Recorded." };
  if (!receipt.sent) return { message: `Recorded, but no receipt went out: ${lowerFirst(receipt.reason)}`, warn: true };
  return { message: `Recorded. Receipt emailed to ${receipt.to.join(", ")}${isFamilyDeliveryRedirected() ? " (sent to you instead while testing)" : ""}.` };
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// "Send receipt" on a payment that's already recorded, any time later
export async function sendReceiptNow(teamId: string, txnId: string, by: string, origin: string) {
  const before = await receiptsByTxn(teamId, [txnId]);
  const result = await sendReceipt(teamId, txnId, by, origin, Boolean(before[txnId]));
  if (!result.sent) throw new LedgerError(result.reason);
  return { message: `Receipt emailed to ${result.to.join(", ")}.` };
}

// When each payment's receipt last went out, and how many times
export async function receiptsByTxn(teamId: string, txnIds?: string[]) {
  const rows = await db
    .select({ txnId: ledgerReceipts.txnId, createdAt: ledgerReceipts.createdAt })
    .from(ledgerReceipts)
    .where(and(eq(ledgerReceipts.teamId, teamId), ...(txnIds ? [inArray(ledgerReceipts.txnId, txnIds.length ? txnIds : [""])] : [])))
    .orderBy(asc(ledgerReceipts.id));
  const out: Record<string, { lastAt: string; count: number }> = {};
  for (const r of rows) out[r.txnId] = { lastAt: r.createdAt, count: (out[r.txnId]?.count ?? 0) + 1 };
  return out;
}

export async function saveReceiptTemplate(teamId: string, template: ReceiptEmailTemplate) {
  await db.update(teams).set({ receiptEmailSubject: template.subject, receiptEmailBody: template.body, updatedAt: new Date().toISOString() }).where(eq(teams.id, teamId));
}
