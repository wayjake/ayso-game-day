import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { PaperPlaneTilt, UserPlus, X } from "@phosphor-icons/react";
import { Badge, Button, Card, CardHeader, PlayerAvatar, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import type { FamilyHousehold, HouseholdActionResult, HouseholdMember } from "~/utils/family-household";

// Family Settings: the kids, and the parents and guardians who can see them,
// one card per team. Families add, invite and remove people themselves; the
// family-household.server.ts helpers do the checking.

type Result = HouseholdActionResult;

const STATUS: Record<HouseholdMember["status"], { label: string; tone: "success" | "neutral" | "warning" }> = {
  joined: { label: "On the app", tone: "success" },
  invited: { label: "Invited", tone: "neutral" },
  expired: { label: "Invite expired", tone: "warning" },
  "not-invited": { label: "Not invited yet", tone: "warning" },
};

export function FamilyMembersCard({ household, showTeam }: { household: FamilyHousehold; showTeam: boolean }) {
  const fetcher = useFetcher<Result>();
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const busy = fetcher.state !== "idle";
  const result = fetcher.state === "idle" ? fetcher.data : undefined;
  const kids = household.kids.map((k) => k.name.split(" ")[0]);
  const kidNames = kids.length <= 1 ? kids.join("") : `${kids.slice(0, -1).join(", ")} & ${kids.at(-1)}`;

  useEffect(() => {
    if (result?.ok) {
      setAdding(false);
      setConfirmRemove(null);
      form.current?.reset();
    }
  }, [result]);

  return (
    <Card className="p-5">
      <CardHeader title="Your family" className="mb-1" />
      {showTeam && <p className="mb-3 text-sm text-muted">{household.teamName}</p>}

      <ul className="mt-3 space-y-2">
        {household.kids.map((kid) => (
          <li key={kid.id} className="flex items-center gap-3">
            <PlayerAvatar player={kid} size="sm" />
            <span className="truncate font-semibold">{kid.name}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-5 text-xs font-semibold tracking-wide text-muted uppercase">Parents and guardians</h3>
      <ul className="mt-1 divide-y divide-line">
        {household.members.map((m) => (
          <li key={m.email} className="py-2.5">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {m.name}
                  {m.isYou ? " (you)" : ""}
                </span>
                <span className="block truncate text-xs text-muted">{m.email}</span>
              </span>
              {!m.isYou && <Badge tone={STATUS[m.status].tone}>{STATUS[m.status].label}</Badge>}
            </div>
            {!m.isYou && (m.status === "expired" || m.status === "not-invited" || (!m.staff && confirmRemove !== m.email)) && (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {(m.status === "expired" || m.status === "not-invited") && !m.staff && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="_action" value="inviteFamilyMember" />
                    <input type="hidden" name="teamId" value={household.teamId} />
                    <input type="hidden" name="email" value={m.email} />
                    <Button type="submit" size="sm" variant="secondary" disabled={busy}>
                      <PaperPlaneTilt size={14} />
                      Send invite
                    </Button>
                  </fetcher.Form>
                )}
                {!m.staff && confirmRemove !== m.email && (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(m.email)}>
                    <X size={14} weight="bold" />
                    Remove
                  </Button>
                )}
              </div>
            )}
            {confirmRemove === m.email && (
              <fetcher.Form method="post" className="mt-2 rounded-xl bg-surface-2 p-3">
                <input type="hidden" name="_action" value="removeFamilyMember" />
                <input type="hidden" name="teamId" value={household.teamId} />
                <input type="hidden" name="email" value={m.email} />
                <p className="text-sm">
                  Remove {m.name.split(" ")[0]}? They'll lose access to {kidNames}'s schedule, messages and finances on {household.teamName}.
                </p>
                <div className="mt-2 flex gap-2">
                  <Button type="submit" size="sm" variant="danger" disabled={busy}>Remove</Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                </div>
              </fetcher.Form>
            )}
            {m.staff && !m.isYou && <p className="mt-1 text-xs text-muted">On the team staff. Ask your coach to make changes.</p>}
          </li>
        ))}
      </ul>

      {adding ? (
        <fetcher.Form ref={form} method="post" className="mt-3 space-y-3 rounded-xl bg-surface-2 p-3">
          <input type="hidden" name="_action" value="addFamilyMember" />
          <input type="hidden" name="teamId" value={household.teamId} />
          <div>
            <label htmlFor={`member-name-${household.teamId}`} className={labelClass}>Name</label>
            <input id={`member-name-${household.teamId}`} name="name" required autoComplete="off" className={inputClass} placeholder="Alex Garcia" />
          </div>
          <div>
            <label htmlFor={`member-email-${household.teamId}`} className={labelClass}>Email</label>
            <input
              id={`member-email-${household.teamId}`}
              name="email"
              type="email"
              required
              autoComplete="off"
              inputMode="email"
              className={inputClass}
              placeholder="alex@example.com"
            />
            <p className={hintClass}>
              They'll get an email invite to join BenchTalk as {kidNames}'s family, and see the same schedule, messages and finances you do.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              <UserPlus size={14} />
              Add and invite
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </fetcher.Form>
      ) : (
        <Button size="sm" variant="secondary" className="mt-3" onClick={() => setAdding(true)}>
          <UserPlus size={14} />
          Add a parent or guardian
        </Button>
      )}

      {result && (
        <p className={cx("mt-3 text-sm", !result.ok ? "text-danger" : result.warning ? "text-warning" : "text-success")} role="status">
          {result.ok ? result.message : result.error}
        </p>
      )}
      <p className="mt-4 text-xs text-muted">Missing a player? Ask their coach to add this email to their contacts.</p>
    </Card>
  );
}
