import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import { BellRinging, CheckCircle, HandHeart, Plus } from "@phosphor-icons/react";
import { DETAILS_MAX, JOB_TIMINGS, SPOTS_MAX, TIMING_LABELS, TITLE_MAX, openSpots, timingPhrase, type JobView } from "~/utils/jobs";
import { Card, buttonClass, cx, inputClass, labelClass } from "~/components/ui";

// Jobs on one event, as a family sees them: who has each one, "I'll do it"
// for open volunteer spots, and "Can't do it" for their own.
export function FamilyEventJobs({
  jobs,
  myPlayerIds,
  signUpAs,
  canChange,
}: {
  jobs: JobView[];
  myPlayerIds: string[];
  signUpAs: string | null; // One of their kids on this team: the family's spot is kept under them
  canChange: boolean;
}) {
  if (jobs.length === 0) return null;
  return (
    <div className="border-t border-line px-4 py-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted">
        <HandHeart size={14} weight="fill" />
        Jobs
      </h3>
      <ul className="space-y-2">
        {jobs.map((job) => (
          <FamilyJobRow key={job.id} job={job} myPlayerIds={myPlayerIds} signUpAs={signUpAs} canChange={canChange} />
        ))}
      </ul>
    </div>
  );
}

function FamilyJobRow({ job, myPlayerIds, signUpAs, canChange }: { job: JobView; myPlayerIds: string[]; signUpAs: string | null; canChange: boolean }) {
  const fetcher = useFetcher<{ error?: string }>();
  const busy = fetcher.state !== "idle";
  const mine = job.holders.find((h) => h.playerId && myPlayerIds.includes(h.playerId));
  const open = openSpots(job);
  const when = timingPhrase(job.timing, job.eventType);
  const others = job.holders.filter((h) => h !== mine);

  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="min-w-0 flex-1">
          <span className="font-semibold">{job.title}</span>
          {when && <span className="text-muted"> · {when}</span>}
          <div className="text-muted">
            {mine ? (
              <span className="inline-flex items-center gap-1 font-medium text-success">
                <CheckCircle size={16} weight="fill" />
                You{others.length > 0 ? `, ${others.map((h) => h.label).join(", ")}` : ""}
              </span>
            ) : (
              others.map((h) => h.label).join(", ")
            )}
            {open > 0 && (
              <span>
                {job.holders.length > 0 ? " · " : ""}
                {job.mode === "volunteer" ? (open === 1 ? "1 spot open" : `${open} spots open`) : "Coaches will assign"}
              </span>
            )}
          </div>
          {job.details && <div className="text-muted">{job.details}</div>}
        </div>
        {canChange && mine && (
          <fetcher.Form method="post">
            <input type="hidden" name="_action" value="giveBack" />
            <input type="hidden" name="signupId" value={mine.signupId} />
            <button type="submit" disabled={busy} className={buttonClass({ size: "sm", variant: "ghost" })}>
              Can't do it
            </button>
          </fetcher.Form>
        )}
        {canChange && !mine && signUpAs && job.mode === "volunteer" && open > 0 && (
          <fetcher.Form method="post">
            <input type="hidden" name="_action" value="volunteer" />
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="playerId" value={signUpAs} />
            <button type="submit" disabled={busy} className={buttonClass({ size: "sm", variant: "secondary" })}>
              I'll do it
            </button>
          </fetcher.Form>
        )}
      </div>
      {fetcher.data?.error && <p className={cx("mt-1 text-sm text-danger")}>{fetcher.data.error}</p>}
    </li>
  );
}

export type AssignOption = { value: string; label: string };

// Jobs on one event, as staff manage them: add, edit, put people on, take
// them off, delete, and remind now.
export function StaffEventJobs({
  jobs,
  families,
  staff,
  canRemind,
}: {
  jobs: JobView[];
  families: (AssignOption & { playerIds: string[] })[];
  staff: (AssignOption & { userId: string })[];
  canRemind: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="mb-8">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <HandHeart size={18} weight="fill" className="text-primary" />
          Jobs <span className="font-normal text-subtle tabular">{jobs.length}</span>
        </h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className={buttonClass({ size: "sm", variant: "secondary" })}>
            <Plus size={16} weight="bold" />
            Add a job
          </button>
        )}
      </div>
      {adding && (
        <Card className="mb-3 p-4">
          <JobForm intent="addJob" submitLabel="Add job" onDone={() => setAdding(false)} />
        </Card>
      )}
      {jobs.length === 0 && !adding ? (
        <p className="text-sm text-muted">Snacks, setting up the goals, bringing the tent: add what this event needs, and families can sign up or you can assign them.</p>
      ) : (
        <ul className="space-y-3">
          {jobs.map((job) => (
            <StaffJobCard key={job.id} job={job} families={families} staff={staff} canRemind={canRemind} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StaffJobCard({
  job,
  families,
  staff,
  canRemind,
}: {
  job: JobView;
  families: (AssignOption & { playerIds: string[] })[];
  staff: (AssignOption & { userId: string })[];
  canRemind: boolean;
}) {
  const fetcher = useFetcher<{ error?: string; message?: string }>();
  const [editing, setEditing] = useState(false);
  const busy = fetcher.state !== "idle";
  const open = openSpots(job);
  const when = timingPhrase(job.timing, job.eventType);
  const takenPlayers = new Set(job.holders.flatMap((h) => (h.playerId ? families.find((f) => f.playerIds.includes(h.playerId!))?.playerIds ?? [h.playerId] : [])));
  const takenStaff = new Set(job.holders.map((h) => h.userId).filter(Boolean));
  const choices = [
    ...families.filter((f) => !f.playerIds.some((p) => takenPlayers.has(p))),
    ...staff.filter((s) => !takenStaff.has(s.userId)),
  ];
  const hidden = (name: string, value: string) => <input type="hidden" name={name} value={value} />;

  return (
    <li>
      <Card className="p-4">
        {editing ? (
          <JobForm intent="editJob" jobId={job.id} defaults={job} submitLabel="Save" onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold">{job.title}</div>
                <div className="text-sm text-muted">
                  {[when && when[0].toUpperCase() + when.slice(1), job.mode === "volunteer" ? "Families sign up" : "Staff assign", `${job.holders.length} of ${job.spots} filled`].filter(Boolean).join(" · ")}
                </div>
                {job.details && <div className="text-sm text-muted">{job.details}</div>}
              </div>
              <div className="flex gap-1">
                <button type="button" onClick={() => setEditing(true)} className={buttonClass({ size: "sm", variant: "ghost" })}>
                  Edit
                </button>
                <fetcher.Form method="post" onSubmit={(e) => { if (!confirm(`Delete ${job.title}? Who was on it is forgotten too.`)) e.preventDefault(); }}>
                  {hidden("_action", "deleteJob")}
                  {hidden("jobId", job.id)}
                  <button type="submit" disabled={busy} className={buttonClass({ size: "sm", variant: "ghost", className: "text-danger" })}>
                    Delete
                  </button>
                </fetcher.Form>
              </div>
            </div>

            {job.holders.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-xl ring-1 ring-line">
                {job.holders.map((h) => (
                  <li key={h.signupId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium">{h.label}</span>
                    <fetcher.Form method="post">
                      {hidden("_action", "unassign")}
                      {hidden("signupId", h.signupId)}
                      <button type="submit" disabled={busy} className="tap rounded text-sm text-muted hover:text-danger hover:underline">
                        Take off
                      </button>
                    </fetcher.Form>
                  </li>
                ))}
              </ul>
            )}

            {open > 0 && choices.length > 0 && (
              <fetcher.Form method="post" className="mt-3 flex gap-2">
                {hidden("_action", "assign")}
                {hidden("jobId", job.id)}
                <select name="who" required defaultValue="" aria-label={`Who's doing ${job.title}`} className={cx(inputClass, "min-w-0 flex-1")}>
                  <option value="" disabled>
                    Put someone on it…
                  </option>
                  {families.some((f) => choices.includes(f)) && (
                    <optgroup label="Families">
                      {choices.filter((c): c is AssignOption & { playerIds: string[] } => "playerIds" in c).map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </optgroup>
                  )}
                  {choices.some((c) => "userId" in c) && (
                    <optgroup label="Staff">
                      {choices.filter((c) => "userId" in c).map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <button type="submit" disabled={busy} className={buttonClass({ variant: "secondary" })}>
                  Add
                </button>
              </fetcher.Form>
            )}

            {canRemind && (job.holders.length > 0 || (job.mode === "volunteer" && open > 0)) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {job.holders.length > 0 && (
                  <fetcher.Form method="post">
                    {hidden("_action", "remindJob")}
                    {hidden("jobId", job.id)}
                    <button type="submit" disabled={busy} className={buttonClass({ size: "sm", variant: "secondary" })}>
                      <BellRinging size={16} />
                      Remind {job.holders.length === 1 ? job.holders[0].label : `all ${job.holders.length}`}
                    </button>
                  </fetcher.Form>
                )}
                {job.mode === "volunteer" && open > 0 && (
                  <fetcher.Form method="post">
                    {hidden("_action", "askJob")}
                    {hidden("jobId", job.id)}
                    <button type="submit" disabled={busy} className={buttonClass({ size: "sm", variant: "secondary" })}>
                      <BellRinging size={16} />
                      Ask families to sign up
                    </button>
                  </fetcher.Form>
                )}
              </div>
            )}
          </>
        )}
        {fetcher.data?.error && <p className="mt-2 text-sm text-danger">{fetcher.data.error}</p>}
        {fetcher.data?.message && <p className="mt-2 text-sm text-success">{fetcher.data.message}</p>}
      </Card>
    </li>
  );
}

function JobForm({
  intent,
  jobId,
  defaults,
  submitLabel,
  onDone,
}: {
  intent: "addJob" | "editJob";
  jobId?: string;
  defaults?: Pick<JobView, "title" | "details" | "timing" | "mode" | "spots">;
  submitLabel: string;
  onDone: () => void;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const id = useId();
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
  }, [fetcher.state, fetcher.data, onDone]);

  return (
    <fetcher.Form method="post" className="space-y-3">
      <input type="hidden" name="_action" value={intent} />
      {jobId && <input type="hidden" name="jobId" value={jobId} />}
      <div>
        <label htmlFor={`${id}-title`} className={labelClass}>Job</label>
        <input id={`${id}-title`} name="title" required maxLength={TITLE_MAX} defaultValue={defaults?.title ?? ""} placeholder="Snacks" list={`${id}-ideas`} className={inputClass} />
        <datalist id={`${id}-ideas`}>
          {JOB_IDEAS.map((idea) => <option key={idea} value={idea} />)}
        </datalist>
      </div>
      <div>
        <label htmlFor={`${id}-details`} className={labelClass}>
          Details <span className="font-normal text-muted">(optional)</span>
        </label>
        <input id={`${id}-details`} name="details" maxLength={DETAILS_MAX} defaultValue={defaults?.details ?? ""} placeholder="Nut-free please" className={inputClass} />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-timing`} className={labelClass}>When</label>
          <select id={`${id}-timing`} name="timing" defaultValue={defaults?.timing ?? ""} className={inputClass}>
            <option value="">Any time</option>
            {JOB_TIMINGS.map((t) => <option key={t} value={t}>{TIMING_LABELS[t]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-spots`} className={labelClass}>How many people</label>
          <input id={`${id}-spots`} name="spots" type="number" min={1} max={SPOTS_MAX} required defaultValue={defaults?.spots ?? 1} className={inputClass} />
        </div>
      </div>
      <fieldset>
        <legend className={labelClass}>Who fills it</legend>
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="volunteer" defaultChecked={(defaults?.mode ?? "volunteer") === "volunteer"} className="mt-0.5" />
            <span><span className="font-medium">Families sign up</span> <span className="text-muted">on their schedule. You can still put someone on it.</span></span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" value="assigned" defaultChecked={defaults?.mode === "assigned"} className="mt-0.5" />
            <span><span className="font-medium">Staff assign</span> <span className="text-muted">it. Families see who has it and can give theirs back.</span></span>
          </label>
        </div>
      </fieldset>
      {fetcher.data?.error && <p className="text-sm text-danger">{fetcher.data.error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={buttonClass({})}>
          {busy ? "Saving…" : submitLabel}
        </button>
        <button type="button" onClick={onDone} className={buttonClass({ variant: "ghost" })}>
          Cancel
        </button>
      </div>
    </fetcher.Form>
  );
}

const JOB_IDEAS = ["Snacks", "Set up goals", "Take down goals", "Bring the tent", "Take the tent home", "Tournament check-in"];
