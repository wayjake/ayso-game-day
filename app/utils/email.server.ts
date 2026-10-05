// Transactional email through Resend's REST API. Nothing is sent unless both
// RESEND_API_KEY and EMAIL_FROM are set, so callers must handle `sent: false`
// (invites, for example, fall back to a copyable link).

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({
  to,
  subject,
  html,
  text,
  replyTo,
}: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<{ sent: boolean; error?: string }> {
  if (!isEmailConfigured()) {
    return { sent: false, error: "Email is not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [to],
        subject,
        html,
        text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("Resend error:", response.status, body);
      return { sent: false, error: `Email provider returned ${response.status}` };
    }

    return { sent: true };
  } catch (error) {
    console.error("Error sending email:", error);
    return { sent: false, error: "Failed to send email" };
  }
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
