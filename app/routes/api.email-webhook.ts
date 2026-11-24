import type { Route } from "./+types/api.email-webhook";
import { verifyWebhook } from "~/utils/email.server";
import { handleWebhookEvent } from "~/utils/inbound-email.server";

// Resend webhook: delivery events for mail we send, and email received on the
// domain. Point a Resend webhook here with every email.* event selected and
// set RESEND_WEBHOOK_SECRET to its signing secret. Unsigned requests are
// refused.

export async function loader() {
  return new Response("Method not allowed", { status: 405 });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await request.text();
  const valid = verifyWebhook(raw, {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  });
  if (!valid) return new Response("Invalid signature", { status: 401 });

  let event: Parameters<typeof handleWebhookEvent>[0];
  try {
    event = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  try {
    await handleWebhookEvent(event);
  } catch (error) {
    // A 500 makes Resend retry later
    console.error("Email webhook failed:", event?.type, error);
    return new Response("Failed", { status: 500 });
  }
  return new Response("ok");
}
