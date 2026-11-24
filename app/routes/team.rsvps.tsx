import type { Route } from "./+types/team.rsvps";
import { Form, data, useNavigation } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getEventRsvps, getTeamEvent, getTeamPlayers, setRsvp } from "~/utils/schedule.server";
import { getParentUserIdsForPlayers, getUserNames } from "~/utils/family.server";
import { db, guardians } from "~/db";
import { eq } from "drizzle-orm";
import { sendPush } from "~/utils/push.server";
import { eventDayPhrase, eventPhrase, isRsvpStatus, RSVP_LABELS, type RsvpStatus } from "~/utils/schedule";
import { formatGameDate, formatGameTime, formatTimeRange, todayISO } from "~/utils/dates";
import { RsvpButtons } from "~/components/RsvpButtons";
import { Alert, Badge, Button, Card, Page, PageHeader, PlayerAvatar, cx } from "~/components/ui";
import { BellRinging } from "@phosphor-icons/react";

async function load(request: Request, params: { teamId: string; eventType: string; eventId: string }) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  await requireTeamAccess(teamId, user.id);
  const event = await getTeamEvent(teamId, params.eventType, Number(params.eventId));
  if (!event) throw new Response("Event not found", { status: 404 });
  return { user, teamId, event };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { teamId, event } = await load(request, params);
  const players = await getTeamPlayers(teamId);
  const answers = await getEventRsvps(event.type, event.id);
  const names = await getUserNames([...new Set(answers.map((a) => a.respondedBy))]);
  const linked = new Set(
    (await db.select({ playerId: guardians.playerId }).from(guardians).where(eq(guardians.teamId, teamId))).map((g) => g.playerId)
  );

  return data({
    event,
    today: todayISO(),
    players: players.map((p) => {
      const a = answers.find((x) => x.playerId === p.id);
      return {
        ...p,
        status: (a?.status ?? null) as RsvpStatus | null,
        note: a?.note ?? null,
        respondedBy: a ? names.get(a.respondedBy) ?? null : null,
        familyLinked: linked.has(p.id),
      };
    }),
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, teamId, event } = await load(request, params);
  const formData = await request.formData();
  const intent = formData.get("_action");

  if (intent === "rsvp") {
    const playerId = Number(formData.get("playerId"));
    const status = formData.get("status");
    const players = await getTeamPlayers(teamId);
    if (!players.some((p) => p.id === playerId) || !isRsvpStatus(status)) {
      return data({ error: "Can't RSVP for that player" }, { status: 400 });
    }
    await setRsvp({ teamId, playerId, eventType: event.type, eventId: event.id, status, respondedBy: user.id });
    return data({ ok: true });
  }

  if (intent === "nudge") {
    const players = await getTeamPlayers(teamId);
    const answered = new Set((await getEventRsvps(event.type, event.id)).map((a) => a.playerId));
    const waiting = players.filter((p) => !answered.has(p.id)).map((p) => p.id);
    const parents = await getParentUserIdsForPlayers(waiting);
    await sendPush(parents, "team", {
      title: "Can you make it?",
      body: `RSVP for ${eventPhrase(event)} ${eventDayPhrase(event.date)} so the coaches can plan.`,
      url: "/family",
      tag: `nudge-${event.key}`,
    });
    return data({ nudged: parents.length });
  }

  return data({ error: "Unknown action" }, { status: 400 });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "RSVPs - AYSO Game Day" }];
}

const order: (RsvpStatus | null)[] = ["yes", "maybe", "no", null];
const groupTitle = (s: RsvpStatus | null) => (s ? RSVP_LABELS[s] : "No reply yet");
const groupTone = { yes: "text-success", maybe: "text-warning", no: "text-danger" } as const;

export default function EventRsvps({ loaderData, actionData, params }: Route.ComponentProps) {
  const { event, players, today } = loaderData;
  const navigation = useNavigation();
  const nudging = navigation.state === "submitting" && navigation.formData?.get("_action") === "nudge";
  const past = event.date < today;
  const waitingLinked = players.filter((p) => !p.status && p.familyLinked).length;
  const time = event.type === "game" ? formatGameTime(event.time) : formatTimeRange(event.time, event.endTime);

  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: `/dashboard/team/${params.teamId}/games`, label: "Schedule" }}
        title={event.type === "game" ? event.title : "Practice"}
        description={[formatGameDate(event.date), time, event.location].filter(Boolean).join(" · ")}
      />

      {event.cancelled && <Alert tone="warning" className="mb-6">This {event.type} is cancelled.</Alert>}
      {actionData && "nudged" in actionData && (
        <Alert tone="success" className="mb-6">
          {actionData.nudged === 0 ? "No one to remind: families without an answer haven't turned on notifications or joined yet." : `Reminded ${actionData.nudged} ${actionData.nudged === 1 ? "family" : "families"}.`}
        </Alert>
      )}

      {!past && !event.cancelled && waitingLinked > 0 && (
        <Form method="post" className="mb-6">
          <input type="hidden" name="_action" value="nudge" />
          <Button type="submit" variant="secondary" disabled={nudging}>
            <BellRinging size={18} />
            {nudging ? "Sending…" : `Remind ${waitingLinked} ${waitingLinked === 1 ? "family" : "families"} who haven't answered`}
          </Button>
        </Form>
      )}

      <div className="space-y-6">
        {order.map((status) => {
          const group = players.filter((p) => p.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status ?? "none"}>
              <h2 className={cx("mb-2 text-sm font-semibold", status ? groupTone[status] : "text-muted")}>
                {groupTitle(status)} <span className="font-normal text-subtle tabular">{group.length}</span>
              </h2>
              <Card>
                <ul className="divide-y divide-line">
                  {group.map((p) => (
                    <li key={p.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:px-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <PlayerAvatar player={p} size="sm" />
                        <div className="min-w-0">
                          <div className="truncate font-semibold">{p.name}</div>
                          <div className="truncate text-xs text-muted">
                            {p.respondedBy ? `Answered by ${p.respondedBy}` : p.familyLinked ? "Family is on the app" : <Badge>Family not on the app</Badge>}
                          </div>
                        </div>
                      </div>
                      {!past && !event.cancelled && (
                        <div className="sm:w-72">
                          <RsvpButtons playerId={p.id} eventType={event.type} eventId={event.id} status={p.status} label={p.name} size="sm" />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
