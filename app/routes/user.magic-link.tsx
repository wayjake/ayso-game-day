import type { Route } from "./+types/user.magic-link";
import { Form, Link, data, useNavigation, useSearchParams } from "react-router";
import { requestMagicLink } from "~/utils/magic-link.server";
import { Alert, Button, Card, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react";

// Families sign in without a password: a link goes to the email the coach has
// on the roster.

export function meta({}: Route.MetaArgs) {
  return [{ title: "Email me a sign-in link - AYSO Game Day" }];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return data({ sent: false as const, error: "Enter the email your coach has for you.", devLink: null }, { status: 400 });
  }

  const { devLink } = await requestMagicLink(request, email);
  return data({ sent: true as const, email, error: null, devLink });
}

export default function MagicLink({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [searchParams] = useSearchParams();

  if (actionData?.sent) {
    return (
      <>
        <div className="mb-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <EnvelopeSimple size={24} />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Check your email</h1>
          <p className="mt-1 text-muted">
            If <span className="font-medium text-ink">{actionData.email}</span> is on a team roster, we've sent a link to
            sign in. It expires in 20 minutes.
          </p>
        </div>

        {actionData.devLink && (
          <Alert tone="warning" className="mb-4 break-all">
            Email isn't set up on this server, so here's the link (development only):{" "}
            <a href={actionData.devLink} className="underline">{actionData.devLink}</a>
          </Alert>
        )}

        <p className="text-sm text-muted">
          Nothing arrived? Check spam, or make sure it's the email your coach has for you, then{" "}
          <Link to="/user/magic-link" reloadDocument className="font-semibold text-primary hover:underline">
            try again
          </Link>
          .
        </p>
        <Link to="/user/login" className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline">
          <ArrowLeft size={16} weight="bold" />
          Back to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Sign in with email</h1>
        <p className="mt-1 text-muted">
          For parents and guardians. We'll email you a link to see the schedule, RSVP and message the coaches. No
          password needed.
        </p>
      </div>

      {actionData?.error && <Alert className="mb-4">{actionData.error}</Alert>}

      <Card>
        <Form method="post" className="space-y-5 p-6 sm:p-8">
          <div>
            <label htmlFor="email" className={labelClass}>
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              defaultValue={searchParams.get("email") ?? ""}
              className={inputClass}
              placeholder="you@example.com"
            />
            <p className={hintClass}>Use the email your coach has on the team roster</p>
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </Form>
      </Card>

      <p className="mt-6 text-center text-sm text-muted">
        Have a password?{" "}
        <Link to="/user/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
