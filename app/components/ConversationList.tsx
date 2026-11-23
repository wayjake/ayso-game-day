import { Link } from "react-router";
import { ChatsCircle, UserCircle } from "@phosphor-icons/react";
import { formatMessageTime } from "~/utils/dates";
import { Card, cx } from "~/components/ui";

export type ConversationListItem = {
  id: number;
  kind: "team" | "direct";
  title: string;
  subtitle: string;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unread: number;
};

export function ConversationList({
  items,
  hrefFor,
}: {
  items: ConversationListItem[];
  hrefFor: (id: number) => string;
}) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        {items.map((c) => (
          <li key={c.id}>
            <Link to={hrefFor(c.id)} prefetch="intent" className="flex items-center gap-3 px-4 py-3.5 transition hover:bg-surface-2/60 sm:px-5">
              <span
                className={cx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                  c.kind === "team" ? "bg-primary-soft text-primary" : "bg-surface-2 text-muted"
                )}
              >
                {c.kind === "team" ? <ChatsCircle size={24} weight="fill" /> : <UserCircle size={24} weight="fill" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cx("truncate", c.unread > 0 ? "font-bold" : "font-semibold")}>{c.title}</span>
                  {c.lastMessageAt && (
                    <span className={cx("shrink-0 text-xs", c.unread > 0 ? "font-semibold text-primary" : "text-subtle")}>
                      {formatMessageTime(c.lastMessageAt)}
                    </span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-3">
                  <span className={cx("truncate text-sm", c.unread > 0 ? "text-ink" : "text-muted")}>
                    {c.lastMessagePreview ?? c.subtitle}
                  </span>
                  {c.unread > 0 && (
                    <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-white tabular">
                      {c.unread}
                      <span className="sr-only"> unread</span>
                    </span>
                  )}
                </span>
                {c.lastMessagePreview && <span className="block truncate text-xs text-subtle">{c.subtitle}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
