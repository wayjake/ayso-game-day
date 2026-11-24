import type { Route } from "./+types/user.magic-link.token";
import { Form, Link, data, useNavigation } from "react-router";
import { completeMagicLink, findValidMagicLink, signInFamilyRedirect } from "~/utils/magic-link.server";
import { Alert, Button, Card, EmptyState, buttonClass } from "~/components/ui";
import { LinkBreak, SignIn } from "@phosphor-icons/react";

// Opening the link only shows a button; signing in takes a POST. Mail
// scanners that fetch every link in an email would otherwise use it up.

export function meta({}: Route.MetaArgs) {
  return [{ title: "Sign in - BenchTalk" }, { name: "robots", content: "noindex" }];
}

export async function loader({ params }: Route.LoaderArgs) {
  const link = await findValidMagicLink(params.token);
  return data({ email: link?.email ?? null });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await completeMagicLink(params.token);
  if (!user) {
    return data({ error: "This link has expired or was already used. Request a new one." }, { status: 400 });
  }
  return signInFamilyRedirect(request, user);
}

export default function MagicLinkSignIn({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle";

  if (!loaderData.email) {
    return (
      <Card>
        <EmptyState
          icon={<LinkBreak size={24} />}
          title="This link doesn't work anymore"
          action={
            <Link to="/user/magic-link" className={buttonClass()}>
              Send a new link
            </Link>
          }
        >
          Sign-in links work once and expire after 20 minutes.
        </EmptyState>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Welcome</h1>
        <p className="mt-1 text-muted">
          Signing in as <span className="font-medium text-ink">{loaderData.email}</span>
        </p>
      </div>

      {actionData?.error && <Alert className="mb-4">{actionData.error}</Alert>}

      <Card>
        <Form method="post" className="p-6 sm:p-8">
          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            <SignIn size={20} />
            {submitting ? "Signing in…" : "Continue to the app"}
          </Button>
        </Form>
      </Card>
    </>
  );
}
