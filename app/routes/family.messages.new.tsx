import type { Route } from "./+types/family.messages.new";
import { useEffect, useRef } from "react";
import { Link, data, redirect } from "react-router";
import { requireParent } from "~/utils/family.server";
import { pickerOptions, startConversation } from "~/utils/groups.server";
import { NewMessageForm } from "~/components/PeoplePicker";
import { Card, cx } from "~/components/ui";
import { ArrowLeft } from "@phosphor-icons/react";
import { navMotion } from "~/utils/nav-motion";

// Families start a conversation: one staff member opens their private thread,
// anyone else (other families, several staff) makes a group chat that only its
// members can see, coaches included unless they're in it.

function teamsOf(kids: { teamId: number; teamName: string }[]) {
  return [...new Map(kids.map((k) => [k.teamId, { teamId: k.teamId, teamName: k.teamName }])).values()];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user, kids } = await requireParent(request);
  const teams = teamsOf(kids);
  const asked = Number(new URL(request.url).searchParams.get("team"));
  const teamId = teams.some((t) => t.teamId === asked) ? asked : teams[0].teamId;
  return data({ teams, teamId, people: await pickerOptions(teamId, user.id) });
}

export async function action({ request }: Route.ActionArgs) {
  const { user, teamIds } = await requireParent(request);
  const formData = await request.formData();
  const teamId = Number(formData.get("teamId"));
  if (!teamIds.includes(teamId)) return data({ startError: "Pick a team" }, { status: 400 });
  const result = await startConversation(teamId, { id: user.id, side: "parent" }, formData.getAll("key").map(String), String(formData.get("name") ?? ""));
  if ("error" in result) return data({ startError: result.error }, { status: 400 });
  return redirect(`/family/messages/${result.conversationId}`);
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "New message - BenchTalk" }];
}

export default function FamilyNewMessage({ loaderData, actionData }: Route.ComponentProps) {
  const { teams, teamId, people } = loaderData;
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => searchRef.current?.focus(), [teamId]);

  return (
    <div className="pt-4 pb-10">
      <div className="mb-4 flex items-center gap-2">
        <Link
          to="/family/messages"
          {...navMotion("back")}
          className="-ml-2 flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
          aria-label="All messages"
        >
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight">New message</h1>
      </div>

      {teams.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Team">
          {teams.map((t) => (
            <Link
              key={t.teamId}
              to={`?team=${t.teamId}`}
              replace
              role="tab"
              aria-selected={t.teamId === teamId}
              className={cx(
                "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold ring-1 transition",
                t.teamId === teamId ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong hover:bg-surface-2"
              )}
            >
              {t.teamName}
            </Link>
          ))}
        </div>
      )}

      <Card className="p-4 sm:p-5">
        <p className="mb-3 text-sm text-muted">
          Pick a coach for a private message, or other families and staff for a group chat. Only the people in a group see it.
        </p>
        {/* Keyed so a team switch starts with nobody picked */}
        <NewMessageForm
          key={teamId}
          hidden={{ teamId }}
          ref={searchRef}
          options={people}
          side="parent"
          error={actionData && "startError" in actionData ? actionData.startError : null}
        />
      </Card>
    </div>
  );
}
