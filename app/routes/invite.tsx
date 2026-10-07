import type { Route } from "./+types/invite";
import { Form, data, redirect, useNavigation } from "react-router";
import { db, users } from "~/db";
import { sql } from "drizzle-orm";
import { getSession, commitSession } from "~/sessions.server";
import { createUser, getUser } from "~/utils/auth.server";
import { acceptInvites, getInviteByCode } from "~/utils/invites.server";
import { AppMark } from "~/components/AppMark";
import { Alert, Card, EmptyState, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { CheckCircle, SignIn, UsersThree, WarningCircle } from "@phosphor-icons/react";

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
    { title: "Coach invite - AYSO Game Day" },
    { name: "robots", content: "noindex" },
  ];
}

const primaryButton = buttonClass({ size: "lg", className: "w-full" });

export default function Invite({ loaderData, actionData, params }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const loginHref = `/user/login?redirectTo=${encodeURIComponent(`/invite/${params.code}`)}`;

  let body: React.ReactNode;

  if (loaderData.state !== "pending") {
    const states = {
      invalid: {
        title: "Invite not found",
        text: "This invite link isn't valid. Ask the coach who invited you to send a new one.",
      },
      expired: {
        title: "Invite expired",
        text: "This invite has expired. Ask the coach who invited you to send a new one.",
      },
      revoked: {
        title: "Invite cancelled",
        text: "This invite was cancelled. Ask the coach who invited you to send a new one.",
      },
      accepted: {
        title: "Invite already accepted",
        text: "This invite has already been accepted.",
      },
    };
    const { title, text } = states[loaderData.state];
    body = (
      <>
        <h1 className="sr-only">Coach invite</h1>
        <EmptyState
          className="py-10"
          icon={loaderData.state === "accepted" ? <CheckCircle size={24} /> : <WarningCircle size={24} />}
          title={title}
          action={
            <a href="/dashboard" className={buttonClass({ variant: "secondary" })}>
              Go to your dashboard
            </a>
          }
        >
          {text}
        </EmptyState>
      </>
    );
  } else {
    const { email, inviterName, teamNames, currentUser, hasAccount } = loaderData;
    const emailMismatch = currentUser && currentUser.email.toLowerCase() !== email.toLowerCase();

    body = (
      <div className="space-y-6 p-6 sm:p-8">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Coach invite</h1>
          <p className="mt-2 text-muted">
            <strong className="font-semibold text-ink">{inviterName}</strong> invited you to help coach:
          </p>
          <ul className="mt-4 space-y-2">
            {teamNames.map((name) => (
              <li key={name} className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                  <UsersThree size={18} weight="fill" />
                </span>
                <span className="min-w-0 truncate font-semibold">{name}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted">
            You'll be able to plan lineups, manage the roster, and edit games.
          </p>
        </div>

        {actionData?.error && <Alert>{actionData.error}</Alert>}

        {currentUser ? (
          <Form method="post" className="space-y-3">
            <input type="hidden" name="_action" value="accept" />
            {emailMismatch && (
              <Alert tone="warning">
                This invite was sent to {email}. You're signed in as {currentUser.email}, and the teams will be
                added to that account.
              </Alert>
            )}
            <button type="submit" className={primaryButton} disabled={submitting}>
              {submitting ? "Joining…" : "Accept invite"}
            </button>
          </Form>
        ) : hasAccount ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">You already have an account for {email}.</p>
            <a href={loginHref} className={primaryButton}>
              <SignIn size={20} />
              Log in to accept
            </a>
          </div>
        ) : (
          <Form method="post" className="space-y-4 border-t border-line pt-6">
            <input type="hidden" name="_action" value="signup" />
            <h2 className="text-base font-semibold">Create your account</h2>
            <div>
              <span className={labelClass}>Email</span>
              <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-muted">{email}</div>
            </div>
            <div>
              <label htmlFor="name" className={labelClass}>Your name</label>
              <input id="name" name="name" required autoComplete="name" className={inputClass} placeholder="Alex Morgan" />
              <p className={hintClass}>Printed as the assistant coach on game cards</p>
            </div>
            <div>
              <label htmlFor="password" className={labelClass}>Password</label>
              <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} placeholder="••••••••" />
              <p className={hintClass}>Must be at least 8 characters</p>
            </div>
            <button type="submit" className={primaryButton} disabled={submitting}>
              {submitting ? "Creating account…" : "Create account and join"}
            </button>
            <p className="text-center text-sm text-muted">
              Have an account under a different email?{" "}
              <a href={loginHref} className="font-medium text-primary hover:underline">Log in</a>
            </p>
          </Form>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center bg-canvas px-4 py-10 text-ink sm:py-16">
      <a href="/" aria-label="AYSO Game Day home" className="mb-8">
        <AppMark />
      </a>
      <Card className="w-full max-w-md">{body}</Card>
    </div>
  );
}
