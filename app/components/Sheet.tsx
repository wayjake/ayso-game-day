import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

// A bottom sheet on phones, a centered card on wider screens. A native
// <dialog> gives us focus trapping, Esc and the backdrop. On phones it moves
// like a native sheet: drag it down from anywhere once its content is scrolled
// to the top, or flick it, and it slides away instead of vanishing. Styles for
// the slide-in live in app.css (.sheet).
//
// A sheet rendered with the page (openOnLoad) opens from an inline script as
// soon as the HTML arrives, instead of waiting for React to hydrate, which on
// a phone can take a second or two after the page is already on screen.

const SWIPE_CLOSE_PX = 90;
const FLICK_PX_PER_MS = 0.5;
const CLOSE_MS = 220;

const isWide = () => window.matchMedia("(min-width: 40rem)").matches;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
  const dragYRef = useRef(0);
  dragYRef.current = dragY;
  const [closing, setClosing] = useState(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Slide (phones) or fade (wider screens) out, then really close
  const close = useCallback(() => {
    const el = dialog.current;
    if (!el?.open) return;
    if (reducedMotion()) return el.close();
    setClosing(true);
    window.setTimeout(() => {
      el.close();
      setClosing(false);
      setDragY(0);
    }, CLOSE_MS);
  }, []);

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
    // Esc animates out too
    const onCancel = (e: Event) => {
      e.preventDefault();
      close();
    };
    el.addEventListener("close", onDialogClose);
    el.addEventListener("cancel", onCancel);
    return () => {
      el.removeEventListener("close", onDialogClose);
      el.removeEventListener("cancel", onCancel);
    };
  }, []);

  // Drag to dismiss on phones. Takes over only a downward drag that starts
  // with the sheet scrolled to the top; anything else scrolls as usual.
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    let start: number | null = null;
    let dragging = false;
    let last = { y: 0, t: 0 };
    let velocity = 0;

    const onStart = (e: TouchEvent) => {
      start = null;
      dragging = false;
      if (e.touches.length !== 1 || isWide()) return;
      start = e.touches[0].clientY;
      last = { y: start, t: e.timeStamp };
      velocity = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (start === null) return;
      const y = e.touches[0].clientY;
      const dy = y - start;
      if (!dragging) {
        if (dy < -4 || el.scrollTop > 0) return void (start = null);
        if (dy < 6) return;
        dragging = true;
      }
      e.preventDefault(); // the sheet moves, not its content
      if (e.timeStamp > last.t) velocity = (y - last.y) / (e.timeStamp - last.t);
      last = { y, t: e.timeStamp };
      setDragY(Math.max(0, dy - 6));
    };
    const onEnd = () => {
      if (start === null) return;
      start = null;
      if (!dragging) return;
      dragging = false;
      const y = dragYRef.current;
      if (y > SWIPE_CLOSE_PX || (velocity > FLICK_PX_PER_MS && y > 16)) close();
      else setDragY(0); // springs back through .sheet's transition
    };

    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd);
    el.addEventListener("touchcancel", onEnd);
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [close]);

  // --sheet-fade dims the backdrop with the drag (app.css)
  let style: CSSProperties | undefined;
  if (closing) {
    style = {
      transform: isWide() ? "translateY(1rem)" : "translateY(100%)",
      opacity: isWide() ? 0 : 1,
      transition: `transform ${CLOSE_MS}ms cubic-bezier(0.4, 0, 1, 1), opacity ${CLOSE_MS}ms ease-in`,
      ["--sheet-fade" as string]: 0,
    };
  } else if (dragY) {
    style = {
      transform: `translateY(${dragY}px)`,
      transition: "none",
      ["--sheet-fade" as string]: Math.max(0.3, 1 - dragY / 500),
    };
  }

  return (
    <>
      <dialog
        ref={dialog}
        // The early script adds `open` before React sees this element
        suppressHydrationWarning
        aria-labelledby={labelledBy}
        className="sheet m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-3xl bg-surface p-0 text-ink shadow-overlay backdrop:bg-ink/50 backdrop:backdrop-blur-sm sm:m-auto sm:max-w-md sm:rounded-3xl"
        style={style}
        // A click landing on the <dialog> itself (not its content) is a backdrop click
        onClick={(e) => e.target === e.currentTarget && close()}
      >
        <div className="px-6 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-6">
          <div className="-mx-6 -mt-3 mb-2 flex cursor-grab touch-none justify-center pt-3 pb-3 sm:hidden" aria-hidden>
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
