import crypto from "node:crypto";

// Email through Resend's REST API. Nothing is sent unless both RESEND_API_KEY
// and EMAIL_FROM are set, so callers must handle `sent: false` (invites, for
// example, fall back to a copyable link).
//
// Sign-in and invite mail goes out from EMAIL_FROM. Announcements and coach
// replies go out from the coach's own address on the same domain (see
// `coachFromAddress`), and replies to them come back through Resend receiving
// to /api/email/webhook.

const API = "https://api.resend.com";

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function headers(extra: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
    // Resend rejects requests without one
    "User-Agent": "ayso-game-day",
    ...extra,
  };
}

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string; // "Name <addr@domain>"; defaults to EMAIL_FROM
  replyTo?: string;
  headers?: Record<string, string>;
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
};

export async function sendEmail(email: OutgoingEmail): Promise<{ sent: boolean; id?: string; error?: string }> {
  if (!isEmailConfigured()) {
    return { sent: false, error: "Email is not configured" };
  }

  try {
    const response = await fetch(`${API}/emails`, {
      method: "POST",
      headers: headers(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey } : {}),
      body: JSON.stringify({
        from: email.from || process.env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(email.replyTo ? { reply_to: email.replyTo } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
        ...(email.tags ? { tags: email.tags } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("Resend error:", response.status, body);
      return { sent: false, error: `Email provider returned ${response.status}` };
    }

    const json = (await response.json().catch(() => ({}))) as { id?: string };
    return { sent: true, id: json.id };
  } catch (error) {
    console.error("Error sending email:", error);
    return { sent: false, error: "Failed to send email" };
  }
}

// ---------------------------------------------------------------------------
// Who family mail is really delivered to.
//
// Outside production, mail to families goes to the coach who sent it instead,
// so testing against real rosters never emails a real parent. Vercel preview
// deploys run with NODE_ENV=production, so they count as testing too. Set
// EMAIL_DELIVER_TO_FAMILIES=true to send for real anywhere.

function deliversToFamilies() {
  if (process.env.EMAIL_DELIVER_TO_FAMILIES === "true") return true;
  return process.env.NODE_ENV === "production" && process.env.VERCEL_ENV !== "preview";
}

export function familyDeliveryAddress(familyEmail: string, coachEmail: string) {
  return deliversToFamilies() ? familyEmail : coachEmail;
}

export function isFamilyDeliveryRedirected() {
  return !deliversToFamilies();
}

// ---------------------------------------------------------------------------
// Sender addresses

function bareAddress(value: string) {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

export function sendingDomain() {
  const from = process.env.EMAIL_FROM;
  return from ? bareAddress(from).split("@")[1] ?? null : null;
}

// True when an address is on the domain Resend sends for
export function isOnSendingDomain(address: string) {
  const domain = sendingDomain();
  return Boolean(domain && address.trim().toLowerCase().endsWith(`@${domain}`));
}

function displayName(name: string) {
  // Quote it so commas and the like don't break the header
  return `"${name.replace(/["\\\r\n]/g, "")}"`;
}

function slug(value: string, max: number) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

// One address per coach per team, e.g. jake.thunder.12-3@aysogameday.com.
// Only the trailing "<teamId>-<coachId>" identifies it; the names are for
// people, so renaming a team or coach doesn't break replies to old mail.
export function coachTeamAddress(
  coach: { id: number; name: string | null; email: string },
  team: { id: number; name: string }
) {
  const domain = sendingDomain();
  if (!domain) return null;
  const coachPart = slug(coach.name?.trim().split(/\s+/)[0] || coach.email.split("@")[0], 20) || "coach";
  const teamPart = slug(team.name, 24) || "team";
  return `${coachPart}.${teamPart}.${team.id}-${coach.id}@${domain}`;
}

// The team and coach a coach+team address stands for. The caller still checks
// that the coach is on that team: anyone can type any address.
export function parseCoachTeamAddress(address: string) {
  const domain = sendingDomain();
  if (!domain) return null;
  const match = address.trim().toLowerCase().match(/\.(\d+)-(\d+)@(.+)$/);
  if (!match || match[3] !== domain) return null;
  return { teamId: Number(match[1]), coachId: Number(match[2]) };
}

// "Jake Berg" <jake@aysogameday.com> for an admin with their own address,
// otherwise the coach+team address (or the shared one when there's no team)
export function coachFromAddress(
  coach: { id: number; name: string | null; email: string; sendingEmail: string | null },
  team?: { id: number; name: string } | null
) {
  const address =
    coach.sendingEmail && isOnSendingDomain(coach.sendingEmail)
      ? coach.sendingEmail
      : (team && coachTeamAddress(coach, team)) || bareAddress(process.env.EMAIL_FROM ?? "");
  const name = coach.name?.trim() || coach.email.split("@")[0];
  return { header: `${displayName(name)} <${address}>`, address };
}

// ---------------------------------------------------------------------------
// Receiving

export type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  headers: Record<string, string | string[]> | null;
  message_id: string | null;
  created_at: string;
  authentication: { spf?: string; dkim?: string; dmarc?: string } | null;
};

export async function getReceivedEmail(id: string): Promise<ReceivedEmail | null> {
  if (!process.env.RESEND_API_KEY) return null;
  const response = await fetch(`${API}/emails/receiving/${encodeURIComponent(id)}`, { headers: headers() });
  if (!response.ok) {
    console.error("Resend receiving error:", response.status, await response.text());
    return null;
  }
  return (await response.json()) as ReceivedEmail;
}

// ---------------------------------------------------------------------------
// Webhook signatures (Svix scheme): HMAC-SHA256 over "id.timestamp.body" keyed
// with the base64-decoded part of the whsec_ secret. Fails closed.

const TOLERANCE_SECONDS = 5 * 60;

export function verifyWebhook(
  rawBody: string,
  h: { id: string | null; timestamp: string | null; signature: string | null },
  secret = process.env.RESEND_WEBHOOK_SECRET,
  now = Date.now()
) {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = crypto.createHmac("sha256", key).update(`${h.id}.${h.timestamp}.${rawBody}`).digest();

  return h.signature.split(" ").some((entry) => {
    const [version, sig] = entry.split(",");
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig, "base64");
    return given.length === expected.length && crypto.timingSafeEqual(given, expected);
  });
}

// ---------------------------------------------------------------------------

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain text to simple HTML paragraphs, with links left as text
export function textToHtml(value: string) {
  return value
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
