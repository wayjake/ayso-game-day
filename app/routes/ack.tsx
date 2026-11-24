import type { Route } from "./+types/ack";
import { Form, data, useNavigation } from "react-router";
import { acknowledgeRecipient, findRecipientByAckToken } from "~/utils/announcements.server";
import { AppMark } from "~/components/AppMark";
import { Button, Card } from "~/components/ui";
import { CheckCircle, LinkBreak } from "@phosphor-icons/react";

// "Got it" from an announcement email. Opening the link only shows a button;
// the acknowledgement takes a POST, so mail scanners that fetch every link
// can't tap it for the family.

export function meta({}: Route.MetaArgs) {
  return [{ title: "Got it - BenchTalk" }, { name: "robots", content: "noindex" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const found = await findRecipientByAckToken(params.token);
  return data({
    found: Boolean(found),
    subject: found?.subject ?? null,
    teamName: found?.teamName ?? null,
    done: Boolean(found?.acknowledgedAt),
  });
}

export async function action({ params }: Route.ActionArgs) {
  const found = await findRecipientByAckToken(params.token);
  if (!found) return data({ ok: false }, { status: 404 });
  await acknowledgeRecipient(found.id);
  return data({ ok: true });
}

export default function Ack({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const done = loaderData.done || actionData?.ok;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <AppMark />
        </div>
        <Card className="p-6 text-center sm:p-8">
          {!loaderData.found ? (
            <>
              <LinkBreak size={32} className="mx-auto mb-3 text-muted" />
              <h1 className="text-lg font-semibold">This link doesn't work</h1>
              <p className="mt-1 text-sm text-muted">It may have been copied wrong. You can reply to the email instead.</p>
            </>
          ) : done ? (
            <>
              <CheckCircle size={40} weight="fill" className="mx-auto mb-3 text-success" />
              <h1 className="text-lg font-semibold">Thanks, the coaches know you've seen it</h1>
              <p className="mt-1 text-sm text-muted">{loaderData.subject}</p>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted">{loaderData.teamName}</p>
              <h1 className="mt-1 text-lg font-semibold">{loaderData.subject}</h1>
              <Form method="post" className="mt-6">
                <Button type="submit" size="lg" className="w-full" disabled={navigation.state !== "idle"}>
                  <CheckCircle size={20} weight="bold" />
                  {navigation.state !== "idle" ? "Sending…" : "Got it"}
                </Button>
              </Form>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
