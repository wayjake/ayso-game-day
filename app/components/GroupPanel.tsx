import { useEffect, useState } from "react";
import { Form, useFetcher } from "react-router";
import { PencilSimple, SignOut, UserPlus, X } from "@phosphor-icons/react";
import { PeopleChecklist } from "~/components/PeoplePicker";
import { StaffBadge } from "~/components/StaffBadge";
import { Badge, Button, cx, inputClass } from "~/components/ui";
import { MAX_GROUP_NAME, type GroupMember, type PickerOption } from "~/utils/groups";

// Who's in a group chat. The organizer (whoever started it, or the longest-
// standing member once they leave) can rename it and add or remove
// people; anyone can leave. Posts to the thread route's action (group* intents).

export type GroupInfo = {
  name: string | null;
  members: GroupMember[];
  managerId: string | null;
  canManage: boolean;
  addable: PickerOption[];
};

export function GroupPanel({ group, meId, className }: { group: GroupInfo; meId: string; className?: string }) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const busy = fetcher.state !== "idle";

  // Close the editors once the change is saved
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setRenaming(false);
      setAdding(false);
      setToAdd([]);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <div className={cx("space-y-4", className)}>
      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">Group name</h2>
          {group.canManage && !renaming && (
            <Button size="sm" variant="ghost" onClick={() => setRenaming(true)}>
              <PencilSimple size={14} />
              {group.name ? "Rename" : "Name it"}
            </Button>
          )}
        </div>
        {renaming ? (
          <fetcher.Form method="post" className="mt-1 flex gap-2">
            <input type="hidden" name="_action" value="groupRename" />
            <label htmlFor="group-rename" className="sr-only">Group name</label>
            <input
              id="group-rename"
              name="name"
              defaultValue={group.name ?? ""}
              maxLength={MAX_GROUP_NAME}
              placeholder="No name: shows who's in it"
              className={inputClass}
              autoFocus
            />
            <Button type="submit" size="sm" disabled={busy} className="shrink-0 self-center">Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(false)} className="shrink-0 self-center">Cancel</Button>
          </fetcher.Form>
        ) : (
          <p className={cx("mt-0.5 text-sm", group.name ? "font-semibold" : "text-muted")}>{group.name ?? "No name yet"}</p>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
            {group.members.length} {group.members.length === 1 ? "person" : "people"}
          </h2>
          {group.canManage && !adding && group.addable.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <UserPlus size={14} />
              Add people
            </Button>
          )}
        </div>

        {adding && (
          <fetcher.Form method="post" className="mt-2 rounded-xl bg-surface p-3 ring-1 ring-line">
            <input type="hidden" name="_action" value="groupAdd" />
            {toAdd.map((k) => (
              <input key={k} type="hidden" name="key" value={k} />
            ))}
            <PeopleChecklist
              options={group.addable}
              selected={toAdd}
              onToggle={(key) => setToAdd((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))}
              maxHeightClass="max-h-56"
            />
            <div className="mt-2 flex gap-2">
              <Button type="submit" size="sm" disabled={busy || toAdd.length === 0}>
                Add{toAdd.length > 0 ? ` ${toAdd.length}` : ""}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setToAdd([]); }}>Cancel</Button>
            </div>
          </fetcher.Form>
        )}

        <ul className="mt-2 divide-y divide-line">
          {group.members.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-sm font-semibold">
                    {m.name}
                    {m.userId === meId ? " (you)" : ""}
                  </span>
                  {m.role && <StaffBadge role={m.role} short />}
                </span>
                {(m.detail || m.pending || m.userId === group.managerId) && (
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                    {m.detail && <span className="truncate">{m.detail}</span>}
                    {m.userId != null && m.userId === group.managerId && <Badge>Organizer</Badge>}
                    {m.pending && <Badge tone="warning">Not on the app yet</Badge>}
                  </span>
                )}
              </span>
              {group.canManage && m.userId !== meId && (
                <fetcher.Form method="post">
                  <input type="hidden" name="_action" value="groupRemove" />
                  <input type="hidden" name="memberId" value={m.id} />
                  <Button type="submit" size="icon-sm" variant="ghost" disabled={busy} title={`Remove ${m.name}`}>
                    <X size={14} weight="bold" />
                    <span className="sr-only">Remove {m.name}</span>
                  </Button>
                </fetcher.Form>
              )}
            </li>
          ))}
        </ul>
        {group.members.some((m) => m.pending) && (
          <p className="mt-1 text-xs text-muted">Families not on the app yet see this group, history included, once they join.</p>
        )}
      </div>

      {fetcher.data?.error && <p className="text-sm text-danger">{fetcher.data.error}</p>}

      <div className="border-t border-line pt-3">
        {confirmLeave ? (
          // A navigation, not a fetcher: the page is gone afterwards and the action redirects to the list
          <Form method="post" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="_action" value="groupLeave" />
            <span className="text-sm">Leave this group? You won't see it anymore.</span>
            <Button type="submit" size="sm" variant="danger">Leave</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>Cancel</Button>
          </Form>
        ) : (
          <Button size="sm" variant="danger-soft" onClick={() => setConfirmLeave(true)}>
            <SignOut size={14} />
            Leave group
          </Button>
        )}
      </div>
    </div>
  );
}
