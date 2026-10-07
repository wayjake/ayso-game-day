import type { Route } from "./+types/user.reset-password";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { commitSession, getSession } from "~/sessions.server";
import { completePasswordReset, findValidReset } from "~/utils/password-reset.server";
import { Alert, Button, Card, EmptyState, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { LinkBreak } from "@phosphor-icons/react";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Choose a new password - AYSO Game Day" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const reset = await findValidReset(params.token);
  return data({ valid: Boolean(reset) });
}

export async function action({ request, params }: Route.ActionArgs) {
  const formData = await request.formData();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return data({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  if (password !== confirm) {
    return data({ error: "The two passwords don't match" }, { status: 400 });
  }

  const user = await completePasswordReset(params.token, password);
  if (!user) {
    return data({ error: "This link has expired or was already used. Request a new one." }, { status: 400 });
  }

  // Sign them straight in
  const session = await getSession(request.headers.get("Cookie"));
  session.set("userId", user.id);
  session.set("userEmail", user.email);
  session.set("userRole", user.role);
  return redirect("/dashboard", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export default function ResetPassword({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";

  if (!loaderData.valid) {
    return (
      <Card>
        <EmptyState
          icon={<LinkBreak size={24} />}
          title="This link doesn't work anymore"
          action={
            <Link to="/user/forgot-password" className={buttonClass()}>
              Send a new link
            </Link>
          }
        >
          Reset links work once and expire after an hour.
        </EmptyState>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Choose a new password</h1>
        <p className="mt-1 text-muted">You'll be signed in once it's saved.</p>
      </div>

      {actionData?.error && <Alert className="mb-4">{actionData.error}</Alert>}

      <Card>
        <Form method="post" className="space-y-5 p-6 sm:p-8">
          <div>
            <label htmlFor="password" className={labelClass}>
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              autoFocus
              className={inputClass}
            />
            <p className={hintClass}>At least 8 characters</p>
          </div>

          <div>
            <label htmlFor="confirm" className={labelClass}>
              Confirm new password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className={inputClass}
            />
          </div>

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "Saving…" : "Save and sign in"}
          </Button>
        </Form>
      </Card>
    </>
  );
}
