import { inArray } from "drizzle-orm";
import { db, users } from "~/db";
import { escapeHtml, isFamilyDeliveryRedirected, sendEmail } from "~/utils/email.server";
import { getCoachUserIds } from "~/utils/family.server";
import { parseNotifyPrefs, wantsNotification, type NotifyKind } from "~/utils/notify";
import { sendPush, type PushPayload } from "~/utils/push.server";

// Payment alerts for a team's staff: a push, and an email for the kinds that
// can come by email (utils/notify.ts), each to whoever on staff wants it.
// Never throws, so an alert can't undo or fail the action that caused it.
//
// Outside production (and on preview deploys, which share the production
// database) staff alert emails go only to the staff member who did the thing,
// or nowhere when it wasn't staff (a Venmo email arriving, a family's "I sent
// it"), so testing never emails a real coach.

export type StaffAlert = PushPayload & {
  /** The email's opening lines; the push body is used when left out */
  emailText?: string;
  /** One email per address per key, so a retry doesn't send it twice */
  emailKey?: string;
};

export async function alertStaff(
  teamId: string,
  kind: NotifyKind,
  alert: StaffAlert,
  opts: { exclude?: string | null; actor?: { email: string } | null; origin?: string } = {}
) {
  try {
    const staffIds = (await getCoachUserIds(teamId)).filter((id) => id !== opts.exclude);
    if (staffIds.length === 0) return;
    await sendPush(staffIds, kind, alert);

    const rows = await db.select({ id: users.id, email: users.email, prefs: users.notifyPrefs }).from(users).where(inArray(users.id, staffIds));
    const wanting = rows.filter((r) => wantsNotification(parseNotifyPrefs(r.prefs), kind, "email"));
    if (wanting.length === 0) return;
    const to = isFamilyDeliveryRedirected() ? (opts.actor ? [opts.actor.email] : []) : wanting.map((r) => r.email);

    const origin = opts.origin ?? process.env.APP_URL?.replace(/\/$/, "") ?? "";
    const url = alert.url ? `${origin}${alert.url}` : null;
    const lines = (alert.emailText ?? alert.body).split(/\n\s*\n/).map((l) => l.trim()).filter(Boolean);
    const text = [...lines, url ? `Open it in BenchTalk: ${url}` : "", "You get these because you're on the team's staff. Change which emails you get on your Account page in BenchTalk."]
      .filter(Boolean)
      .join("\n\n");
    const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:15px;line-height:1.5;color:#0f172a;max-width:520px">
${lines.map((l) => `<p style="margin:0 0 16px">${escapeHtml(l)}</p>`).join("\n")}
${url ? `<p style="margin:0 0 16px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#0284c7;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">Open in BenchTalk</a></p>` : ""}
<p style="margin:24px 0 0;color:#64748b;font-size:13px">You get these because you're on the team's staff. Change which emails you get on your Account page in BenchTalk.</p>
</div>`;

    for (const address of [...new Set(to)]) {
      await sendEmail({
        to: address,
        subject: alert.title,
        text,
        html,
        tags: [{ name: "kind", value: `staff-${kind}` }],
        idempotencyKey: alert.emailKey ? `staff-${alert.emailKey}-${address}`.slice(0, 250) : undefined,
      });
    }
  } catch (e) {
    console.error("Staff alert failed:", e);
  }
}
