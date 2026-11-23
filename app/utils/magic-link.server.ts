import crypto from "node:crypto";
import { db, contacts, guardians, loginLinks, players, users } from "~/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createUser } from "~/utils/auth.server";
import { escapeHtml, isEmailConfigured, sendEmail } from "~/utils/email.server";
import { normalizeEmail } from "~/utils/invites.server";
import { linkFamily } from "~/utils/parent-invites.server";

// Passwordless sign-in for families. Any email that's on a player's contact
// list (or already linked to a player) can ask for a link. Using it signs them
// in, creating a parent account if needed, and links every player whose
// contacts list that email, on every team.

const LINK_TTL_MINUTES = 20;
// One email per address per minute, so the form can't be used to flood an inbox
const RESEND_AFTER_SECONDS = 60;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
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
// roster. Returns `devLink` only when email isn't configured outside
// production, so local testing still works.
export async function requestMagicLink(request: Request, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (!(await isEligible(email))) return { devLink: null };

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
  if (recent) return { devLink: null };

  // Only the newest link works
  await db
    .update(loginLinks)
    .set({ usedAt: new Date(now).toISOString() })
    .where(and(eq(loginLinks.email, email), isNull(loginLinks.usedAt)));

  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(loginLinks).values({
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(now + LINK_TTL_MINUTES * 60_000).toISOString(),
  });

  const url = magicLinkUrl(request, token);

  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error("Sign-in link requested but email is not configured");
      return { devLink: null };
    }
    console.log(`Sign-in link for ${email}: ${url}`);
    return { devLink: url };
  }

  await sendEmail({
    to: email,
    subject: "Your AYSO Game Day sign-in link",
    text: [
      `Sign in to AYSO Game Day to see the schedule, RSVP and message the coaches:`,
      url,
      ``,
      `This link works once and expires in ${LINK_TTL_MINUTES} minutes.`,
      `If you didn't ask for it, you can ignore this email.`,
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; color: #101B2D;">
        <p>Sign in to AYSO Game Day to see the schedule, RSVP and message the coaches.</p>
        <p style="margin: 24px 0;">
          <a href="${escapeHtml(url)}" style="background: #2251C4; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Sign in</a>
        </p>
        <p style="color: #536175; font-size: 13px;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
        <p style="color: #536175; font-size: 13px;">This link works once and expires in ${LINK_TTL_MINUTES} minutes. If you didn't ask for it, ignore this email.</p>
      </div>
    `,
  });

  return { devLink: null };
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
