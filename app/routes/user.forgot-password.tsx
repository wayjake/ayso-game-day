import type { Route } from "./+types/user.forgot-password";
import { Form, Link, data, useNavigation } from "react-router";
import { requestPasswordReset } from "~/utils/password-reset.server";
import { Alert, Button, Card, inputClass, labelClass } from "~/components/ui";
import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Reset password - AYSO Game Day" }];
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return data({ sent: false as const, error: "Enter the email you signed up with.", devLink: null }, { status: 400 });
  }

  const { devLink } = await requestPasswordReset(request, email);
  return data({ sent: true as const, email, error: null, devLink });
}

export default function ForgotPassword({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (actionData?.sent) {
    return (
      <>
        <div className="mb-6">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
            <EnvelopeSimple size={24} />
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Check your email</h1>
          <p className="mt-1 text-muted">
            If there's an account for <span className="font-medium text-ink">{actionData.email}</span>, we've sent a
            link to choose a new password. It expires in an hour.
          </p>
        </div>

        {actionData.devLink && (
          <Alert tone="warning" className="mb-4 break-all">
            Email isn't set up on this server, so here's the link (development only):{" "}
            <a href={actionData.devLink} className="underline">{actionData.devLink}</a>
          </Alert>
        )}

        <p className="text-sm text-muted">
          Nothing arrived? Check spam, or{" "}
          <Link to="/user/forgot-password" reloadDocument className="font-semibold text-primary hover:underline">
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
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Reset your password</h1>
        <p className="mt-1 text-muted">Enter the email you signed up with and we'll send you a link.</p>
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
              className={inputClass}
              placeholder="coach@club.org"
            />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Sending…" : "Send reset link"}
          </Button>
        </Form>
      </Card>

      <p className="mt-6 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link to="/user/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
