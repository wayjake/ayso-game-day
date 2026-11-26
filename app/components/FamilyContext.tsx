import type { ReactNode } from "react";
import { Link } from "react-router";
import { BellRinging, CheckCircle, DeviceMobile, EnvelopeSimple, UsersThree } from "@phosphor-icons/react";
import { formatGameDate, formatGameTime, formatMessageTime } from "~/utils/dates";
import { RSVP_LABELS, type RsvpStatus } from "~/utils/schedule";
import type { FamilyContextView, FamilyReach, TeamChatContextView } from "~/utils/family-context.server";
import type { RecipientState } from "~/utils/announcements.server";
import { FamilyNotes } from "~/components/FamilyNotes";
import { Badge, buttonClass, cx } from "~/components/ui";
import { teamPath } from "~/utils/team-path";

// Who a family is, beside their thread (Messages) or their row (Families).
// The page's action must handle the FamilyNotes actions.

export const familyStatusBadge = {
  joined: (
    <Badge tone="success">
      <CheckCircle size={12} weight="fill" />
      On the app
    </Badge>
  ),
  invited: <Badge tone="primary">Invited</Badge>,
  expired: <Badge tone="warning">Invite expired</Badge>,
  "not-invited": <Badge>Not invited</Badge>,
};

const reachText: Record<FamilyReach, { icon: ReactNode; text: string }> = {
  push: { icon: <BellRinging size={14} />, text: "Gets a notification for your messages" },
  app: { icon: <DeviceMobile size={14} />, text: "On the app, notifications off, so replies are emailed too" },
  email: { icon: <EnvelopeSimple size={14} />, text: "Not on the app, so your messages go by email" },
};

const rsvpTone: Record<RsvpStatus, "success" | "warning" | "danger"> = { yes: "success", maybe: "warning", no: "danger" };

const announcementState: Record<RecipientState, { label: string; tone: "success" | "primary" | "neutral" | "danger" | "warning" }> = {
  acknowledged: { label: "Got it", tone: "success" },
  replied: { label: "Replied", tone: "success" },
  opened: { label: "Opened", tone: "primary" },
  delivered: { label: "Delivered", tone: "neutral" },
  sent: { label: "Sent", tone: "neutral" },
  pending: { label: "Sending", tone: "neutral" },
  bounced: { label: "Bounced", tone: "danger" },
  failed: { label: "Didn't send", tone: "danger" },
};

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("border-b border-line px-4 py-4 last:border-b-0", className)}>
      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function FamilyContext({
  family,
  teamCode,
  meId,
  actions,
  showNotes = true,
}: {
  family: FamilyContextView;
  teamCode: string; // The team's URL code
  meId: string;
  actions?: ReactNode; // Buttons under the family's details, e.g. Message or Invite
  showNotes?: boolean;
}) {
  const base = teamPath(teamCode);
  const reach = reachText[family.reach];

  return (
    <div>
      <Section title="Family">
        <ul className="space-y-1.5">
          {family.kids.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{k.name}</span>
              {family.status === "joined" && !k.linked && <Badge tone="warning">Not linked</Badge>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm text-muted">{family.parentNames.join(", ") || "No name on file"}</p>
        <p className="truncate text-sm text-muted" title={family.email}>{family.email}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">{familyStatusBadge[family.status]}</div>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <span className="mt-px shrink-0">{reach.icon}</span>
          {reach.text}
        </p>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </Section>

      <Section title="Next two weeks">
        {family.upcoming.length === 0 ? (
          <p className="text-sm text-muted">Nothing on the schedule.</p>
        ) : (
          <ul className="space-y-2.5">
            {family.upcoming.map((e) => (
              <li key={e.key}>
                <Link to={`${base}/rsvps/${e.type}/${e.id}`} className="group block rounded-lg -mx-2 px-2 py-1 hover:bg-surface-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold group-hover:text-primary">{e.title}</span>
                    <span className="shrink-0 text-xs text-muted tabular">
                      {formatGameDate(e.date, { weekday: "short", month: "short", day: "numeric" })}
                      {e.time ? ` · ${formatGameTime(e.time)}` : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.answers.map((a) => (
                      <Badge key={a.playerId} tone={a.status ? rsvpTone[a.status] : "neutral"}>
                        {e.answers.length > 1 && `${a.name}: `}
                        {a.status ? RSVP_LABELS[a.status] : "No answer"}
                      </Badge>
                    ))}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Announcements">
        {family.announcements.length === 0 ? (
          <p className="text-sm text-muted">None sent to this family yet.</p>
        ) : (
          <ul className="space-y-1">
            {family.announcements.map((a) => {
              const state = announcementState[a.state];
              return (
                <li key={a.id}>
                  <Link
                    to={`${base}/announcements/${a.id}?family=${encodeURIComponent(family.email)}`}
                    className="group -mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-surface-2"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium group-hover:text-primary">{a.subject}</span>
                      <span className="block text-xs text-subtle">{formatMessageTime(a.createdAt)}</span>
                    </span>
                    <Badge tone={state.tone} className="shrink-0">{state.label}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {showNotes && (
        <Section title="Notes" className="[&>h3]:sr-only">
          <FamilyNotes notes={family.notes} familyEmail={family.notesEmail} meId={meId} />
        </Section>
      )}
    </div>
  );
}

// Beside the team chat: who reads it, and who isn't on the app yet
export function TeamChatContext({ context, teamCode }: { context: TeamChatContextView; teamCode: string }) {
  const base = teamPath(teamCode);
  return (
    <div>
      <Section title="Who sees this">
        <p className="flex items-center gap-2 text-sm">
          <UsersThree size={18} className="text-primary" />
          <span>
            <strong className="tabular">{context.joined}</strong> of <span className="tabular">{context.total}</span> families are on the app
          </span>
        </p>
        <p className="mt-2 text-xs text-muted">
          Team chat reaches families on the app only. To reach everyone, including families who get email, send an announcement.
        </p>
        <Link to={`${base}/announcements/new`} className={buttonClass({ variant: "secondary", size: "sm", className: "mt-3" })}>
          New announcement
        </Link>
      </Section>
      {context.notJoined.length > 0 && (
        <Section title={`Not on the app · ${context.notJoined.length}`}>
          <ul className="space-y-1.5">
            {context.notJoined.map((f) => (
              <li key={f.email} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{f.label}</span>
                {familyStatusBadge[f.status]}
              </li>
            ))}
          </ul>
          <Link to={`${base}/families`} className={buttonClass({ variant: "ghost", size: "sm", className: "mt-3 -ml-3" })}>
            Invite families
          </Link>
        </Section>
      )}
    </div>
  );
}
