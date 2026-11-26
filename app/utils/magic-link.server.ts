import crypto from "node:crypto";
import { redirect } from "react-router";
import { commitSession, getSession } from "~/sessions.server";
import { isParent } from "~/utils/family.server";
import { db, contacts, guardians, loginLinks, players, users } from "~/db";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createUser } from "~/utils/auth.server";
import { escapeHtml, isEmailConfigured, sendEmail } from "~/utils/email.server";
import { normalizeEmail } from "~/utils/invites.server";
import { linkFamily } from "~/utils/parent-invites.server";

// Passwordless sign-in for families. Any email that's on a player's contact
// list (or already linked to a player) can ask for a link. Using it signs them
// in, creating a parent account if needed, and links every player whose
// contacts list that email, on every team.
//
// The same email carries a 6-digit code. Links always open in the phone's
// browser, never the Home Screen app, so a family whose installed app got
// signed out types the code into the app instead.

const LINK_TTL_MINUTES = 20;
// One email per address per minute, so the form can't be used to flood an inbox
const RESEND_AFTER_SECONDS = 60;
// Wrong codes allowed per email before the link and code stop working
const MAX_CODE_ATTEMPTS = 5;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// Salted with the email so one code's hash says nothing about another's
function hashCode(email: string, code: string) {
  return hashToken(`${email}:${code}`);
}

/** Digits only, so "123 456" and "123-456" work too. */
export function normalizeCode(raw: string) {
  return raw.replace(/\D/g, "");
}

function formatCode(code: string) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function magicLinkUrl(request: Request, token: string) {
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${origin}/user/magic-link/${token}`;
}

const matchesEmail = (column: typeof contacts.email | typeof users.email, email: string) =>
  sql`lower(trim(${column})) = ${email}`;

// Teams with a player whose contacts list this email
async function teamsForEmail(email: string) {
  const rows = await db
    .selectDistinct({ teamId: players.teamId })
    .from(contacts)
    .innerJoin(players, eq(contacts.playerId, players.id))
    .where(and(matchesEmail(contacts.email, email), eq(contacts.teamId, players.teamId)));
  return rows.map((r) => r.teamId);
}

async function findUserByEmail(email: string) {
  const [user] = await db.select().from(users).where(matchesEmail(users.email, email)).limit(1);
  return user ?? null;
}

async function isEligible(email: string) {
  if ((await teamsForEmail(email)).length > 0) return true;
  // Already linked, e.g. joined from an invite under this email before the contact changed
  const user = await findUserByEmail(email);
  if (!user) return false;
  const [link] = await db.select({ id: guardians.id }).from(guardians).where(eq(guardians.userId, user.id)).limit(1);
  return Boolean(link);
}

// The family's name as the coach entered it, for a new account
async function contactName(email: string) {
  const [row] = await db
    .select({ name: contacts.name })
    .from(contacts)
    .where(and(matchesEmail(contacts.email, email), sql`${contacts.playerId} is not null`))
    .limit(1);
  const name = row?.name?.trim();
  return name && name.toLowerCase() !== email ? name : undefined;
}

// Sends a sign-in link if this email belongs to a family. Callers show the
// same message either way, so the form can't be used to look up who's on a
// roster. Returns `devLink`/`devCode` only when email isn't configured
// outside production, so local testing still works.
export async function requestMagicLink(request: Request, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const none = { devLink: null, devCode: null };
  if (!(await isEligible(email))) return none;

  const now = Date.now();
  const [recent] = await db
    .select({ id: loginLinks.id })
    .from(loginLinks)
    .where(
      and(
        eq(loginLinks.email, email),
        isNull(loginLinks.usedAt),
        // Created less than a minute ago
        gt(loginLinks.expiresAt, new Date(now + (LINK_TTL_MINUTES * 60 - RESEND_AFTER_SECONDS) * 1000).toISOString())
      )
    )
    .limit(1);
  // The code in the email they already have still works
  if (recent) return none;

  // Only the newest link works
  await db
    .update(loginLinks)
    .set({ usedAt: new Date(now).toISOString() })
    .where(and(eq(loginLinks.email, email), isNull(loginLinks.usedAt)));

  const token = crypto.randomBytes(32).toString("base64url");
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(loginLinks).values({
    email,
    tokenHash: hashToken(token),
    codeHash: hashCode(email, code),
    expiresAt: new Date(now + LINK_TTL_MINUTES * 60_000).toISOString(),
  });

  const url = magicLinkUrl(request, token);

  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error("Sign-in link requested but email is not configured");
      return none;
    }
    console.log(`Sign-in link for ${email}: ${url} (code ${code})`);
    return { devLink: url, devCode: code };
  }

  await sendEmail({
    to: email,
    // The code in the subject shows on a lock-screen preview, so it can be typed without opening Mail
    subject: `${formatCode(code)} is your BenchTalk sign-in code`,
    text: [
      `Sign in to BenchTalk to see the schedule, RSVP and message the coaches:`,
      url,
      ``,
      `Using the BenchTalk app on your Home Screen? Enter this code there instead: ${formatCode(code)}`,
      ``,
      `The link and code work once and expire in ${LINK_TTL_MINUTES} minutes.`,
      `If you didn't ask for it, you can ignore this email.`,
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; color: #101B2D;">
        <p>Sign in to BenchTalk to see the schedule, RSVP and message the coaches.</p>
        <p style="margin: 24px 0;">
          <a href="${escapeHtml(url)}" style="background: #2251C4; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Sign in</a>
        </p>
        <p style="color: #536175; font-size: 13px;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
        <p style="margin: 24px 0 4px;">Using the BenchTalk app on your Home Screen? Enter this code there instead:</p>
        <p style="margin: 0 0 24px; font-size: 32px; font-weight: 700; letter-spacing: 6px; font-family: ui-monospace, Menlo, monospace;">${formatCode(code)}</p>
        <p style="color: #536175; font-size: 13px;">The link and code work once and expire in ${LINK_TTL_MINUTES} minutes. If you didn't ask for them, ignore this email.</p>
      </div>
    `,
  });

  return none;
}

// The pending link for a token, or null if it's unknown, used or expired
export async function findValidMagicLink(token: string) {
  const [link] = await db
    .select({ id: loginLinks.id, email: loginLinks.email })
    .from(loginLinks)
    .where(
      and(
        eq(loginLinks.tokenHash, hashToken(token)),
        isNull(loginLinks.usedAt),
        gt(loginLinks.expiresAt, new Date().toISOString())
      )
    )
    .limit(1);
  return link ?? null;
}

// Burns the token and returns the user to sign in (creating a parent account
// on first use), with their kids linked. Null if the link stopped being valid.
export async function completeMagicLink(token: string) {
  const link = await findValidMagicLink(token);
  if (!link) return null;
  return signInWithLink(link);
}

type SignedInUser = NonNullable<Awaited<ReturnType<typeof signInWithLink>>>;

// Sets the session for a link or code sign-in and sends them on. Parents stay
// signed in for a month, since they open this from a phone's Home Screen, and
// ?install=1 has the family app start with how to put it there (phones only;
// the installed app itself never shows it).
export async function signInFamilyRedirect(request: Request, user: SignedInUser) {
  const session = await getSession(request.headers.get("Cookie"));
  session.set("userId", user.id);
  session.set("userEmail", user.email);
  session.set("userRole", user.role);
  return redirect((await isParent(user.id)) ? "/family?install=1" : "/dashboard", {
    headers: { "Set-Cookie": await commitSession(session, { maxAge: 60 * 60 * 24 * 30 }) },
  });
}

export type CodeResult =
  | { ok: true; user: SignedInUser }
  | { ok: false; error: string };

// The typed-code twin of completeMagicLink, checked against the newest pending
// link for this email. After MAX_CODE_ATTEMPTS wrong codes the link (and its
// code) stop working, so guessing 1 in a million five times gets nowhere.
export async function completeMagicCode(rawEmail: string, rawCode: string): Promise<CodeResult> {
  const email = normalizeEmail(rawEmail);
  const code = normalizeCode(rawCode);
  const expired = { ok: false as const, error: "That code has expired or was already used. Send a new one." };
  if (code.length !== 6) return { ok: false, error: "Enter the 6-digit code from the email." };

  const [link] = await db
    .select({ id: loginLinks.id, email: loginLinks.email, codeHash: loginLinks.codeHash })
    .from(loginLinks)
    .where(and(eq(loginLinks.email, email), isNull(loginLinks.usedAt), gt(loginLinks.expiresAt, new Date().toISOString())))
    .orderBy(desc(loginLinks.id))
    .limit(1);
  if (!link?.codeHash) return expired;

  // Spend an attempt before comparing, in one statement, so parallel guesses can't share one
  const [spent] = await db
    .update(loginLinks)
    .set({ codeAttempts: sql`${loginLinks.codeAttempts} + 1` })
    .where(and(eq(loginLinks.id, link.id), isNull(loginLinks.usedAt), sql`${loginLinks.codeAttempts} < ${MAX_CODE_ATTEMPTS}`))
    .returning({ attempts: loginLinks.codeAttempts });
  if (!spent) return expired;

  const matches = crypto.timingSafeEqual(Buffer.from(link.codeHash, "hex"), Buffer.from(hashCode(email, code), "hex"));
  if (!matches) {
    const left = MAX_CODE_ATTEMPTS - spent.attempts;
    if (left <= 0) {
      await db.update(loginLinks).set({ usedAt: new Date().toISOString() }).where(eq(loginLinks.id, link.id));
      return { ok: false, error: "Too many wrong codes. Send a new one." };
    }
    return { ok: false, error: `That code doesn't match. ${left} ${left === 1 ? "try" : "tries"} left.` };
  }

  const user = await signInWithLink(link);
  return user ? { ok: true, user } : expired;
}

async function signInWithLink(link: { id: string; email: string }) {
  // Claim the token first so a double submit can't use it twice
  const claimed = await db
    .update(loginLinks)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(loginLinks.id, link.id), isNull(loginLinks.usedAt)))
    .returning({ id: loginLinks.id });
  if (claimed.length === 0) return null;

  let user = await findUserByEmail(link.email);
  if (!user) {
    // No password: they sign in with links (or set one with "Forgot password")
    const unusable = crypto.randomBytes(32).toString("base64url");
    user = await createUser(link.email, unusable, { name: await contactName(link.email), role: "parent" });
  }

  // Pick up any kids added to a roster since they last signed in
  for (const teamId of await teamsForEmail(link.email)) {
    await linkFamily(teamId, link.email, user.id);
  }

  return { id: user.id, email: user.email, role: user.role };
}
