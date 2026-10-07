import type { Route } from "./+types/user.signup";
import { Form, data, redirect, useSearchParams } from "react-router";
import { getSession, commitSession } from "~/sessions.server";
import { createUser } from "~/utils/auth.server";
import { Check } from "@phosphor-icons/react";
import { Alert, Button, Card, hintClass, inputClass, labelClass } from "~/components/ui";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Sign up - AYSO Game Day" },
    { name: "description", content: "Create your AYSO Game Day account to start planning games and rotations" },
  ];
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getSession(request.headers.get("Cookie"));
  const formData = await request.formData();
  
  const name = (formData.get("name") as string)?.trim();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const teamName = formData.get("teamName") as string;
  const format = formData.get("format") as '7v7' | '9v9' | '11v11';
  const region = formData.get("region") as string;
  
  // Basic validation
  if (!name || !email || !password || !teamName || !format) {
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
    const user = await createUser(email, password, {
      name,
      teamName,
      gameFormat: format,
      region: region || undefined,
    });
    
    session.set("userId", user.id);
    session.set("userEmail", user.email);
    session.set("userRole", user.role);
    session.flash("success", "Account created.");
    
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
  // The landing page's quick-start form passes these along
  const [searchParams] = useSearchParams();
  const presetFormat = searchParams.get("format");
  return (
    <>
      <div className="mb-6">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Create your account</h1>
        <p className="mt-1 text-muted">Set up your team and plan your first game in a few minutes.</p>
      </div>

      {/* Error/success messages */}
      {(error || success) && (
        <div className="mb-4 space-y-2">
          {error && <Alert>{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}
        </div>
      )}

      <Card>
        <Form method="post" className="divide-y divide-line">
          <div className="p-6 sm:p-8">
            <fieldset className="min-w-0 space-y-5">
              <legend className="sr-only">About you</legend>
              <div>
                <label htmlFor="name" className={labelClass}>
                  Your name
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  autoComplete="name"
                  className={inputClass}
                  placeholder="Alex Morgan"
                />
                <p className={hintClass}>Printed as the coach's name on game cards</p>
              </div>

              <div>
                <label htmlFor="email" className={labelClass}>
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  defaultValue={searchParams.get("email") ?? undefined}
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
                  className={inputClass}
                  placeholder="••••••••"
                />
                <p className={hintClass}>At least 8 characters</p>
              </div>
            </fieldset>
          </div>

          {/* Team info */}
          <div className="p-6 sm:p-8">
            <fieldset className="min-w-0 space-y-5">
              <legend className="text-base font-semibold">Your team</legend>

              <div>
                <label htmlFor="teamName" className={labelClass}>
                  Team name
                </label>
                <input
                  id="teamName"
                  name="teamName"
                  type="text"
                  required
                  defaultValue={searchParams.get("teamName") ?? undefined}
                  className={inputClass}
                  placeholder="U12 Spartans"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="format" className={labelClass}>
                    Game format
                  </label>
                  <select
                    id="format"
                    name="format"
                    required
                    defaultValue={presetFormat && ["7v7", "9v9", "11v11"].includes(presetFormat) ? presetFormat : ""}
                    className={inputClass}
                  >
                    <option value="">Select format</option>
                    <option value="7v7">7v7</option>
                    <option value="9v9">9v9</option>
                    <option value="11v11">11v11</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="region" className={labelClass}>
                    AYSO region <span className="font-normal text-subtle">(optional)</span>
                  </label>
                  <input
                    id="region"
                    name="region"
                    type="text"
                    className={inputClass}
                    placeholder="Region 678"
                  />
                </div>
              </div>
            </fieldset>
          </div>

          <div className="space-y-5 p-6 sm:p-8">
            {/* Terms */}
            <label htmlFor="terms" className="flex items-start gap-2.5 text-sm text-muted">
              <input id="terms" name="terms" type="checkbox" required className="mt-0.5 h-4 w-4 shrink-0 rounded accent-primary" />
              I agree to the Terms of Service and Privacy Policy
            </label>

            <Button type="submit" size="lg" className="w-full">
              Create account
            </Button>
          </div>
        </Form>
      </Card>

      <p className="mt-6 text-center text-sm text-muted">
        Already have an account?{" "}
        <a href="/user/login" className="font-semibold text-primary hover:underline">
          Sign in
        </a>
      </p>

      {/* Benefits */}
      <ul className="mt-8 space-y-3 border-t border-line pt-6">
        {[
          { title: "Free for coaches", detail: "Every planning and game day feature, no credit card" },
          { title: "AYSO fair play built in", detail: "Sit-out counts and a fair play summary" },
          { title: "AI only if you want it", detail: "Pay-as-you-go credits, no subscription" },
        ].map((benefit) => (
          <li key={benefit.title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success">
              <Check size={12} weight="bold" />
            </span>
            <div>
              <p className="text-sm font-medium">{benefit.title}</p>
              <p className="text-xs text-muted">{benefit.detail}</p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
