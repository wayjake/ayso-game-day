import type { Route } from "./+types/user.login";
import { Form, data, redirect, useSearchParams } from "react-router";
import { getSession, commitSession } from "~/sessions.server";
import { authenticateUser, safeRedirect } from "~/utils/auth.server";
import { Alert, Button, Card, inputClass, labelClass } from "~/components/ui";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Sign in - AYSO Game Day" },
    { name: "description", content: "Sign in to your AYSO Game Day account" },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const formData = await request.formData();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const redirectTo = safeRedirect(formData.get("redirectTo"));
  const remember = formData.get("remember") === "on";

  // Basic validation
  if (!email || !password) {
    session.flash("error", "Please enter both email and password");
    return data(
      { error: "Please enter both email and password" },
      {
        headers: {
          "Set-Cookie": await commitSession(session),
        },
      }
    );
  }

  try {
    const user = await authenticateUser(email, password);

    if (!user) {
      session.flash("error", "Invalid email or password");
      return data(
        { error: "Invalid email or password" },
        {
          headers: {
            "Set-Cookie": await commitSession(session),
          },
        }
      );
    }

    session.set("userId", user.id);
    session.set("userEmail", user.email);
    session.set("userRole", user.role);
    session.flash("success", "Welcome back.");

    // Signed in for a month, or only until the browser closes
    return redirect(redirectTo, {
      headers: {
        "Set-Cookie": await commitSession(session, { maxAge: remember ? 60 * 60 * 24 * 30 : undefined }),
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    session.flash("error", "Server error. Please try again.");
    return data(
      { error: "Server error. Please try again." },
      {
        headers: {
          "Set-Cookie": await commitSession(session),
        },
      }
    );
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSession(request.headers.get("Cookie"));

  // If already logged in, go straight to where they were headed
  if (session.has("userId")) {
    return redirect(safeRedirect(new URL(request.url).searchParams.get("redirectTo")));
  }

  return data(
    {
      error: session.get("error"),
      success: session.get("success")
    },
    {
      headers: {
        "Set-Cookie": await commitSession(session),
      },
    }
  );
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const { error, success } = loaderData;
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "";

  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Welcome back</h1>
        <p className="mt-1 text-muted">Sign in to plan lineups and check your next game.</p>
      </div>

      {/* Error/success messages */}
      {(error || success) && (
        <div className="mb-4 space-y-2">
          {error && <Alert>{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}
        </div>
      )}

      <Card>
        <Form method="post" className="space-y-5 p-6 sm:p-8">
          <input type="hidden" name="redirectTo" value={redirectTo} />

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
              className={inputClass}
              placeholder="coach@club.org"
            />
          </div>

          <div>
            <label htmlFor="password" className={labelClass}>
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={inputClass}
              placeholder="••••••••"
            />
          </div>

          <label htmlFor="remember" className="flex items-center gap-2.5 text-sm text-muted">
            <input id="remember" name="remember" type="checkbox" defaultChecked className="h-4 w-4 rounded accent-primary" />
            Keep me signed in
          </label>

          <Button type="submit" size="lg" className="w-full">
            Sign in
          </Button>
        </Form>
      </Card>

      <p className="mt-6 text-center text-sm text-muted">
        Don't have an account?{" "}
        <a
          href={redirectTo.startsWith("/invite/") ? redirectTo : "/user/signup"}
          className="font-semibold text-primary hover:underline"
        >
          Create one
        </a>
      </p>
    </>
  );
}
