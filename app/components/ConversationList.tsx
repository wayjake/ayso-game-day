import { Link } from "react-router";
import { ChatsCircle, EnvelopeSimple, UserCircle } from "@phosphor-icons/react";
import { formatMessageTime } from "~/utils/dates";
import { Badge, Card, cx } from "~/components/ui";
import { StaffBadge } from "~/components/StaffBadge";
import type { StaffRole } from "~/utils/team-roles";

export type ConversationListItem = {
  id: number;
  kind: "team" | "direct";
  title: string;
  subtitle: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
  needsReply?: boolean;
  emailOnly?: boolean;
  /** Family app: a private thread with one staff member shows their role */
  staffRole?: StaffRole | null;
  /** Where the row goes when it isn't a thread yet (family app: a staff member not written to) */
  href?: string;
};

export function ConversationList({
  items,
  hrefFor,
  selectedId,
  prefetch = "intent",
  className,
}: {
  items: ConversationListItem[];
  hrefFor: (id: number) => string;
  selectedId?: number | null; // Highlighted when the list sits beside the open thread
  prefetch?: "intent" | "none"; // "none" where opening a thread marks it read
  className?: string;
}) {
  return (
    <Card className={className}>
      <ul className="divide-y divide-line">
        {items.map((c) => {
          const selected = c.id === selectedId;
          // The open thread is being read, even if the list hasn't caught up
          const unread = selected ? 0 : c.unread;
          return (
          <li key={c.href ?? c.id}>
            <Link
              to={c.href ?? hrefFor(c.id)}
              prefetch={prefetch}
              aria-current={selected ? "page" : undefined}
              className={cx(
                "flex items-center gap-3 px-4 py-3.5 transition sm:px-5",
                selected ? "bg-primary-soft shadow-[inset_3px_0_0_var(--color-primary)]" : "hover:bg-surface-2/60"
              )}
            >
              <span
                className={cx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                  c.kind === "team" ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted"
                )}
              >
                {c.kind === "team" ? <ChatsCircle size={24} weight="fill" /> : c.emailOnly ? <EnvelopeSimple size={22} weight="fill" /> : <UserCircle size={24} weight="fill" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={cx("truncate", unread > 0 ? "font-bold" : "font-semibold")}>{c.title}</span>
                    {c.staffRole && <StaffBadge role={c.staffRole} short />}
                  </span>
                  {c.lastMessageAt && (
                    <span className={cx("shrink-0 text-xs", unread > 0 ? "font-semibold text-primary" : "text-subtle")}>
                      {formatMessageTime(c.lastMessageAt)}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className={cx("truncate text-sm", unread > 0 ? "text-ink" : "text-muted")}>
                    {c.lastMessagePreview ?? c.subtitle}
                  </span>
                  {unread > 0 && (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular">
                      {unread}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </span>
                {(c.lastMessagePreview || c.needsReply) && (
                  <span className="mt-0.5 flex items-center gap-1.5">
                    {c.needsReply && <Badge tone="warning">Needs reply</Badge>}
                    {c.lastMessagePreview && <span className="truncate text-xs text-subtle">{c.subtitle}{c.emailOnly ? " · by email" : ""}</span>}
                  </span>
                )}
              </span>
            </Link>
          </li>
          );
        })}
      </ul>
    </Card>
  );
}
