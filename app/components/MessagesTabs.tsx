import { NavLink } from "react-router";
import { cx } from "~/components/ui";

// Inbox | Announcements switch at the top of the Messages tab
export function MessagesTabs({ teamId, needsReply = 0 }: { teamId: number; needsReply?: number }) {
  const base = `/dashboard/team/${teamId}`;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      "flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold transition sm:flex-none sm:px-4",
      isActive ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink"
    );
  return (
    <nav aria-label="Messages" className="mb-6 flex gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-line sm:inline-flex" data-tour="messages-tabs">
      <NavLink to={`${base}/messages`} end className={tab}>
        Inbox
        {needsReply > 0 && (
          <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular">
            {needsReply}
          </span>
        )}
      </NavLink>
      <NavLink to={`${base}/announcements`} className={tab}>
        Announcements
      </NavLink>
    </nav>
  );
}
