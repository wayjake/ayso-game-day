import type { Route } from "./+types/team.announcements";
import { Link, NavLink, Outlet, data, useLocation, useParams } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { listAnnouncements } from "~/utils/announcements.server";
import { countNeedsReply } from "~/utils/messages.server";
import { formatMessageTime } from "~/utils/dates";
import { MessagesTabs } from "~/components/MessagesTabs";
import { Badge, Card, EmptyState, buttonClass, cx } from "~/components/ui";
import { Megaphone, Plus, Warning } from "@phosphor-icons/react";

// Announcements layout, the same workspace as Messages (team.messages.tsx).
// Phones show the list or one announcement as separate screens. From lg up
// the list stays on the left and the open announcement, the compose form or
// the index fills the rest, each pane scrolling on its own.

export const handle = { workspace: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const [items, needsReply] = await Promise.all([listAnnouncements(teamId), countNeedsReply(teamId, user.id)]);
  return data({ team: { id: team.id, name: team.name }, items, needsReply });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Announcements - BenchTalk" }];
}

const askLabel = { none: "Just sharing", ack: "Asked for “Got it”", reply: "Asked for a reply" } as const;

export default function AnnouncementsLayout({ loaderData }: Route.ComponentProps) {
  const { team, items, needsReply } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const params = useParams();
  const { pathname } = useLocation();
  // Something is open in the right pane: an announcement, or the compose form
  const openKey = params.announcementId ?? (pathname.endsWith("/announcements/new") ? "new" : null);

  return (
    <div className="lg:flex lg:min-h-0 lg:flex-1">
      {/* List pane: the whole screen on phones (hidden while one is open), a column on desktop */}
      <div
        className={cx(
          "mx-auto w-full max-w-2xl px-safe pt-6 sm:pt-8",
          "lg:mx-0 lg:flex lg:w-[340px] lg:max-w-none lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-surface lg:p-0",
          openKey !== null && "max-lg:hidden"
        )}
      >
        <div className="lg:border-b lg:border-line lg:px-4 lg:pt-4 lg:pb-3">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4 lg:mb-3 lg:flex-nowrap lg:items-center lg:gap-2">
            <h1 className="font-display text-3xl font-bold tracking-tight lg:text-2xl">Messages</h1>
            <Link to={`${base}/announcements/new`} className={buttonClass({ className: "lg:min-h-9 lg:px-3" })} data-tour="new-announcement">
              <Plus size={16} weight="bold" />
              <span className="lg:hidden">New announcement</span>
              <span className="max-lg:hidden">Announcement</span>
            </Link>
          </header>
          <MessagesTabs teamId={team.id} needsReply={needsReply} className="lg:mb-0" />
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {items.length === 0 ? (
            <Card className="lg:rounded-none lg:shadow-none lg:ring-0">
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
            <Card className="divide-y divide-line overflow-hidden lg:rounded-none lg:shadow-none lg:ring-0">
              {items.map((a) => {
                const responded = a.ask === "ack" ? a.acknowledged + a.replied : a.ask === "reply" ? a.replied : a.opened;
                return (
                  <NavLink
                    key={a.id}
                    to={`${base}/announcements/${a.id}`}
                    className={({ isActive }) =>
                      cx("block px-4 py-3.5 transition hover:bg-surface-2", isActive && "bg-primary-soft hover:bg-primary-soft")
                    }
                  >
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
                  </NavLink>
                );
              })}
            </Card>
          )}
        </div>
      </div>

      {/* The open announcement, the compose form, or the index. Keyed so nothing carries over between them. */}
      <div key={openKey ?? "index"} className="lg:min-h-0 lg:min-w-0 lg:flex-1 lg:overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
