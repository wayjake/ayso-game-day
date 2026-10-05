import type { Route } from "./+types/invite";
import { Form, data, redirect, useNavigation } from "react-router";
import { db, users } from "~/db";
import { sql } from "drizzle-orm";
import { getSession, commitSession } from "~/sessions.server";
import { createUser, getUser } from "~/utils/auth.server";
import { acceptInvites, getInviteByCode } from "~/utils/invites.server";

async function findUserByEmail(email: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user ?? null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const found = await getInviteByCode(params.code);
  const user = await getUser(request, false);

  if (!found) {
    return data({ state: "invalid" as const });
  }

  return data({
    state: found.state,
    email: found.invite.email!,
    inviterName: found.inviterName,
    teamNames: found.teams.map((t) => t.teamName),
    currentUser: user ? { email: user.email } : null,
    hasAccount: user ? true : Boolean(await findUserByEmail(found.invite.email!)),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const found = await getInviteByCode(params.code);
  if (!found || found.state !== "pending") {
    return data({ error: "This invite is no longer valid." }, { status: 400 });
  }

  const formData = await request.formData();
  const intent = formData.get("_action");
  const session = await getSession(request.headers.get("Cookie"));
  let userId: number;

  if (intent === "signup") {
    const name = ((formData.get("name") as string) ?? "").trim();
    const password = (formData.get("password") as string) ?? "";
    const email = found.invite.email!;

    if (!name) {
      return data({ error: "Please enter your name" }, { status: 400 });
    }
    if (password.length < 8) {
      return data({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (await findUserByEmail(email)) {
      return data({ error: "An account with this email already exists. Log in to accept." }, { status: 400 });
    }

    // Invited coaches get an account with no team of their own
    const user = await createUser(email, password, { name });
    session.set("userId", user.id);
    session.set("userEmail", user.email);
    session.set("userRole", user.role);
    userId = user.id;
  } else {
    const user = await getUser(request, false);
    if (!user) {
      throw redirect(`/user/login?redirectTo=${encodeURIComponent(`/invite/${params.code}`)}`);
    }
    userId = user.id;
  }

  const teamIds = await acceptInvites(params.code, userId);
  session.flash("success", "You've joined the team!");

  return redirect(teamIds.length === 1 ? `/dashboard/team/${teamIds[0]}` : "/dashboard", {
    headers: { "Set-Cookie": await commitSession(session) },
  });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Coach Invite - AYSO Game Day" },
    { name: "robots", content: "noindex" },
  ];
}

const inputClass =
  "w-full rounded border border-[var(--border)] px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:border-transparent";
const primaryButton =
  "w-full inline-flex items-center justify-center px-5 py-3 text-base rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition disabled:opacity-60";

export default function Invite({ loaderData, actionData, params }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const loginHref = `/user/login?redirectTo=${encodeURIComponent(`/invite/${params.code}`)}`;

  let body: React.ReactNode;

  if (loaderData.state !== "pending") {
    const messages = {
      invalid: "This invite link isn't valid. Ask the coach who invited you to send a new one.",
      expired: "This invite has expired. Ask the coach who invited you to send a new one.",
      revoked: "This invite was cancelled. Ask the coach who invited you to send a new one.",
      accepted: "This invite has already been accepted.",
    };
    body = (
      <div className="p-6 space-y-4 text-center">
        <p>{messages[loaderData.state]}</p>
        <a href="/dashboard" className="text-[var(--primary)] hover:underline">Go to your dashboard</a>
      </div>
    );
  } else {
    const { email, inviterName, teamNames, currentUser, hasAccount } = loaderData;
    const emailMismatch = currentUser && currentUser.email.toLowerCase() !== email.toLowerCase();

    body = (
      <div className="p-6 space-y-4">
        <div>
          <p>
            <strong>{inviterName}</strong> invited you to help coach:
          </p>
          <ul className="mt-2 list-disc pl-5">
            {teamNames.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-[var(--muted)]">
            You'll be able to plan lineups, manage the roster, and edit games.
          </p>
        </div>

        {actionData?.error && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{actionData.error}</div>
        )}

        {currentUser ? (
          <Form method="post" className="space-y-3">
            <input type="hidden" name="_action" value="accept" />
            {emailMismatch && (
              <p className="text-sm text-[var(--muted)]">
                This invite was sent to {email}. You're signed in as {currentUser.email}, and the teams will be
                added to that account.
              </p>
            )}
            <button type="submit" className={primaryButton} disabled={submitting}>
              {submitting ? "Joining…" : "Accept invite"}
            </button>
          </Form>
        ) : hasAccount ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--muted)]">You already have an account for {email}.</p>
            <a href={loginHref} className={primaryButton}>Log in to accept</a>
          </div>
        ) : (
          <Form method="post" className="space-y-4 border-t border-[var(--border)] pt-4">
            <input type="hidden" name="_action" value="signup" />
            <p className="text-sm font-medium">Create your account</p>
            <div>
              <span className="block text-sm font-medium mb-1">Email</span>
              <div className="px-3 py-2 rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">{email}</div>
            </div>
            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-1">Your name</label>
              <input id="name" name="name" required autoComplete="name" className={inputClass} placeholder="Alex Morgan" />
              <p className="text-xs text-[var(--muted)] mt-1">Printed as the assistant coach on game cards</p>
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium mb-1">Password</label>
              <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} placeholder="••••••••" />
              <p className="text-xs text-[var(--muted)] mt-1">Must be at least 8 characters</p>
            </div>
            <button type="submit" className={primaryButton} disabled={submitting}>
              {submitting ? "Creating account…" : "Create account and join"}
            </button>
            <p className="text-center text-sm text-[var(--muted)]">
              Have an account under a different email?{" "}
              <a href={loginHref} className="text-[var(--primary)] hover:underline">Log in</a>
            </p>
          </Form>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased">
      <header className="border-b border-[var(--border)] bg-[var(--surface)]">
        <nav className="container mx-auto px-4 flex items-center justify-between h-14">
          <a href="/" className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-[var(--accent)] text-white text-xs">AY</span>
            <span>AYSO Game Day</span>
          </a>
        </nav>
      </header>

      <section className="py-16">
        <div className="container mx-auto px-4 max-w-md">
          <h1 className="text-3xl font-bold text-center mb-8">Coach Invite</h1>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm">{body}</div>
        </div>
      </section>
    </div>
  );
}
