import type { Route } from "./+types/join";
import { Form, data, redirect, useNavigation } from "react-router";
import { db, users } from "~/db";
import { sql } from "drizzle-orm";
import { getSession, commitSession } from "~/sessions.server";
import { createUser, getUser } from "~/utils/auth.server";
import { acceptParentInvite, getParentInviteByCode } from "~/utils/parent-invites.server";
import { AppMark } from "~/components/AppMark";
import { Alert, Card, EmptyState, buttonClass, hintClass, inputClass, labelClass } from "~/components/ui";
import { CalendarCheck, ChatsCircle, CheckCircle, SignIn, WarningCircle } from "@phosphor-icons/react";

// A parent's invite link: create an account (or log in) and get linked to
// their kids on the team.

async function findUserByEmail(email: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return user ?? null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const found = await getParentInviteByCode(params.code);
  const user = await getUser(request, false);
  if (!found) return data({ state: "invalid" as const });

  return data({
    state: found.state,
    email: found.invite.email,
    teamName: found.teamName,
    coachName: found.coachName,
    kids: found.kids.map((k) => k.name),
    suggestedName: found.suggestedName,
    currentUser: user ? { email: user.email } : null,
    hasAccount: user ? true : Boolean(await findUserByEmail(found.invite.email)),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const found = await getParentInviteByCode(params.code);
  if (!found || found.state !== "pending") {
    return data({ error: "This invite is no longer valid." }, { status: 400 });
  }

  const formData = await request.formData();
  const session = await getSession(request.headers.get("Cookie"));
  let userId: number;

  if (formData.get("_action") === "signup") {
    const name = ((formData.get("name") as string) ?? "").trim();
    const password = (formData.get("password") as string) ?? "";
    const email = found.invite.email;

    if (!name) return data({ error: "Please enter your name" }, { status: 400 });
    if (password.length < 8) return data({ error: "Password must be at least 8 characters" }, { status: 400 });
    if (await findUserByEmail(email)) {
      return data({ error: "An account with this email already exists. Log in to join." }, { status: 400 });
    }

    const user = await createUser(email, password, { name, role: "parent" });
    session.set("userId", user.id);
    session.set("userEmail", user.email);
    session.set("userRole", user.role);
    userId = user.id;
  } else {
    const user = await getUser(request, false);
    if (!user) throw redirect(`/user/login?redirectTo=${encodeURIComponent(`/join/${params.code}`)}`);
    userId = user.id;
  }

  await acceptParentInvite(params.code, userId);

  // Parents stay signed in for a month: they open this from a phone home screen
  return redirect("/family?welcome=1", {
    headers: { "Set-Cookie": await commitSession(session, { maxAge: 60 * 60 * 24 * 30 }) },
  });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Join your team - BenchTalk" }, { name: "robots", content: "noindex" }];
}

const primaryButton = buttonClass({ size: "lg", className: "w-full" });

function listNames(names: string[]) {
  const first = names.map((n) => n.split(" ")[0]);
  if (first.length <= 1) return first[0] ?? "your player";
  return `${first.slice(0, -1).join(", ")} and ${first[first.length - 1]}`;
}

export default function Join({ loaderData, actionData, params }: Route.ComponentProps) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const loginHref = `/user/login?redirectTo=${encodeURIComponent(`/join/${params.code}`)}`;

  let body: React.ReactNode;

  if (loaderData.state !== "pending") {
    const states = {
      invalid: { title: "Invite not found", text: "This link isn't valid. Ask your coach to send a new one." },
      expired: { title: "Invite expired", text: "This link has expired. Ask your coach to send a new one." },
      revoked: { title: "Invite replaced", text: "A newer invite was sent to your email. Use the link in that one." },
      accepted: { title: "You're already in", text: "This invite has been used. Log in to see your team." },
    };
    const { title, text } = states[loaderData.state];
    body = (
      <>
        <h1 className="sr-only">Join your team</h1>
        <EmptyState
          className="py-10"
          icon={loaderData.state === "accepted" ? <CheckCircle size={24} /> : <WarningCircle size={24} />}
          title={title}
          action={<a href="/family" className={buttonClass({ variant: "secondary" })}>Go to the app</a>}
        >
          {text}
        </EmptyState>
      </>
    );
  } else {
    const { email, teamName, coachName, kids, suggestedName, currentUser, hasAccount } = loaderData;
    const emailMismatch = currentUser && currentUser.email.toLowerCase() !== email.toLowerCase();

    body = (
      <div className="space-y-6 p-6 sm:p-8">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">{teamName}</p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight">Join as {listNames(kids)}'s family</h1>
          <p className="mt-2 text-muted">
            <strong className="font-semibold text-ink">{coachName}</strong> added you to the team.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex items-center gap-3">
              <CalendarCheck size={20} className="shrink-0 text-primary" />
              See games and practices, and RSVP in one tap
            </li>
            <li className="flex items-center gap-3">
              <ChatsCircle size={20} className="shrink-0 text-primary" />
              Message the coaches and the team
            </li>
          </ul>
        </div>

        {actionData?.error && <Alert>{actionData.error}</Alert>}

        {currentUser ? (
          <Form method="post" className="space-y-3">
            <input type="hidden" name="_action" value="accept" />
            {emailMismatch && (
              <Alert tone="warning">
                This invite was sent to {email}. You're signed in as {currentUser.email}, and {listNames(kids)} will be
                added to that account.
              </Alert>
            )}
            <button type="submit" className={primaryButton} disabled={submitting}>
              {submitting ? "Joining…" : "Join the team"}
            </button>
          </Form>
        ) : hasAccount ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">You already have an account for {email}.</p>
            <a href={loginHref} className={primaryButton}>
              <SignIn size={20} />
              Log in to join
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
              <input id="name" name="name" required autoComplete="name" defaultValue={suggestedName} className={inputClass} />
              <p className={hintClass}>Shown to the coaches and other families in team chat</p>
            </div>
            <div>
              <label htmlFor="password" className={labelClass}>Password</label>
              <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className={inputClass} placeholder="••••••••" />
              <p className={hintClass}>At least 8 characters</p>
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
      <a href="/" aria-label="BenchTalk home" className="mb-8">
        <AppMark />
      </a>
      <Card className="w-full max-w-md">{body}</Card>
    </div>
  );
}
