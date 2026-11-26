import { useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { FilePdf, Image as ImageIcon, Paperclip, Trash } from "@phosphor-icons/react";
import { useUploadThing } from "~/utils/uploadthing";
import { Alert, buttonClass, cx } from "~/components/ui";

// Receipts and invoices kept with an expense, for the records. Staff only.
// Files go straight to UploadThing (route expenseFile), which saves the row.

type ExpenseFile = { id: string; url: string; name: string; size: number; type: string; createdAt: string };

export function ExpenseFiles({ teamId, itemId, files, formKey }: { teamId: string; itemId: string; files: ExpenseFile[]; formKey: string }) {
  const input = useRef<HTMLInputElement>(null);
  const revalidator = useRevalidator();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const { startUpload } = useUploadThing("expenseFile", {
    onClientUploadComplete: () => {
      setProgress(null);
      revalidator.revalidate();
    },
    onUploadError: (e) => {
      setProgress(null);
      setError(e.message || "That didn't upload. Try again.");
    },
    onUploadProgress: (p) => setProgress(p),
  });

  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
          {files.map((f) => (
            <FileRow key={f.id} file={f} formKey={formKey} />
          ))}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (picked.length === 0) return;
          setError(null);
          setProgress(0);
          startUpload(picked, { teamId, itemId });
        }}
      />
      <button type="button" disabled={progress !== null} onClick={() => input.current?.click()} className={buttonClass({ variant: "secondary" })}>
        <Paperclip size={18} />
        {progress !== null ? `Uploading… ${Math.round(progress)}%` : "Add a receipt or invoice"}
      </button>
      <p className="text-sm text-muted">Photos or PDFs. Only staff can see them.</p>
    </div>
  );
}

function FileRow({ file, formKey }: { file: ExpenseFile; formKey: string }) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const [armed, setArmed] = useState(false);
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  return (
    <li className={cx("flex min-h-12 items-center gap-3 px-3 py-2 text-sm", fetcher.state !== "idle" && "opacity-50")}>
      {pdf ? <FilePdf size={20} className="shrink-0 text-muted" /> : <ImageIcon size={20} className="shrink-0 text-muted" />}
      <a href={file.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-medium text-primary hover:underline">
        {file.name}
      </a>
      <span className="shrink-0 text-xs text-muted">{file.createdAt.slice(0, 10)}</span>
      <fetcher.Form method="post" className="shrink-0">
        <input type="hidden" name="_action" value="deleteFile" />
        <input type="hidden" name="fileId" value={file.id} />
        <input type="hidden" name="clientKey" value={`${formKey}:deleteFile:${file.id}`} />
        <button
          type="submit"
          aria-label={armed ? `Tap again to delete ${file.name}` : `Delete ${file.name}`}
          title={armed ? "Tap again to delete" : "Delete"}
          className={cx("tap", armed ? "text-danger" : "text-muted hover:text-danger")}
          onClick={(e) => {
            // A second tap confirms, like Undo
            if (!armed) {
              e.preventDefault();
              setArmed(true);
              setTimeout(() => setArmed(false), 4000);
            }
          }}
        >
          <Trash size={18} weight={armed ? "fill" : "regular"} />
        </button>
      </fetcher.Form>
    </li>
  );
}
