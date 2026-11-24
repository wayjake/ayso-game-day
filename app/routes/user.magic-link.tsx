import type { Route } from "./+types/user.magic-link";
import { Form, Link, data, useNavigation, useSearchParams } from "react-router";
import { completeMagicCode, requestMagicLink, signInFamilyRedirect } from "~/utils/magic-link.server";
import { Alert, Button, Card, hintClass, inputClass, labelClass } from "~/components/ui";
import { ArrowLeft, EnvelopeSimple } from "@phosphor-icons/react";

// Families sign in without a password. The email holds a link and a 6-digit
// code: the link for the browser, the code for the Home Screen app, which
// links in Mail never open. ?step=code goes straight to typing a code (the
// app may have reloaded while they were in Mail).

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign in with email - AYSO Game Day" }];
}

type ActionData =
  | { step: "email"; error: string }
  | { step: "code"; email: string; error: string | null; devLink: string | null; devCode: string | null };

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return data<ActionData>({ step: "email", error: "Enter the email your coach has for you." }, { status: 400 });
  }

  if (formData.get("_action") === "code") {
    const result = await completeMagicCode(email, String(formData.get("code") ?? ""));
    if (result.ok) return signInFamilyRedirect(request, result.user);
    return data<ActionData>({ step: "code", email, error: result.error, devLink: null, devCode: null }, { status: 400 });
  }

  const { devLink, devCode } = await requestMagicLink(request, email);
  return data<ActionData>({ step: "code", email, error: null, devLink, devCode });
}

export default function MagicLink({ actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const [searchParams] = useSearchParams();
  const result = actionData as ActionData | undefined;

  if (result?.step === "code" || searchParams.get("step") === "code") {
    return <CodeStep result={result?.step === "code" ? result : null} email={searchParams.get("email") ?? ""} busy={busy} />;
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Sign in with email</h1>
        <p className="mt-1 text-muted">
          For parents and guardians. We'll email you a link and a code to see the schedule, RSVP and message the coaches.
          No password needed.
        </p>
      </div>

      {result?.error && <Alert className="mb-4">{result.error}</Alert>}

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

          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Sending…" : "Email me a sign-in link"}
          </Button>
        </Form>
      </Card>

      <p className="mt-6 text-center text-sm text-muted">
        <Link to="?step=code" className="font-semibold text-primary hover:underline">
          Already have a code?
        </Link>
        <span className="mx-2 text-line-strong">·</span>
        Have a password?{" "}
        <Link to="/user/login" className="font-semibold text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

function CodeStep({
  result,
  email: emailFromUrl,
  busy,
}: {
  result: Extract<ActionData, { step: "code" }> | null;
  email: string;
  busy: boolean;
}) {
  // Known when they just asked for an email here; otherwise they type it
  const email = result?.email ?? "";
  const justSent = Boolean(email) && !result?.error;

  return (
    <>
      <div className="mb-6">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
          <EnvelopeSimple size={24} />
        </div>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{justSent ? "Check your email" : "Enter your code"}</h1>
        <p className="mt-1 text-muted">
          {justSent ? (
            <>
              If <span className="font-medium text-ink">{email}</span> is on a team roster, we've sent a sign-in link and a
              6-digit code. Tap the link, or type the code here. Both expire in 20 minutes.
            </>
          ) : (
            "Type the 6-digit code from your sign-in email."
          )}
        </p>
      </div>

      {result?.devLink && (
        <Alert tone="warning" className="mb-4 break-all">
          Email isn't set up on this server (development only). Code <strong>{result.devCode}</strong>, or the link:{" "}
          <a href={result.devLink} className="underline">
            {result.devLink}
          </a>
        </Alert>
      )}

      {result?.error && <Alert className="mb-4">{result.error}</Alert>}

      <Card>
        <Form method="post" className="space-y-5 p-6 sm:p-8">
          <input type="hidden" name="_action" value="code" />
          {email ? (
            <input type="hidden" name="email" value={email} />
          ) : (
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
                defaultValue={emailFromUrl}
                className={inputClass}
                placeholder="you@example.com"
              />
            </div>
          )}
          <div>
            <label htmlFor="code" className={labelClass}>
              Sign-in code
            </label>
            <input
              // A fresh field after each try, so a wrong code doesn't linger
              key={result?.error ?? "code"}
              id="code"
              name="code"
              required
              inputMode="numeric"
              // iOS and Android offer the code from Mail or Messages above the keyboard
              autoComplete="one-time-code"
              maxLength={9}
              autoFocus={Boolean(email)}
              placeholder="123 456"
              className={`${inputClass} text-center font-mono text-2xl tracking-[0.3em]`}
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </Form>
      </Card>

      <p className="mt-6 text-sm text-muted">
        Nothing arrived? Check spam, or make sure it's the email your coach has for you, then{" "}
        <Link to="/user/magic-link" reloadDocument className="font-semibold text-primary hover:underline">
          send a new one
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
