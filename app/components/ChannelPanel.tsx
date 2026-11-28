import { useEffect, useState } from "react";
import { Form, useFetcher } from "react-router";
import { Archive, ArrowCounterClockwise, PencilSimple, SignOut, UserPlus, X } from "@phosphor-icons/react";
import { PeopleChecklist } from "~/components/PeoplePicker";
import { StaffBadge } from "~/components/StaffBadge";
import { Badge, Button, cx, hintClass, inputClass, labelClass } from "~/components/ui";
import {
  AUDIENCE_OPTIONS,
  CHANNEL_AUDIENCES,
  MAX_CHANNEL_NAME,
  MAX_CHANNEL_TOPIC,
  usesMembers,
  type ChannelAudience,
  type ChannelInfo,
} from "~/utils/channels";

// The fields a channel is made of: on New channel and when staff edit one.
export function ChannelFields({
  defaults,
  audience,
  onAudience,
  idPrefix = "channel",
}: {
  defaults?: { name: string; topic: string | null; staffOnlyPosts: boolean };
  audience: ChannelAudience;
  onAudience: (audience: ChannelAudience) => void;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={labelClass}>Name</label>
        <div className="relative">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-muted" aria-hidden>
            #
          </span>
          <input
            id={`${idPrefix}-name`}
            name="name"
            required
            maxLength={MAX_CHANNEL_NAME}
            defaultValue={defaults?.name ?? ""}
            placeholder="Tournament travel, Snacks, Carpool"
            autoComplete="off"
            className={cx(inputClass, "pl-7")}
          />
        </div>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-topic`} className={labelClass}>
          What it's for <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-topic`}
          name="topic"
          maxLength={MAX_CHANNEL_TOPIC}
          defaultValue={defaults?.topic ?? ""}
          placeholder="Hotel, rides and schedule for the Vegas tournament"
          autoComplete="off"
          className={inputClass}
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-medium text-ink">Who's in it</legend>
        {CHANNEL_AUDIENCES.map((value) => (
          <label
            key={value}
            className="flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ring-line transition hover:bg-surface-2 has-[:checked]:bg-primary-soft has-[:checked]:ring-primary"
          >
            <input type="radio" name="audience" value={value} checked={audience === value} onChange={() => onAudience(value)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-semibold">{AUDIENCE_OPTIONS[value].label}</span>
              <span className="block text-sm text-muted">{AUDIENCE_OPTIONS[value].detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {audience !== "staff" && (
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" name="staffOnlyPosts" value="1" defaultChecked={defaults?.staffOnlyPosts ?? false} className="mt-0.5" />
          <span className="text-sm">
            <span className="block font-semibold">Only staff post</span>
            <span className="block text-muted">Families can still react and reply in threads. Good for updates.</span>
          </span>
        </label>
      )}
    </div>
  );
}

// Beside a channel: what it's for, who's in it, and for staff, editing,
// picking people and archiving. Posts to the thread route's action (channel* intents).
export function ChannelPanel({ channel, meId, className }: { channel: ChannelInfo; meId: string; className?: string }) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [editing, setEditing] = useState(false);
  const [audience, setAudience] = useState<ChannelAudience>(channel.audience);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<"leave" | "archive" | null>(null);
  const busy = fetcher.state !== "idle";
  const picked = usesMembers(channel.audience);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setEditing(false);
      setAdding(false);
      setToAdd([]);
      setConfirm(null);
    }
  }, [fetcher.state, fetcher.data]);
  useEffect(() => setAudience(channel.audience), [channel.audience]);

  return (
    <div className={cx("space-y-4", className)}>
      {editing ? (
        <fetcher.Form method="post" className="space-y-3">
          <input type="hidden" name="_action" value="channelSave" />
          <ChannelFields defaults={channel} audience={audience} onAudience={setAudience} idPrefix="channel-edit" />
          {audience === "private" && channel.audience !== "private" && (
            <p className={hintClass}>Only the people already picked stay in it, plus you. Add anyone else after saving.</p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setAudience(channel.audience); }}>Cancel</Button>
          </div>
        </fetcher.Form>
      ) : (
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">About</h2>
            {channel.canManage && !channel.archived && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <PencilSimple size={14} />
                Edit
              </Button>
            )}
          </div>
          <p className="mt-0.5 font-semibold"># {channel.name}</p>
          {channel.topic && <p className="mt-0.5 text-sm text-ink">{channel.topic}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={channel.audience === "private" ? "warning" : "neutral"}>{channel.audienceLabel}</Badge>
            {channel.staffOnlyPosts && <Badge>Only staff post</Badge>}
            {channel.archived && <Badge>Archived</Badge>}
          </div>
          <p className="mt-2 text-xs text-muted">{AUDIENCE_OPTIONS[channel.audience].about}</p>
        </div>
      )}

      {picked && !editing && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
              {channel.audience === "families"
                ? `${channel.members.length} ${channel.members.length === 1 ? "family" : "families"}, plus all staff`
                : `${channel.members.length} ${channel.members.length === 1 ? "person" : "people"}`}
            </h2>
            {channel.canManage && !adding && channel.addable.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                <UserPlus size={14} />
                Add
              </Button>
            )}
          </div>

          {adding && (
            <fetcher.Form method="post" className="mt-2 rounded-xl bg-surface p-3 ring-1 ring-line">
              <input type="hidden" name="_action" value="channelAdd" />
              {toAdd.map((k) => (
                <input key={k} type="hidden" name="key" value={k} />
              ))}
              <PeopleChecklist
                options={channel.addable}
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

          {channel.members.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nobody picked yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {channel.members.map((m) => (
                <li key={m.id} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-semibold">
                        {m.name}
                        {m.userId === meId ? " (you)" : ""}
                      </span>
                      {m.role && <StaffBadge role={m.role} short />}
                    </span>
                    {(m.detail || m.pending) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        {m.detail && <span className="truncate">{m.detail}</span>}
                        {m.pending && <Badge tone="warning">Not on the app yet</Badge>}
                      </span>
                    )}
                  </span>
                  {channel.canManage && !channel.archived && m.userId !== meId && (
                    <fetcher.Form method="post">
                      <input type="hidden" name="_action" value="channelRemove" />
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
          )}
          {channel.members.some((m) => m.pending) && (
            <p className="mt-1 text-xs text-muted">Families not on the app yet see this channel, history included, once they join.</p>
          )}
        </div>
      )}

      {fetcher.data?.error && <p className="text-sm text-danger">{fetcher.data.error}</p>}

      {!editing && (channel.canManage || channel.canLeave) && (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          {confirm === "leave" ? (
            // A navigation, not a fetcher: the page is gone afterwards and the action redirects to the list
            <Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="_action" value="channelLeave" />
              <span className="text-sm">Leave this channel? You won't see it anymore.</span>
              <Button type="submit" size="sm" variant="danger">Leave</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            </Form>
          ) : confirm === "archive" ? (
            <fetcher.Form method="post" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="_action" value="channelArchive" />
              <span className="text-sm">
                Archive this channel? Nobody can post, and it leaves everyone's list. Staff who could read it find it under Archived and can bring it back.
              </span>
              <Button type="submit" size="sm" variant="danger" disabled={busy}>Archive</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            </fetcher.Form>
          ) : (
            <>
              {channel.canManage &&
                (channel.archived ? (
                  <fetcher.Form method="post">
                    <input type="hidden" name="_action" value="channelUnarchive" />
                    <Button type="submit" size="sm" variant="secondary" disabled={busy}>
                      <ArrowCounterClockwise size={14} />
                      Unarchive
                    </Button>
                  </fetcher.Form>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm("archive")}>
                    <Archive size={14} />
                    Archive
                  </Button>
                ))}
              {channel.canLeave && (
                <Button size="sm" variant="danger-soft" onClick={() => setConfirm("leave")}>
                  <SignOut size={14} />
                  Leave channel
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
