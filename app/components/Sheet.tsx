import { useEffect, useRef, useState, type ReactNode } from "react";

// A bottom sheet on phones, a centered card on wider screens. A native
// <dialog> gives us focus trapping, Esc and the backdrop. Drag the handle
// down to dismiss. Styles for the slide-in live in app.css (.sheet).
//
// A sheet rendered with the page (openOnLoad) opens from an inline script as
// soon as the HTML arrives, instead of waiting for React to hydrate, which on
// a phone can take a second or two after the page is already on screen.

const SWIPE_CLOSE_PX = 90;

export function Sheet({
  labelledBy,
  onClose,
  openOnLoad,
  children,
}: {
  labelledBy: string;
  /**
   * Open only if this holds. `js` is the same test as a script expression, run
   * as the HTML is parsed when the sheet comes with the page; `test` decides
   * when it was rendered later in the browser (a client-side navigation).
   */
  openOnLoad?: { js: string; test: () => boolean };
  /** Called once, however the sheet was closed */
  onClose: () => void;
  /** Gets `close` so buttons inside can dismiss it */
  children: (close: () => void) => ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [dragY, setDragY] = useState(0);
  const drag = useRef<{ y: number; id: number } | null>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    // Esc, the backdrop and our own buttons all end up here
    const onDialogClose = () => onCloseRef.current();
    if (!el.open) {
      // data-early: the inline script already decided (and left it shut, or it was closed before hydration)
      const wanted = !openOnLoad || (!el.hasAttribute("data-early") && openOnLoad.test());
      if (!wanted) return onDialogClose();
      el.showModal();
    }
    el.addEventListener("close", onDialogClose);
    return () => el.removeEventListener("close", onDialogClose);
  }, []);

  const close = () => dialog.current?.close();

  return (
    <>
      <dialog
        ref={dialog}
        // The early script adds `open` before React sees this element
        suppressHydrationWarning
        aria-labelledby={labelledBy}
        className="sheet m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/50 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-md sm:rounded-3xl"
        style={dragY ? { transform: `translateY(${dragY}px)`, transition: "none" } : undefined}
        // A click landing on the <dialog> itself (not its content) is a backdrop click
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="px-6 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-6">
          <div
            className="-mx-6 -mt-3 mb-2 flex cursor-grab touch-none justify-center pt-3 pb-3 sm:hidden"
            onPointerDown={(e) => {
              drag.current = { y: e.clientY, id: e.pointerId };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d?.id === e.pointerId) setDragY(Math.max(0, e.clientY - d.y));
            }}
            onPointerUp={() => {
              drag.current = null;
              if (dragY > SWIPE_CLOSE_PX) close();
              else setDragY(0);
            }}
            onPointerCancel={() => {
              drag.current = null;
              setDragY(0);
            }}
            aria-hidden
          >
            <span className="h-1.5 w-10 rounded-full bg-line-strong" />
          </div>
          {children(close)}
        </div>
      </dialog>
      {openOnLoad && (
        // Runs while the HTML is parsed. React never runs scripts it inserts itself, so a sheet opened later skips this
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.currentScript.previousElementSibling;d.setAttribute("data-early","");if(${openOnLoad.js})d.showModal()})()`,
          }}
        />
      )}
    </>
  );
}

export function SheetTitle({
  id,
  icon,
  title,
  subtitle,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="flex items-center gap-4">
      {icon}
      <div className="min-w-0">
        <h2 id={id} className="font-display text-2xl leading-tight font-bold tracking-tight">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
    </div>
  );
}
