import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, guardians, inboundEmails, ledgerClaims, ledgerInvoices, ledgerTxns, ledgerVenmoPayments, teams } from "~/db";
import { familyMembersFromKey, teamFamilies, type Family } from "~/utils/billing.server";
import { sendingDomain, type ReceivedEmail } from "~/utils/email.server";
import { getHeader, parseAddress } from "~/utils/email-reply";
import { getCoachUserIds } from "~/utils/family.server";
import { familyRefCode, memberKey, parsePlayerIds, recordPayment, teamCodeFor } from "~/utils/ledger.server";
import { LedgerError } from "~/utils/ledger";
import { formatCents } from "~/utils/money";
import { sendPush } from "~/utils/push.server";
import { teamPath } from "~/utils/team-path";
import {
  GMAIL_FORWARDING_SENDER,
  VENMO_SENDER,
  VENMO_TOKEN_ALPHABET,
  VENMO_TOKEN_LENGTH,
  invoiceNumbersIn,
  parseGmailForwardingConfirmation,
  parseVenmoForwardAddress,
  parseVenmoPaymentEmail,
  refCodesIn,
  venmoDmarcPassed,
  venmoForwardAddress,
} from "~/utils/venmo-email";

// Venmo's "paid you" emails, forwarded by the coach's inbox to the team's
// Venmo address, become payments to record with one tap. Nothing posts on its
// own: staff check and tap Record it. Rules for reading the emails are in
// venmo-email.ts.

function newToken() {
  return Array.from({ length: VENMO_TOKEN_LENGTH }, () => VENMO_TOKEN_ALPHABET[crypto.randomInt(VENMO_TOKEN_ALPHABET.length)]).join("");
}

// The team's address, made the first time anyone asks. Null when the app has
// no sending domain (no EMAIL_FROM).
export async function teamVenmoAddress(teamId: string) {
  const domain = sendingDomain();
  if (!domain) return null;
  const [team] = await db.select({ token: teams.venmoEmailToken }).from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return null;
  if (team.token) return venmoForwardAddress(team.token, domain);
  await db.update(teams).set({ venmoEmailToken: newToken() }).where(and(eq(teams.id, teamId), sql`${teams.venmoEmailToken} is null`));
  const [again] = await db.select({ token: teams.venmoEmailToken }).from(teams).where(eq(teams.id, teamId)).limit(1);
  return again?.token ? venmoForwardAddress(again.token, domain) : null;
}

// Every address the email was delivered to. A forwarded email keeps its own
// To (the coach's address), so the forwarding address may only be in the
// delivery headers.
function deliveredTo(email: ReceivedEmail) {
  const values = [
    ...(email.to ?? []),
    ...["x-forwarded-to", "delivered-to", "x-original-to", "envelope-to"].map((h) => getHeader(email.headers, h) ?? ""),
  ];
  return values
    .flatMap((v) => v.split(/[,\s]+/))
    .map((v) => parseAddress(v)?.address ?? null)
    .filter((a): a is string => Boolean(a));
}

async function teamForToken(addresses: string[]) {
  const domain = sendingDomain();
  if (!domain) return null;
  for (const address of addresses) {
    const token = parseVenmoForwardAddress(address, domain);
    if (!token) continue;
    const [team] = await db.select({ id: teams.id, venmoHandle: teams.venmoHandle }).from(teams).where(eq(teams.venmoEmailToken, token)).limit(1);
    if (team) return team;
  }
  return null;
}

// Who a payment is from, by what its note says: invoice numbers first (the pay
// link), then a ref code (the family app), then whoever this payer was last time
async function matchFamily(teamId: string, note: string | null, payerName: string, families: Family[]) {
  const byMember = new Map<string, Family>();
  for (const f of families) for (const m of f.members) byMember.set(memberKey(m), f);
  const currentFamily = (key: string) => {
    const first = familyMembersFromKey(key)[0];
    return first ? byMember.get(memberKey(first)) ?? null : null;
  };

  const numbers = invoiceNumbersIn(note);
  if (numbers.length) {
    const invoices = await db
      .select({ familyKey: ledgerInvoices.familyKey })
      .from(ledgerInvoices)
      .where(and(eq(ledgerInvoices.teamId, teamId), inArray(ledgerInvoices.number, numbers)));
    const found = new Set(invoices.map((i) => currentFamily(i.familyKey)?.key).filter(Boolean));
    if (found.size === 1) return { familyKey: [...found][0]!, matchedBy: "invoice" as const };
  }

  const codes = refCodesIn(note);
  if (codes.length) {
    const parents = await db.select({ userId: guardians.userId, playerId: guardians.playerId }).from(guardians).where(eq(guardians.teamId, teamId));
    const found = new Set<string>();
    for (const p of parents) {
      if (!codes.includes(familyRefCode(teamId, p.userId))) continue;
      const family = byMember.get(memberKey({ type: "player", id: p.playerId }));
      if (family) found.add(family.key);
    }
    if (found.size === 1) return { familyKey: [...found][0], matchedBy: "ref" as const };
  }

  const [before] = await db
    .select({ familyKey: ledgerVenmoPayments.familyKey })
    .from(ledgerVenmoPayments)
    .where(
      and(
        eq(ledgerVenmoPayments.teamId, teamId),
        eq(ledgerVenmoPayments.status, "recorded"),
        sql`lower(${ledgerVenmoPayments.payerName}) = ${payerName.toLowerCase()}`
      )
    )
    .orderBy(desc(ledgerVenmoPayments.id))
    .limit(1);
  const family = before?.familyKey ? currentFamily(before.familyKey) : null;
  if (family) return { familyKey: family.key, matchedBy: "payer" as const };
  return { familyKey: null, matchedBy: null };
}

// Called for every received email, after it's stored. True when it was a
// Venmo email or Gmail's forwarding confirmation, which never go to families
// or "Emails to sort".
export async function receiveVenmoEmail(inbound: typeof inboundEmails.$inferSelect, email: ReceivedEmail) {
  const addresses = deliveredTo(email);
  const team = await teamForToken(addresses);

  if (inbound.fromEmail === GMAIL_FORWARDING_SENDER && team) {
    // Kept so Finances → Venmo can show the code
    await db.update(inboundEmails).set({ status: "dismissed", matchedBy: "gmail-forwarding", teamId: team.id }).where(eq(inboundEmails.id, inbound.id));
    return true;
  }

  if (inbound.fromEmail !== VENMO_SENDER) {
    if (!team) return false;
    // Something else sent to the Venmo address: keep it out of everyone's way
    await db.update(inboundEmails).set({ status: "dismissed", matchedBy: "venmo", teamId: team.id }).where(eq(inboundEmails.id, inbound.id));
    return true;
  }

  const parsed = parseVenmoPaymentEmail({ subject: email.subject, html: email.html, text: email.text });
  const verified = venmoDmarcPassed(email.authentication, email.headers);
  // No forwarding address: the Venmo account it was paid to can still say
  // which team, but only from an email that really is Venmo's (anyone can see
  // a team's handle on its pay page)
  let teamId = team?.id ?? null;
  if (!teamId && verified && parsed?.sentTo) {
    const byHandle = await db
      .select({ id: teams.id })
      .from(teams)
      .where(sql`lower(${teams.venmoHandle}) = ${parsed.sentTo.toLowerCase()}`)
      .limit(2);
    if (byHandle.length === 1) teamId = byHandle[0].id;
  }
  if (!teamId) return false;

  // A Venmo email that isn't money in (a payment the coach sent, a login
  // code): not the team's business, so its text isn't kept
  await db
    .update(inboundEmails)
    .set({ status: "dismissed", matchedBy: "venmo", teamId, ...(parsed ? {} : { text: null }) })
    .where(eq(inboundEmails.id, inbound.id));
  if (!parsed) return true;

  const families = await teamFamilies(db, teamId);
  const match = await matchFamily(teamId, parsed.note, parsed.payerName, families);
  const [row] = await db
    .insert(ledgerVenmoPayments)
    .values({
      teamId,
      inboundEmailId: inbound.id,
      venmoTxnId: parsed.transactionId ?? `email:${inbound.emailMessageId ?? inbound.id}`,
      payerName: parsed.payerName.slice(0, 120),
      cents: parsed.cents,
      note: parsed.note?.slice(0, 300) ?? null,
      sentTo: parsed.sentTo,
      paidOn: parsed.paidOn,
      familyKey: match.familyKey,
      matchedBy: match.matchedBy,
      verified,
    })
    .onConflictDoNothing()
    .returning();
  if (!row) return true; // Already had this one (forwarded twice)

  const family = match.familyKey ? families.find((f) => f.key === match.familyKey) : null;
  await sendPush(await getCoachUserIds(teamId), "payments", {
    title: verified
      ? `${parsed.payerName} paid you ${formatCents(parsed.cents)} on Venmo`
      : `Check Venmo: an email says ${parsed.payerName} paid ${formatCents(parsed.cents)}`,
    body: !verified
      ? "We couldn't confirm it came from Venmo. Check your Venmo app before you record it."
      : family
        ? `For ${family.name}. Tap to record it.`
        : "Tap to pick who it's for and record it.",
    url: teamPath(await teamCodeFor(teamId), "finances"),
    tag: `ledger-venmo-${row.id}`,
  });
  return true;
}

// ---------------------------------------------------------------------------
// For staff

export async function pendingVenmoPayments(teamId: string) {
  return db
    .select()
    .from(ledgerVenmoPayments)
    .where(and(eq(ledgerVenmoPayments.teamId, teamId), eq(ledgerVenmoPayments.status, "pending")))
    .orderBy(asc(ledgerVenmoPayments.id));
}

export async function countPendingVenmo(teamId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(ledgerVenmoPayments)
    .where(and(eq(ledgerVenmoPayments.teamId, teamId), eq(ledgerVenmoPayments.status, "pending")));
  return Number(row?.n ?? 0);
}

// A family's "I sent a payment" for the same amount: recording the Venmo
// payment confirms it too, so the money isn't counted twice
async function matchingClaim(teamId: string, playerIds: string[], cents: number) {
  if (playerIds.length === 0) return null;
  const claims = await db
    .select()
    .from(ledgerClaims)
    .where(and(eq(ledgerClaims.teamId, teamId), eq(ledgerClaims.status, "pending"), eq(ledgerClaims.cents, cents)))
    .orderBy(asc(ledgerClaims.id));
  return claims.find((c) => parsePlayerIds(c.playerIds).some((id) => playerIds.includes(id))) ?? null;
}

export async function pendingClaimIdsCoveredByVenmo(teamId: string, rows: { familyKey: string | null; cents: number }[]) {
  const ids: string[] = [];
  for (const row of rows) {
    if (!row.familyKey) continue;
    const playerIds = familyMembersFromKey(row.familyKey).filter((m) => m.type === "player").map((m) => m.id);
    const claim = await matchingClaim(teamId, playerIds, row.cents);
    if (claim && !ids.includes(claim.id)) ids.push(claim.id);
  }
  return ids;
}

async function venmoClientKey(teamId: string, venmoTxnId: string) {
  const base = `venmo:${venmoTxnId}`.slice(0, 90);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(ledgerTxns)
    .where(and(eq(ledgerTxns.teamId, teamId), sql`(${ledgerTxns.clientKey} = ${base} or ${ledgerTxns.clientKey} like ${`${base}:%`})`));
  const used = Number(row?.n ?? 0);
  return used === 0 ? base : `${base}:${used + 1}`;
}

export async function recordVenmoPayment(teamId: string, venmoId: string, familyKey: string, by: string) {
  const [row] = await db
    .select()
    .from(ledgerVenmoPayments)
    .where(and(eq(ledgerVenmoPayments.id, venmoId), eq(ledgerVenmoPayments.teamId, teamId)))
    .limit(1);
  if (!row || row.status !== "pending") throw new LedgerError("Someone already handled that payment");
  const family = (await teamFamilies(db, teamId)).find((f) => f.key === familyKey);
  if (!family) throw new LedgerError("Pick who it's for");

  const playerIds = family.members.filter((m) => m.type === "player").map((m) => m.id);
  const claim = await matchingClaim(teamId, playerIds, row.cents);
  const { txnId } = await recordPayment({
    teamId,
    members: family.members,
    cents: row.cents,
    method: "venmo",
    occurredOn: row.paidOn,
    payerName: row.payerName,
    payerUserId: claim?.userId ?? null,
    claimId: claim?.id,
    memo: row.note ? `Venmo: ${row.note}` : "Venmo",
    createdBy: by,
    // Venmo's own id: the same payment posts once. Undone and recorded
    // again, it gets the next number, since the first key is spent.
    clientKey: await venmoClientKey(teamId, row.venmoTxnId),
  });
  await db
    .update(ledgerVenmoPayments)
    .set({ status: "recorded", familyKey, txnId, resolvedBy: by, resolvedAt: new Date().toISOString() })
    .where(eq(ledgerVenmoPayments.id, row.id));
}

export async function dismissVenmoPayment(teamId: string, venmoId: string, by: string) {
  await db
    .update(ledgerVenmoPayments)
    .set({ status: "dismissed", resolvedBy: by, resolvedAt: new Date().toISOString() })
    .where(and(eq(ledgerVenmoPayments.id, venmoId), eq(ledgerVenmoPayments.teamId, teamId), eq(ledgerVenmoPayments.status, "pending")));
}

// What the setup page shows: the address, Gmail's code while it's fresh, and
// whether anything has arrived yet
export async function venmoSetupStatus(teamId: string) {
  const address = await teamVenmoAddress(teamId);
  const [confirmation] = await db
    .select({ subject: inboundEmails.subject, text: inboundEmails.text, receivedAt: inboundEmails.receivedAt })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.teamId, teamId), eq(inboundEmails.matchedBy, "gmail-forwarding")))
    .orderBy(desc(inboundEmails.id))
    .limit(1);
  const gmail = confirmation ? parseGmailForwardingConfirmation(confirmation.subject, confirmation.text) : null;
  const fresh = confirmation && Date.now() - new Date(confirmation.receivedAt).getTime() < 7 * 24 * 3600 * 1000;
  const [latest] = await db
    .select({ createdAt: ledgerVenmoPayments.createdAt, payerName: ledgerVenmoPayments.payerName, cents: ledgerVenmoPayments.cents })
    .from(ledgerVenmoPayments)
    .where(eq(ledgerVenmoPayments.teamId, teamId))
    .orderBy(desc(ledgerVenmoPayments.id))
    .limit(1);
  const [any] = await db
    .select({ receivedAt: inboundEmails.receivedAt })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.teamId, teamId), eq(inboundEmails.matchedBy, "venmo")))
    .orderBy(desc(inboundEmails.id))
    .limit(1);
  return {
    address,
    gmailCode: gmail && fresh ? { ...gmail, receivedAt: confirmation!.receivedAt } : null,
    lastPayment: latest ?? null,
    lastVenmoEmailAt: any?.receivedAt ?? null,
  };
}

// For the Finances page's Venmo card: has a forwarded Venmo email ever arrived?
export async function venmoAutoStatus(teamId: string) {
  const [any] = await db
    .select({ receivedAt: inboundEmails.receivedAt })
    .from(inboundEmails)
    .where(and(eq(inboundEmails.teamId, teamId), eq(inboundEmails.matchedBy, "venmo")))
    .orderBy(desc(inboundEmails.id))
    .limit(1);
  return { lastAt: any?.receivedAt ?? null };
}

// The Finances tab's badge: Venmo payments to record, plus families' "I sent
// a payment" not already covered by one of them
export async function countPaymentsToConfirm(teamId: string) {
  const venmo = await pendingVenmoPayments(teamId);
  const covered = await pendingClaimIdsCoveredByVenmo(teamId, venmo);
  const [row] = await db
    .select({ n: sql<number>`count(*)` })
    .from(ledgerClaims)
    .where(and(eq(ledgerClaims.teamId, teamId), eq(ledgerClaims.status, "pending")));
  return venmo.length + Number(row?.n ?? 0) - covered.length;
}
