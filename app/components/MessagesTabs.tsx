import { NavLink } from "react-router";
import { cx } from "~/components/ui";

// Inbox | Announcements switch at the top of the Messages tab. Two equal
// halves at every width, so the selected pill always fills its side.
export function MessagesTabs({ teamId, needsReply = 0, className }: { teamId: number; needsReply?: number; className?: string }) {
  const base = `/dashboard/team/${teamId}`;
  const tab = ({ isActive }: { isActive: boolean }) =>
    cx(
      "flex min-w-0 items-center justify-center rounded-lg px-3 py-2 text-center text-sm font-semibold break-words transition",
      isActive ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-muted hover:text-ink"
    );
  return (
    <nav aria-label="Messages" className={cx("mb-6 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 ring-1 ring-line", className)} data-tour="messages-tabs">
      <NavLink to={`${base}/messages`} className={tab}>
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
