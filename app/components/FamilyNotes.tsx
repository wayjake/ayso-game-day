import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { formatMessageDateTime } from "~/utils/dates";
import { Button, cx, inputClass } from "~/components/ui";
import { LockSimple, Trash } from "@phosphor-icons/react";

// Coach-only notes about a family. The route's action handles
// `_action=addNote` (familyEmail, body) and `_action=deleteNote` (noteId).

export type FamilyNoteView = {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
};

export function FamilyNotes({ notes, familyEmail, meId }: { notes: FamilyNoteView[]; familyEmail: string; meId: string }) {
  const fetcher = useFetcher<{ error?: string }>();
  const formRef = useRef<HTMLFormElement>(null);
  const adding = fetcher.state !== "idle" && fetcher.formData?.get("_action") === "addNote";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) formRef.current?.reset();
  }, [fetcher.state, fetcher.data]);

  return (
    <section aria-labelledby="notes-heading" data-tour="family-notes">
      <h3 id="notes-heading" className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        <LockSimple size={14} weight="bold" />
        Notes · coaches only
      </h3>

      <fetcher.Form ref={formRef} method="post" className="mb-3 flex items-start gap-2">
        <input type="hidden" name="_action" value="addNote" />
        <input type="hidden" name="familyEmail" value={familyEmail} />
        <label htmlFor="note-body" className="sr-only">Add a note</label>
        <textarea
          id="note-body"
          name="body"
          rows={2}
          required
          maxLength={2000}
          placeholder="Prefers texts, works nights…"
          className={cx(inputClass, "min-h-11 resize-y py-2")}
        />
        <Button type="submit" variant="secondary" size="sm" className="mt-0.5 h-10" disabled={adding}>
          {adding ? "Saving…" : "Add"}
        </Button>
      </fetcher.Form>

      {notes.length === 0 ? (
        <p className="text-sm text-subtle">Nothing yet. Families never see these.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="group rounded-xl bg-warning-soft/60 px-3 py-2 ring-1 ring-warning/15">
              <p className="whitespace-pre-wrap break-words text-sm text-ink">{n.body}</p>
              <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted">
                <span>
                  {n.authorName} · {formatMessageDateTime(n.createdAt)}
                </span>
                {n.authorId === meId && (
                  <fetcher.Form method="post">
                    <input type="hidden" name="_action" value="deleteNote" />
                    <input type="hidden" name="noteId" value={n.id} />
                    <button type="submit" className="tap flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface hover:text-danger" aria-label="Delete note">
                      <Trash size={14} />
                    </button>
                  </fetcher.Form>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
