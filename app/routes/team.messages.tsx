import type { Route } from "./+types/team.messages";
import { useState } from "react";
import { Link, Outlet, data, useLocation, useParams, useSearchParams } from "react-router";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { listCoachConversations } from "~/utils/messages.server";
import { countUnmatched } from "~/utils/inbound-email.server";
import { ConversationList } from "~/components/ConversationList";
import { MessagesTabs } from "~/components/MessagesTabs";
import { Card, EmptyState, buttonClass, cx } from "~/components/ui";
import { CaretRight, EnvelopeSimple, MagnifyingGlass, PaperPlaneTilt, Plus } from "@phosphor-icons/react";

// Messages layout. Phones show the list (with the index route's cards under
// it) or one thread, as separate screens. From lg up the list stays on the
// left and the thread or index route fills the rest, each pane scrolling on
// its own (see handle.workspace in dashboard.tsx).
//
// The open thread polls every few seconds, which reruns this loader too, so
// it loads only the list. Families and unmatched emails load in the index route.

export const handle = { workspace: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const { team } = await requireTeamAccess(teamId, user.id);
  const [conversations, unmatchedCount] = await Promise.all([listCoachConversations(teamId, user.id), countUnmatched(user, teamId)]);
  return data({ team: { id: team.id, name: team.name }, conversations, unmatchedCount });
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Messages - AYSO Game Day" }];
}

type Filter = "all" | "needs-reply" | "unread" | "email";

export default function MessagesLayout({ loaderData }: Route.ComponentProps) {
  const { team, conversations, unmatchedCount } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const params = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const openId = params.conversationId ? Number(params.conversationId) : null;

  const filterParam = searchParams.get("filter");
  const filter: Filter = filterParam === "needs-reply" || filterParam === "unread" || filterParam === "email" ? filterParam : "all";
  const needsReplyCount = conversations.filter((c) => c.needsReply).length;
  const unreadCount = conversations.filter((c) => c.unread > 0).length;

  const q = query.trim().toLowerCase();
  const shown = conversations.filter((c) => {
    if (filter === "needs-reply" && !c.needsReply) return false;
    if (filter === "unread" && c.unread === 0 && c.id !== openId) return false;
    if (filter === "email" && !c.emailOnly) return false;
    return !q || `${c.title} ${c.subtitle}`.toLowerCase().includes(q);
  });

  const filters: { value: Filter; label: string; desktopOnly?: boolean }[] = [
    { value: "all", label: "All" },
    { value: "needs-reply", label: `Needs reply${needsReplyCount ? ` · ${needsReplyCount}` : ""}` },
    { value: "unread", label: `Unread${unreadCount ? ` · ${unreadCount}` : ""}`, desktopOnly: true },
    { value: "email", label: "Email only", desktopOnly: true },
  ];
  // Keep the filter when moving between threads
  const keep = filter === "all" ? "" : `?filter=${filter}`;

  return (
    <div className="lg:flex lg:min-h-0 lg:flex-1">
      {/* List pane: the whole screen on phones (hidden while a thread is open), a column on desktop */}
      <div
        className={cx(
          "mx-auto w-full max-w-2xl px-4 pt-6 sm:px-6 sm:pt-8",
          "lg:mx-0 lg:flex lg:w-[340px] lg:max-w-none lg:shrink-0 lg:flex-col lg:border-r lg:border-line lg:bg-surface lg:p-0",
          openId !== null && "hidden"
        )}
      >
        <div className="lg:border-b lg:border-line lg:px-4 lg:pt-4 lg:pb-3">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-4 lg:mb-3 lg:flex-nowrap lg:items-center lg:gap-2">
            <h1 className="font-display text-3xl font-bold tracking-tight lg:text-2xl">Messages</h1>
            <div className="flex items-center gap-2">
              <Link to={`${base}/announcements/new`} className={buttonClass({ variant: "secondary", className: "lg:!hidden" })}>
                <PaperPlaneTilt size={18} />
                Announcement
              </Link>
              <span className="hidden lg:block">
                <Link to={`${base}/messages?compose=1`} className={buttonClass({ size: "sm" })} title="Message a family">
                  <Plus size={16} weight="bold" />
                  Message
                </Link>
              </span>
            </div>
          </header>
          <MessagesTabs teamId={team.id} needsReply={needsReplyCount} className="lg:mb-3 lg:flex" />

          <div className="relative mb-3 hidden lg:block">
            <label htmlFor="conversation-search" className="sr-only">Search conversations</label>
            <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
            <input
              id="conversation-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search families or kids"
              className="block h-9 w-full rounded-lg border border-line-strong bg-canvas pr-3 pl-9 text-sm text-ink placeholder:text-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          <div className="mb-3 flex flex-wrap gap-2 lg:mb-0 lg:gap-1.5" role="tablist" aria-label="Filter conversations">
            {filters.map((f) => (
              <Link
                key={f.value}
                to={`${location.pathname}${f.value === "all" ? "" : `?filter=${f.value}`}`}
                role="tab"
                aria-selected={filter === f.value}
                preventScrollReset
                className={cx(
                  "inline-flex h-9 items-center rounded-full px-3.5 text-sm font-semibold ring-1 transition lg:h-7 lg:px-2.5 lg:text-xs",
                  filter === f.value ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong hover:bg-surface-2",
                  f.desktopOnly && "max-lg:!hidden"
                )}
              >
                {f.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {shown.length === 0 ? (
            <Card className="lg:rounded-none lg:shadow-none lg:ring-0">
              <EmptyState className="py-10" title={q ? "No matches" : "You're all caught up"}>
                {q ? "No family or kid by that name has a conversation yet." : "Nothing here right now."}
              </EmptyState>
            </Card>
          ) : (
            <ConversationList
              items={shown}
              hrefFor={(id) => `${base}/messages/${id}${keep}`}
              selectedId={openId}
              // Opening a thread marks it read, so hovering mustn't load it
              prefetch="none"
              className="lg:rounded-none lg:shadow-none lg:ring-0"
            />
          )}
        </div>

        {unmatchedCount > 0 && (
          <Link
            to={`${base}/messages`}
            className="hidden shrink-0 items-center gap-2 border-t border-line bg-warning-soft px-4 py-3 text-sm font-semibold text-warning hover:brightness-[0.98] lg:flex"
          >
            <EnvelopeSimple size={18} />
            <span className="flex-1">Emails to sort</span>
            <span className="tabular">{unmatchedCount}</span>
            <CaretRight size={14} weight="bold" />
          </Link>
        )}
      </div>

      {/* Thread or index. Keyed so drafts and scroll never carry over to another family. */}
      <div key={openId ?? "index"} className="lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col">
        <Outlet />
      </div>
    </div>
  );
}
