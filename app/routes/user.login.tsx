import type { Route } from "./+types/user.login";
import { Form, data, redirect } from "react-router";
import { getSession, commitSession } from "~/sessions.server";
import { authenticateUser } from "~/utils/auth.server";

export function meta({ }: Route.MetaArgs) {
  return [
    { title: "Sign In - AYSO Game Day" },
    { name: "description", content: "Sign in to your AYSO Game Day account" },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  console.log("Login action")
  console.log(process.env)
  const session = await getSession(request.headers.get("Cookie"));
  const formData = await request.formData();

  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

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
    session.flash("success", "Welcome back!");

    return redirect("/dashboard", {
      headers: {
        "Set-Cookie": await commitSession(session),
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

  // If already logged in, redirect to dashboard
  if (session.has("userId")) {
    return redirect("/dashboard");
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

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
      {/* Simple header */}
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <nav className="container mx-auto px-4 flex items-center justify-between h-14">
          <a href="/" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--accent)] text-white text-xs">AY</span>
            <span>AYSO Game Day</span>
          </a>
          <a href="/" className="text-[var(--muted)] hover:text-[var(--text)] transition text-sm">
            Back to Home
          </a>
        </nav>
      </header>

      {/* Login form */}
      <section className="py-16">
        <div className="container mx-auto px-4 max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold">Welcome Back</h1>
            <p className="mt-2 text-[var(--muted)]">
              Sign in to your AYSO Game Day account
            </p>

            {/* Error/Success messages */}
            {error && (
              <div className="mt-4 p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="mt-4 p-3 rounded bg-green-50 border border-green-200 text-green-700 text-sm">
                {success}
              </div>
            )}
          </div>

          <Form method="post" className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">
            <div className="p-6 space-y-4">
              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-1">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  placeholder="coach@club.org"
                />
              </div>

              {/* Password */}
              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-1">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  placeholder="••••••••"
                />
              </div>

              {/* Remember me & Forgot password */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center">
                  <input
                    id="remember"
                    name="remember"
                    type="checkbox"
                    className="rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                  />
                  <label htmlFor="remember" className="ml-2 text-[var(--muted)]">
                    Remember me
                  </label>
                </div>
                <a href="/user/forgot-password" className="text-[var(--primary)] hover:underline">
                  Forgot password?
                </a>
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Sign In
              </button>

              {/* Sign up link */}
              <p className="text-center text-sm text-[var(--muted)]">
                Don't have an account?{" "}
                <a href="/user/signup" className="text-[var(--primary)] hover:underline">
                  Create one here
                </a>
              </p>
            </div>
          </Form>

          {/* Demo credentials (dev only) */}
          {process.env.NODE_ENV === 'development' && (
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="text-sm font-medium text-yellow-800 mb-2">Demo Account</h3>
              <p className="text-xs text-yellow-700">
                For testing purposes, you can sign up with any email and password, or use existing demo accounts if available.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}