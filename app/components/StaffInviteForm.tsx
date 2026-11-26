import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Form, useNavigation } from "react-router";
import { Check, Copy, LinkSimple, PaperPlaneTilt } from "@phosphor-icons/react";
import { Alert, Button, cx, inputClass, labelClass } from "~/components/ui";
import { STAFF_ROLES, staffRoleLabel } from "~/utils/team-roles";
import type { StaffInviteResult } from "~/utils/staff-invites.server";

// Invite someone to the team staff. On a team's Settings page it's for that
// team only (teamId); on the Account page the owner picks from their teams
// (teams). The route's action handles `_action=invite` with `email`, `role`
// and one or more `teamIds` (see inviteStaff in staff-invites.server.ts).

export function StaffInviteForm({
  teamId,
  teams,
  emailConfigured,
  error,
  invite,
}: {
  /** One team: the invite is for it, no picker */
  teamId?: string;
  /** Several teams the user owns: pick any of them */
  teams?: { id: string; name: string }[];
  emailConfigured: boolean;
  error?: string | null;
  invite?: StaffInviteResult | null;
}) {
  const navigation = useNavigation();
  const busy = navigation.state === "submitting" && navigation.formData?.get("_action") === "invite";
  // How many teams are ticked, only to enable the button. The checkboxes themselves
  // are left to the browser, so a tick made before the page finishes loading sticks.
  const [pickedCount, setPickedCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const count = () => setPickedCount(formRef.current?.querySelectorAll('input[name="teamIds"]:checked').length ?? 0);
  useEffect(count, []);
  const picking = !teamId && (teams?.length ?? 0) > 1;

  return (
    <>
      <Form ref={formRef} method="post" className="mt-5 space-y-4" onChange={count}>
        <input type="hidden" name="_action" value="invite" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label htmlFor="inviteEmail" className={labelClass}>Email</label>
            <input id="inviteEmail" name="email" type="email" required placeholder="coach@example.com" className={inputClass} />
          </div>
          <div>
            <label htmlFor="inviteRole" className={labelClass}>Role</label>
            <RoleSelect id="inviteRole" name="role" defaultValue="coach" className="h-[42px]" />
          </div>
        </div>
        {teamId != null && <input type="hidden" name="teamIds" value={teamId} />}
        {!picking && teams?.length === 1 && (
          <>
            <input type="hidden" name="teamIds" value={teams[0].id} />
            <p className="text-sm text-muted">
              Invites them to <span className="font-medium text-ink">{teams[0].name}</span>.
            </p>
          </>
        )}
        {picking && (
          <fieldset>
            <legend className={labelClass}>Teams</legend>
            <div className="divide-y divide-line rounded-lg border border-line-strong">
              {teams!.map((t) => (
                <label key={t.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm transition hover:bg-surface-2">
                  <input
                    type="checkbox"
                    name="teamIds"
                    value={t.id}
                    className="h-4 w-4 shrink-0"
                  />
                  <span className="min-w-0 truncate font-medium">{t.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="pt-1">
          <Button type="submit" disabled={busy || (picking && pickedCount === 0)}>
            {emailConfigured ? <PaperPlaneTilt size={18} /> : <LinkSimple size={18} />}
            {busy ? "Sending…" : emailConfigured ? "Send invite" : "Create invite link"}
          </Button>
        </div>
        {error && <Alert className="mt-4">{error}</Alert>}
      </Form>

      {invite && (
        <div className="mt-5 space-y-3">
          <Alert tone={invite.emailed ? "success" : "warning"}>
            {invite.emailed
              ? `Invite emailed to ${invite.email} for ${invite.teamNames.join(", ")}.`
              : `Invite created for ${invite.email} (${invite.teamNames.join(", ")}). ${
                  emailConfigured ? "The email didn't send" : "Email isn't set up yet"
                }, so send them this link yourself:`}
          </Alert>
          {invite.skippedTeams.length > 0 && (
            <p className="text-sm text-muted">Already on the staff of {invite.skippedTeams.join(", ")}.</p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs text-ink ring-1 ring-line">
              {invite.url}
            </code>
            <CopyButton value={invite.url} />
          </div>
        </div>
      )}
    </>
  );
}

export function RoleSelect({ className, ...props }: ComponentProps<"select">) {
  return (
    <select {...props} className={cx(inputClass, "w-auto py-1.5 pr-8", className)}>
      {STAFF_ROLES.map((r) => (
        <option key={r} value={r}>{staffRoleLabel(r)}</option>
      ))}
    </select>
  );
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link", value);
        }
      }}
    >
      {copied ? <Check size={16} weight="bold" className="text-success" /> : <Copy size={16} />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}
