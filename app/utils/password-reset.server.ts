import crypto from "node:crypto";
import { db, users, passwordResets } from "~/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { escapeHtml, isEmailConfigured, sendEmail } from "~/utils/email.server";
import { hashPassword } from "~/utils/auth.server";
import { normalizeEmail } from "~/utils/invites.server";

const RESET_TTL_MINUTES = 60;

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function resetUrl(request: Request, token: string) {
  const origin = process.env.APP_URL?.replace(/\/$/, "") || new URL(request.url).origin;
  return `${origin}/user/reset-password/${token}`;
}

// Starts a reset for this email if an account exists. Callers show the same
// message either way, so the form can't be used to check who has an account.
// Returns `devLink` only when email isn't configured outside production, so
// local testing still works.
export async function requestPasswordReset(request: Request, email: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(sql`lower(${users.email}) = ${normalizeEmail(email)}`)
    .limit(1);

  if (!user) return { devLink: null };

  // Only the newest link works
  await db
    .update(passwordResets)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(passwordResets.userId, user.id), isNull(passwordResets.usedAt)));

  const token = crypto.randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString(),
  });

  const url = resetUrl(request, token);

  if (!isEmailConfigured()) {
    if (process.env.NODE_ENV === "production") {
      console.error("Password reset requested but email is not configured");
      return { devLink: null };
    }
    console.log(`Password reset link for ${user.email}: ${url}`);
    return { devLink: url };
  }

  const greeting = user.name ? `Hi ${user.name},` : "Hi,";
  await sendEmail({
    to: user.email,
    subject: "Reset your AYSO Game Day password",
    text: [
      greeting,
      ``,
      `Someone asked to reset the password for your AYSO Game Day account.`,
      `Choose a new password here: ${url}`,
      ``,
      `This link works once and expires in ${RESET_TTL_MINUTES} minutes.`,
      `If you didn't ask for this, you can ignore this email. Your password won't change.`,
    ].join("\n"),
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; color: #101B2D;">
        <p>${escapeHtml(greeting)}</p>
        <p>Someone asked to reset the password for your AYSO Game Day account.</p>
        <p style="margin: 24px 0;">
          <a href="${escapeHtml(url)}" style="background: #2251C4; color: #fff; padding: 12px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">Choose a new password</a>
        </p>
        <p style="color: #536175; font-size: 13px;">Or paste this link into your browser:<br>${escapeHtml(url)}</p>
        <p style="color: #536175; font-size: 13px;">This link works once and expires in ${RESET_TTL_MINUTES} minutes. If you didn't ask for this, ignore this email and your password won't change.</p>
      </div>
    `,
  });

  return { devLink: null };
}

// The pending reset for a token, or null if it's unknown, used or expired
export async function findValidReset(token: string) {
  const [reset] = await db
    .select({ id: passwordResets.id, userId: passwordResets.userId })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.tokenHash, hashToken(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, new Date().toISOString())
      )
    )
    .limit(1);
  return reset ?? null;
}

// Sets the new password and burns the token. Returns the user to sign in, or
// null if the link stopped being valid in the meantime.
export async function completePasswordReset(token: string, newPassword: string) {
  const reset = await findValidReset(token);
  if (!reset) return null;

  // Claim the token first so a double submit can't use it twice
  const claimed = await db
    .update(passwordResets)
    .set({ usedAt: new Date().toISOString() })
    .where(and(eq(passwordResets.id, reset.id), isNull(passwordResets.usedAt)))
    .returning({ id: passwordResets.id });
  if (claimed.length === 0) return null;

  await db
    .update(users)
    .set({ password: await hashPassword(newPassword), updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(users.id, reset.userId));

  const [user] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, reset.userId))
    .limit(1);
  return user ?? null;
}
