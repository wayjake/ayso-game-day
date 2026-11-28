import type { Route } from "./+types/team.messages.channels-new";
import { useState } from "react";
import { Form, Link, data, redirect, useNavigation } from "react-router";
import { ArrowLeft, Hash } from "@phosphor-icons/react";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode } from "~/utils/team-access.server";
import { pickerOptions } from "~/utils/groups.server";
import { createChannel } from "~/utils/channels.server";
import { usesMembers, type ChannelAudience } from "~/utils/channels";
import { ChannelFields } from "~/components/ChannelPanel";
import { PeopleChecklist } from "~/components/PeoplePicker";
import { Button, Card, hintClass } from "~/components/ui";
import { navMotion } from "~/utils/nav-motion";
import { teamPath } from "~/utils/team-path";

// New channel: staff only (requireTeamAccess). In the Messages pane on
// desktop, a page of its own on phones.

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  await requireTeamAccess(teamId, user.id);
  return data({ people: await pickerOptions(teamId, user.id) });
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  await requireTeamAccess(teamId, user.id);
  const formData = await request.formData();
  const result = await createChannel(teamId, { id: user.id, side: "coach" }, {
    name: String(formData.get("name") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    audience: String(formData.get("audience") ?? ""),
    staffOnlyPosts: formData.get("staffOnlyPosts") === "1",
    keys: formData.getAll("key").map(String),
  });
  if ("error" in result) return data({ error: result.error }, { status: 400 });
  return redirect(teamPath(params.teamCode, `messages/${result.conversationId}`));
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "New channel - BenchTalk" }];
}

export default function NewChannel({ loaderData, actionData, params }: Route.ComponentProps) {
  const [audience, setAudience] = useState<ChannelAudience>("everyone");
  const [selected, setSelected] = useState<string[]>([]);
  const navigation = useNavigation();
  const busy = navigation.state !== "idle" && navigation.formMethod === "POST";
  // A 'families' channel only picks families: all staff are in it anyway
  const options = audience === "families" ? loaderData.people.filter((p) => p.kind === "family") : loaderData.people;
  const keys = selected.filter((k) => options.some((o) => o.key === k));

  return (
    <div className="mx-auto w-full max-w-2xl px-safe pt-4 pb-16 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pt-8">
      <div className="mb-4 flex items-center gap-3">
        <Link
          to={teamPath(params.teamCode, "messages")}
          {...navMotion("back")}
          className="tap -ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink lg:hidden"
          aria-label="All messages"
        >
          <ArrowLeft size={20} weight="bold" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">New channel</h1>
          <p className="text-sm text-muted">A lasting place for one topic. Staff manage it; group chats are for quick, one-off conversations.</p>
        </div>
      </div>

      <Form method="post">
        <Card className="p-5">
          <ChannelFields audience={audience} onAudience={setAudience} />
          {usesMembers(audience) && (
            <div className="mt-4">
              <p className="mb-1.5 text-sm font-medium text-ink">
                {audience === "families" ? "Which families" : "Who's in it"}
                <span className="font-normal text-muted"> · {keys.length} picked</span>
              </p>
              {keys.map((k) => (
                <input key={k} type="hidden" name="key" value={k} />
              ))}
              <PeopleChecklist
                options={options}
                selected={keys}
                onToggle={(key) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))}
                maxHeightClass="max-h-64"
              />
              <p className={hintClass}>
                {audience === "private" ? "You're in it too. " : ""}
                You can add or remove people later. Families not on the app yet see it once they join.
              </p>
            </div>
          )}
        </Card>
        {actionData?.error && <p className="mt-3 text-sm text-danger">{actionData.error}</p>}
        <Button type="submit" className="mt-4 w-full sm:w-auto" disabled={busy}>
          <Hash size={18} weight="bold" />
          Create channel
        </Button>
      </Form>
    </div>
  );
}
