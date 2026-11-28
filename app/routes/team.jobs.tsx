import type { Route } from "./+types/team.jobs";
import { Link, data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess, teamIdFromCode, getTeamStaff } from "~/utils/team-access.server";
import { getEvents } from "~/utils/schedule.server";
import { jobsByEvent, teamFamilies } from "~/utils/jobs.server";
import { formatGameDate, todayISO } from "~/utils/dates";
import { Card, EmptyState, Page, PageHeader } from "~/components/ui";
import { HandHeart } from "@phosphor-icons/react";
import { teamPath } from "~/utils/team-path";

// Staff only: what each family (and staff member) has done or signed up for,
// across the season. A plain record, in name order: nothing here ranks anyone.

type Entry = { key: string; date: string; job: string; event: string; href: string; upcoming: boolean };
type Person = { key: string; label: string; staff: boolean; entries: Entry[] };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = await teamIdFromCode(params.teamCode);
  await requireTeamAccess(teamId, user.id);
  const today = todayISO();

  const families = await teamFamilies([teamId]);
  const jobs = await jobsByEvent([teamId], families);
  const events = new Map((await getEvents([teamId])).map((e) => [e.key, e]));
  const staff = await getTeamStaff(teamId);

  const people = new Map<string, Person>();
  for (const f of families.values()) people.set(f.key, { key: f.key, label: f.label, staff: false, entries: [] });
  for (const s of staff) people.set(`staff:${s.userId}`, { key: `staff:${s.userId}`, label: s.name || s.email.split("@")[0], staff: true, entries: [] });

  for (const [key, list] of Object.entries(jobs)) {
    const event = events.get(key);
    if (!event || event.cancelled) continue; // A cancelled event's jobs didn't happen
    for (const job of list) {
      for (const h of job.holders) {
        const personKey = h.playerId ? families.get(h.playerId)?.key : `staff:${h.userId}`;
        const person = personKey ? people.get(personKey) : undefined;
        if (!person) continue;
        person.entries.push({
          key: h.signupId,
          date: event.date,
          job: job.title,
          event: event.type === "game" ? `Game ${event.title}` : "Practice",
          href: teamPath(params.teamCode, `rsvps/${event.type}/${event.id}`),
          upcoming: event.date >= today,
        });
      }
    }
  }

  const list = [...people.values()]
    .filter((p) => !p.staff || p.entries.length > 0)
    .map((p) => ({ ...p, entries: p.entries.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => Number(a.staff) - Number(b.staff) || a.label.localeCompare(b.label));
  return data({ people: list, anyJobs: Object.keys(jobs).length > 0 });
}

export function meta() {
  return [{ title: "Jobs by family - BenchTalk" }];
}

export default function JobsByFamily({ loaderData, params }: Route.ComponentProps) {
  const { people, anyJobs } = loaderData;
  return (
    <Page width="narrow">
      <PageHeader
        back={{ to: teamPath(params.teamCode, "games"), label: "Schedule" }}
        title="Jobs by family"
        description="What each family has done and signed up for this season. Only staff see this page."
      />
      {!anyJobs ? (
        <Card>
          <EmptyState icon={<HandHeart size={24} />} title="No jobs yet">
            Add jobs like snacks or setting up the goals from a game or practice's page on the Schedule.
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {people.map((p) => {
              const done = p.entries.filter((e) => !e.upcoming).length;
              const coming = p.entries.length - done;
              return (
                <li key={p.key} className="p-4 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-semibold">
                      {p.label}
                      {p.staff && <span className="font-normal text-muted"> · staff</span>}
                    </span>
                    <span className="text-sm text-muted">
                      {p.entries.length === 0 ? "Nothing yet" : [done > 0 && `${done} done`, coming > 0 && `${coming} coming up`].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  {p.entries.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-sm">
                      {p.entries.map((e) => (
                        <li key={e.key}>
                          <Link to={e.href} className="text-muted hover:underline">
                            <span className="tabular">{formatGameDate(e.date, { month: "short", day: "numeric" })}</span> · <span className="font-medium text-ink">{e.job}</span> · {e.event}
                            {e.upcoming && <span className="text-primary"> · coming up</span>}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Page>
  );
}
