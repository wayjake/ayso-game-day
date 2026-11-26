import { useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router";
import { ArrowClockwise, Camera, ImagesSquare, X } from "@phosphor-icons/react";
import { makeDerivatives } from "~/utils/media-derivatives.client";
import { uploadFiles } from "~/utils/uploadthing";
import { MAX_CAPTION, MAX_FILES, MAX_VIDEOS } from "~/utils/feed";
import { Button, Card, cx, inputClass } from "~/components/ui";
import { PersonAvatar } from "~/components/PersonAvatar";

// The box at the top of the feed: add photos or videos, write a caption,
// post. Files start uploading the moment they're picked (as drafts, see
// api/feed), so "Post" usually only has to publish. While posting it keeps
// people on the page: a route blocker, beforeunload and a screen wake lock.
// Ported from disney-social's Composer, without the location parts.

type Picked = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "done" | "failed";
  loaded: number;
};

/** Upload keys of the smaller copies (feed 1280px, preview 400px), sent along when publishing */
type Copies = { displayKey: string; thumbKey: string; width: number; height: number };

// Per-file background work, outside React state so submit can await it. The
// copies are made and uploaded once per file and survive retries of the original.
type CopiesTask = { copies: Promise<Copies | null>; copiesController: AbortController };
type Task = CopiesTask & { controller: AbortController; key: Promise<string | null> };

const isVideo = (f: File) => f.type.startsWith("video/");

function discard(keys: string[]) {
  if (!keys.length) return;
  // keepalive so it still goes out when the composer unmounts on navigation
  void fetch("/api/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "discard", keys }),
    keepalive: true,
  }).catch(() => {});
}

export function Composer({
  me,
  teams,
  onPosted,
}: {
  me: { id: string; name: string };
  /** Teams this person can post to; a picker shows when there's more than one */
  teams: { id: string; name: string }[];
  onPosted: () => void;
}) {
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [focused, setFocused] = useState(false);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const libraryInput = useRef<HTMLInputElement>(null);

  const anyUploading = picked.some((p) => p.status === "uploading");

  // ——— Keep people on the page while posting ———
  // Read through a ref at navigation time: submit finishes before React
  // re-renders with posting=false.
  const postingRef = useRef(false);
  const blocker = useBlocker(() => postingRef.current);
  useEffect(() => {
    if (!posting) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [posting]);

  useEffect(() => {
    if (!posting && !anyUploading) return;
    // Stop the phone from auto-locking mid-upload, which suspends the page on iOS
    let lock: WakeLockSentinel | null = null;
    const requestLock = () =>
      navigator.wakeLock
        ?.request("screen")
        .then((l) => (lock = l))
        .catch(() => {});
    void requestLock();
    const onVisible = () => document.visibilityState === "visible" && void requestLock();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release();
    };
  }, [posting, anyUploading]);

  // ——— Background uploads ———
  const tasks = useRef(new Map<string, Task>());
  // Finished upload keys by item id: the unmount cleanup can't wait on promises
  const keys = useRef(new Map<string, string>());
  const copyKeys = useRef(new Map<string, string[]>());
  const allKeys = () => [...keys.current.values(), ...[...copyKeys.current.values()].flat()];
  const patch = (id: string, change: Partial<Picked>) => setPicked((list) => list.map((p) => (p.id === id ? { ...p, ...change } : p)));

  /** Smaller copies for the feed. Best effort: if it fails the post shows the original. */
  const uploadCopies = (id: string, file: File, team: string): CopiesTask => {
    const copiesController = new AbortController();
    const { signal } = copiesController;
    const copies = makeDerivatives(file)
      .then(async (made) => {
        if (!made || signal.aborted) return null;
        const res = await uploadFiles("feedMedia", { files: [made.display, made.thumb], input: { teamId: team }, signal });
        const uploaded = res.map((r) => r.key);
        if (signal.aborted) {
          discard(uploaded);
          return null;
        }
        copyKeys.current.set(id, uploaded);
        // By name, else by size (in case the name comes back changed)
        const keyOf = (f: File) => (res.find((r) => r.name === f.name) ?? res.find((r) => r.size === f.size))?.key;
        const displayKey = keyOf(made.display);
        const thumbKey = keyOf(made.thumb);
        return displayKey && thumbKey ? { displayKey, thumbKey, width: made.width, height: made.height } : null;
      })
      .catch(() => null);
    return { copies, copiesController };
  };

  const upload = (id: string, file: File, team: string, copies: CopiesTask) => {
    const controller = new AbortController();
    const key = uploadFiles("feedMedia", {
      files: [file],
      input: { teamId: team },
      signal: controller.signal,
      onUploadProgress: ({ loaded }) => patch(id, { loaded }),
    })
      .then(([res]) => {
        // Removed while the server was finishing up: don't leave the file behind
        if (controller.signal.aborted) {
          discard([res.key]);
          return null;
        }
        keys.current.set(id, res.key);
        patch(id, { status: "done", loaded: file.size });
        return res.key;
      })
      .catch(() => {
        if (!controller.signal.aborted) patch(id, { status: "failed" });
        return null;
      });
    tasks.current.set(id, { ...copies, controller, key });
  };

  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  // Leaving with an unposted draft: stop uploads and delete what already landed.
  // pagehide covers closing the tab, where the unmount cleanup never runs.
  useEffect(() => {
    const onPageHide = (e: PageTransitionEvent) => {
      // Kept in the back/forward cache: the draft is still here if they come back
      if (!e.persisted) discard(allKeys());
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      tasks.current.forEach((t) => {
        t.controller.abort();
        t.copiesController.abort();
      });
      discard(allKeys());
      pickedRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
  }, []);

  const onFiles = (list: File[]) => {
    if (!list.length || !teamId) return;
    setError(null);

    let room = MAX_FILES - picked.length;
    let videoRoom = MAX_VIDEOS - picked.filter((p) => isVideo(p.file)).length;
    const accepted = list.filter((file) => {
      if (room <= 0 || (isVideo(file) && videoRoom <= 0)) return false;
      room--;
      if (isVideo(file)) videoRoom--;
      return true;
    });
    if (accepted.length < list.length) setError(`Up to ${MAX_FILES} photos or videos per post, and ${MAX_VIDEOS} videos at most.`);
    if (!accepted.length) return;

    const next = accepted.map(
      (file): Picked => ({ id: crypto.randomUUID(), file, previewUrl: URL.createObjectURL(file), status: "uploading", loaded: 0 })
    );
    setPicked((prev) => [...prev, ...next]);
    for (const item of next) upload(item.id, item.file, teamId, uploadCopies(item.id, item.file, teamId));
  };

  const retry = (item: Picked) => {
    const task = tasks.current.get(item.id);
    if (!task) return;
    patch(item.id, { status: "uploading", loaded: 0 });
    upload(item.id, item.file, teamId, { copies: task.copies, copiesController: task.copiesController });
  };

  const submit = async () => {
    const items = pickedRef.current;
    if (!items.length) return;
    setError(null);
    setPosting(true);
    postingRef.current = true;
    try {
      // Usually done already; otherwise this is where the progress shows
      const files = await Promise.all(
        items.map(async (p) => {
          const task = tasks.current.get(p.id)!;
          const [key, copies] = await Promise.all([task.key, task.copies]);
          return key ? { key, ...copies } : null;
        })
      );
      const failed = files.filter((f) => !f).length;
      if (failed) {
        throw new Error(failed === 1 ? "One file didn't upload. Retry it or remove it." : `${failed} files didn't upload. Retry or remove them.`);
      }

      const res = await fetch("/api/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "publish", teamId, caption: caption.trim() || undefined, files }),
      });
      if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Couldn't post. Try again.");

      // Published: these files belong to the post now, so the unmount cleanup mustn't discard them
      items.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      tasks.current.clear();
      keys.current.clear();
      copyKeys.current.clear();
      setPicked([]);
      setCaption("");
      setFocused(false);
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't post. Try again.");
    } finally {
      postingRef.current = false;
      setPosting(false);
    }
  };

  const remove = (item: Picked) => {
    const task = tasks.current.get(item.id);
    task?.controller.abort();
    task?.copiesController.abort();
    discard([keys.current.get(item.id), ...(copyKeys.current.get(item.id) ?? [])].filter((k): k is string => Boolean(k)));
    tasks.current.delete(item.id);
    keys.current.delete(item.id);
    copyKeys.current.delete(item.id);
    URL.revokeObjectURL(item.previewUrl);
    setPicked((prev) => prev.filter((p) => p.id !== item.id));
  };

  const totalBytes = picked.reduce((n, p) => n + p.file.size, 0);
  const progress = totalBytes ? (picked.reduce((n, p) => n + Math.min(p.loaded, p.file.size), 0) / totalBytes) * 100 : 0;
  const expanded = focused || caption.length > 0 || picked.length > 0;
  const canPost = picked.length > 0 && !posting && !picked.some((p) => p.status === "failed");
  const full = posting || picked.length >= MAX_FILES;

  return (
    <Card className="p-4" data-tour="feed-composer">
      {teams.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          Post to
          <select
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            // Files upload to the team picked first, so it's fixed once there are some
            disabled={picked.length > 0}
            className={cx(inputClass, "w-auto py-1.5 pr-8")}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-3">
        <PersonAvatar person={me} className="mt-1" />
        <div className="min-w-0 flex-1">
          <label htmlFor="feed-caption" className="sr-only">
            Caption
          </label>
          <textarea
            id="feed-caption"
            rows={expanded ? 3 : 1}
            className="w-full resize-none border-0 bg-transparent py-2 text-[16px] text-ink placeholder:text-subtle focus:outline-none"
            placeholder="Share a photo or video with the team"
            maxLength={MAX_CAPTION}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (canPost) void submit();
              }
            }}
            disabled={posting}
          />

          {picked.length > 0 && (
            <ul className={cx("mt-2 grid gap-2", picked.length === 1 ? "grid-cols-1" : "grid-cols-2 sm:grid-cols-3")}>
              {picked.map((p) => (
                <li key={p.id} className={cx("relative overflow-hidden rounded-xl bg-surface-2", picked.length === 1 ? "max-h-80" : "aspect-square")}>
                  {isVideo(p.file) ? (
                    <video src={p.previewUrl} muted playsInline className="size-full object-cover" />
                  ) : (
                    <img src={p.previewUrl} alt="" className="size-full object-cover" />
                  )}
                  {p.status === "uploading" && (
                    <div
                      className="absolute inset-x-0 bottom-0 h-1 bg-ink/20"
                      role="progressbar"
                      aria-valuenow={Math.round((p.loaded / p.file.size) * 100)}
                      aria-label="Uploading"
                    >
                      <div className="h-full bg-primary transition-[width]" style={{ width: `${(p.loaded / p.file.size) * 100}%` }} />
                    </div>
                  )}
                  {p.status === "failed" && (
                    <button
                      type="button"
                      onClick={() => retry(p)}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-ink/60 text-sm font-semibold text-white"
                    >
                      <ArrowClockwise size={20} weight="bold" />
                      Upload failed. Retry
                    </button>
                  )}
                  {!posting && (
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      className="tap-area absolute right-1.5 top-1.5 grid size-8 place-items-center rounded-full bg-ink/80 text-white"
                      aria-label="Remove"
                    >
                      <X size={14} weight="bold" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {posting && (
            <div className="mt-3 rounded-xl bg-ink p-3 text-white" role="status">
              <p className="text-sm font-semibold">{anyUploading ? "Finishing upload… keep this screen open" : "Posting…"}</p>
              <p className="text-xs text-white/70">Leaving the app or locking your phone will pause or cancel the upload.</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {error && <p className="mt-3 rounded-xl bg-danger-soft p-3 text-sm text-danger">{error}</p>}

          <div className="mt-3 flex items-center gap-1 border-t border-line pt-3">
            <IconButton label="Take a photo or video" disabled={full} onClick={() => cameraInput.current?.click()}>
              <Camera size={24} />
            </IconButton>
            <IconButton label="Add photos or videos" disabled={full} onClick={() => libraryInput.current?.click()}>
              <ImagesSquare size={24} />
            </IconButton>
            {[cameraInput, libraryInput].map((ref, i) => (
              <input
                key={i}
                ref={ref}
                type="file"
                accept="image/*,video/*"
                {...(i === 0 ? { capture: "environment" } : { multiple: true })}
                hidden
                onChange={(e) => {
                  onFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            ))}
            {caption.length > MAX_CAPTION - 100 && <span className="ml-2 text-xs tabular text-muted">{MAX_CAPTION - caption.length}</span>}
            <Button
              className="ml-auto"
              onClick={submit}
              disabled={!canPost}
              title={picked.length ? (anyUploading ? "Still uploading. You can post now and it'll finish first" : undefined) : "Add a photo or video to post"}
            >
              {posting ? (anyUploading ? `${Math.round(progress)}%` : "Posting…") : "Post"}
            </Button>
          </div>
        </div>
      </div>

      {blocker.state === "blocked" && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-6">
          <div role="alertdialog" aria-labelledby="leave-title" className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-card">
            <p id="leave-title" className="text-lg font-semibold">
              Your post isn't finished uploading
            </p>
            <p className="mt-2 text-sm text-muted">If you leave now, it will be cancelled.</p>
            <div className="mt-5 flex gap-2">
              <Button className="flex-1" onClick={() => blocker.reset()}>
                Stay
              </Button>
              <Button variant="secondary" className="flex-1" onClick={() => blocker.proceed()}>
                Leave anyway
              </Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid size-11 place-items-center rounded-full text-primary transition hover:bg-primary-soft disabled:opacity-40"
    >
      {children}
    </button>
  );
}
