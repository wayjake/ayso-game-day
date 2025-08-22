import type { Route } from "./+types/user.signup";
import { Form, data, redirect } from "react-router";
import { getSession, commitSession } from "~/sessions.server";
import { createUser } from "~/utils/auth.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign Up - AYSO Game Day" },
    { name: "description", content: "Create your AYSO Game Day account to start planning games and rotations" },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const formData = await request.formData();
  
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const teamName = formData.get("teamName") as string;
  const format = formData.get("format") as '7v7' | '9v9' | '11v11';
  const region = formData.get("region") as string;
  
  // Basic validation
  if (!email || !password || !teamName || !format) {
    session.flash("error", "Please fill in all required fields");
    return data(
      { error: "Please fill in all required fields" },
      {
        headers: {
          "Set-Cookie": await commitSession(session),
        },
      }
    );
  }
  
  if (password.length < 8) {
    session.flash("error", "Password must be at least 8 characters");
    return data(
      { error: "Password must be at least 8 characters" },
      {
        headers: {
          "Set-Cookie": await commitSession(session),
        },
      }
    );
  }
  
  try {
    const user = await createUser(
      email,
      password,
      'coach',
      teamName,
      format,
      region || undefined
    );
    
    session.set("userId", user.id);
    session.set("userEmail", user.email);
    session.set("userRole", user.role);
    session.flash("success", "Account created successfully!");
    
    return redirect("/dashboard", {
      headers: {
        "Set-Cookie": await commitSession(session),
      },
    });
  } catch (error) {
    console.error("Signup error:", error);
    session.flash("error", "Email already exists or server error");
    return data(
      { error: "Email already exists or server error" },
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

export default function Signup({ loaderData }: Route.ComponentProps) {
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

      {/* Signup form */}
      <section className="py-16">
        <div className="container mx-auto px-4 max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold">Create Your Account</h1>
            <p className="mt-2 text-[var(--muted)]">
              Start planning your AYSO games in minutes
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
                  className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                  placeholder="••••••••"
                />
                <p className="text-xs text-[var(--muted)] mt-1">
                  Must be at least 8 characters
                </p>
              </div>

              {/* Team Info */}
              <div className="border-t border-[var(--border)] pt-4">
                <h3 className="text-sm font-medium mb-3">Team Information</h3>
                
                <div className="space-y-4">
                  <div>
                    <label htmlFor="teamName" className="block text-sm font-medium mb-1">
                      Team Name
                    </label>
                    <input
                      id="teamName"
                      name="teamName"
                      type="text"
                      required
                      className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                      placeholder="U12 Spartans"
                    />
                  </div>

                  <div>
                    <label htmlFor="format" className="block text-sm font-medium mb-1">
                      Game Format
                    </label>
                    <select
                      id="format"
                      name="format"
                      required
                      className="w-full rounded border border-[var(--border)] px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                    >
                      <option value="">Select format</option>
                      <option value="7v7">7v7</option>
                      <option value="9v9">9v9</option>
                      <option value="11v11">11v11</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="region" className="block text-sm font-medium mb-1">
                      AYSO Region (Optional)
                    </label>
                    <input
                      id="region"
                      name="region"
                      type="text"
                      className="w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent"
                      placeholder="Region 678"
                    />
                  </div>
                </div>
              </div>

              {/* Terms */}
              <div className="flex items-start">
                <input
                  id="terms"
                  name="terms"
                  type="checkbox"
                  required
                  className="mt-1 rounded border-[var(--border)] text-[var(--primary)] focus:ring-[var(--primary)]"
                />
                <label htmlFor="terms" className="ml-2 text-sm text-[var(--muted)]">
                  I agree to the Terms of Service and Privacy Policy
                </label>
              </div>

              {/* Submit */}
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Create Free Account
              </button>

              {/* Already have account */}
              <p className="text-center text-sm text-[var(--muted)]">
                Already have an account?{" "}
                <a href="/user/login" className="text-[var(--primary)] hover:underline">
                  Sign in here
                </a>
              </p>
            </div>
          </Form>

          {/* Benefits */}
          <div className="mt-8 space-y-3">
            <div className="flex items-start gap-3">
              <span className="h-5 w-5 inline-flex items-center justify-center rounded-full bg-[var(--success)] text-white text-xs mt-0.5">
                ✓
              </span>
              <div>
                <p className="text-sm font-medium">Start with the Free plan</p>
                <p className="text-xs text-[var(--muted)]">1 team, 10 games, no credit card required</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-5 w-5 inline-flex items-center justify-center rounded-full bg-[var(--success)] text-white text-xs mt-0.5">
                ✓
              </span>
              <div>
                <p className="text-sm font-medium">AYSO compliant rotations</p>
                <p className="text-xs text-[var(--muted)]">Fair play time tracking built-in</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <span className="h-5 w-5 inline-flex items-center justify-center rounded-full bg-[var(--success)] text-white text-xs mt-0.5">
                ✓
              </span>
              <div>
                <p className="text-sm font-medium">Upgrade anytime</p>
                <p className="text-xs text-[var(--muted)]">Switch to Coach or Club plans as you grow</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}