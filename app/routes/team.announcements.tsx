import type { Route } from "./+types/team.announcements";
import { Link, data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { listAnnouncements } from "~/utils/announcements.server";
import { countNeedsReply } from "~/utils/messages.server";
import { formatMessageTime } from "~/utils/dates";
import { MessagesTabs } from "~/components/MessagesTabs";
import { Badge, Card, EmptyState, Page, PageHeader, buttonClass } from "~/components/ui";
import { CaretRight, Megaphone, Plus, Warning } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const items = await listAnnouncements(teamId);
  return data({ team, items, needsReply: await countNeedsReply(teamId, user.id) });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Announcements - BenchTalk" }];
}

const askLabel = { none: "Just sharing", ack: "Asked for “Got it”", reply: "Asked for a reply" } as const;

export default function Announcements({ loaderData }: Route.ComponentProps) {
  const { team, items, needsReply } = loaderData;
  const base = `/dashboard/team/${team.id}`;

  return (
    <Page width="narrow">
      <PageHeader
        title="Messages"
        actions={
          <Link to={`${base}/announcements/new`} className={buttonClass()} data-tour="new-announcement">
            <Plus size={18} weight="bold" />
            New announcement
          </Link>
        }
      />
      <MessagesTabs teamId={team.id} needsReply={needsReply} />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            className="py-12"
            icon={<Megaphone size={24} />}
            title="No announcements yet"
            action={
              <Link to={`${base}/announcements/new`} className={buttonClass()}>
                <Plus size={18} weight="bold" />
                Write the first one
              </Link>
            }
          >
            Email every family at once, then see who opened it, who replied, and who still needs a nudge.
          </EmptyState>
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {items.map((a) => {
            const responded = a.ask === "ack" ? a.acknowledged + a.replied : a.ask === "reply" ? a.replied : a.opened;
            return (
              <Link key={a.id} to={`${base}/announcements/${a.id}`} className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate font-semibold">{a.subject}</p>
                    <span className="shrink-0 text-xs text-subtle">{formatMessageTime(a.createdAt)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{askLabel[a.ask]}</span>
                    <span className="tabular">
                      {responded} of {a.total} {a.ask === "none" ? "opened" : "responded"}
                    </span>
                    {a.replied > 0 && a.ask !== "reply" && <span className="tabular">{a.replied} replied</span>}
                    {a.problems > 0 && (
                      <Badge tone="danger">
                        <Warning size={12} weight="bold" />
                        {a.problems} bounced
                      </Badge>
                    )}
                  </div>
                </div>
                <CaretRight size={16} className="shrink-0 text-subtle" />
              </Link>
            );
          })}
        </Card>
      )}
    </Page>
  );
}
