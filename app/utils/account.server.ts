import { and, eq, ne, sql } from "drizzle-orm";
import { db, users } from "~/db";
import { isOnSendingDomain, sendingDomain } from "~/utils/email.server";

// Settings that belong to the person, not a team: shared by the coach Account
// page and the family Settings page.

export type AccountResult = { intent: string; error: string } | { intent: string; success: string };

/** Handles the account forms (`_action` updateName / updateSendingEmail). Null when the intent isn't one of them. */
export async function accountAction(
  user: { id: number; role: string },
  formData: FormData,
): Promise<{ result: AccountResult; status: number } | null> {
  const intent = String(formData.get("_action") ?? "");
  const text = (key: string) => String(formData.get(key) ?? "").trim();

  if (intent === "updateName") {
    const name = text("name");
    if (!name) return { result: { intent, error: "Your name can't be empty" }, status: 400 };
    await db.update(users).set({ name, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
    return { result: { intent, success: "Saved" }, status: 200 };
  }

  if (intent === "updateSendingEmail") {
    // Only admins pick an address, and each address belongs to one account,
    // so nobody can send announcements as another coach
    if (user.role !== "admin") {
      return { result: { intent, error: "Ask the site owner to set up an address for you" }, status: 403 };
    }
    const address = text("sendingEmail").toLowerCase();
    if (address && (!/^[a-z0-9._+-]+@[a-z0-9.-]+$/.test(address) || !isOnSendingDomain(address))) {
      return { result: { intent, error: `Use an address ending in @${sendingDomain()}` }, status: 400 };
    }
    if (address) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(sql`lower(${users.sendingEmail}) = ${address}`, ne(users.id, user.id)))
        .limit(1);
      if (taken) return { result: { intent, error: "Another account already uses that address" }, status: 400 };
    }
    await db.update(users).set({ sendingEmail: address || null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(users.id, user.id));
    return {
      result: { intent, success: address ? `Announcements now come from ${address}` : "Using the shared address" },
      status: 200,
    };
  }

  return null;
}
