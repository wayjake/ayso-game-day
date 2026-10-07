import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { CalendarBlank, CaretLeft, CaretRight, Clock, X } from "@phosphor-icons/react";
import {
  addDays,
  dayOfWeek,
  formatGameDate,
  formatGameTime,
  parseISODate,
  toISODate,
  todayISO,
} from "~/utils/dates";

// Date and time pickers for scheduling games. Both submit the same plain values
// the native inputs did ("YYYY-MM-DD" and "HH:MM"), so actions don't change.

// Matches inputClass in ui.tsx, laid out as a button with an icon on the right
const triggerClass =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-left text-sm text-ink transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";
const popoverClass =
  "absolute z-30 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl bg-surface p-3 shadow-overlay ring-1 ring-line";
const chipBase = "rounded-full border px-3 py-1.5 text-sm font-medium transition";
const chipIdle = "border-line-strong bg-surface text-ink hover:border-primary hover:text-primary";
const chipActive = "border-primary bg-primary text-white";
const iconClass = "shrink-0 text-muted";
const navButtonClass = "flex h-9 w-9 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-ink";

// Open state for a popover that closes on any click outside it
function usePopover() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return { containerRef, open, setOpen };
}

// Kept in the form (not type="hidden") so the browser's required check still
// runs; it sits invisibly under the trigger so the error bubble points there
function FormValue({ name, value, required }: { name: string; value: string; required?: boolean }) {
  return (
    <input
      tabIndex={-1}
      aria-hidden="true"
      name={name}
      value={value}
      required={required}
      onChange={() => {}}
      className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0"
    />
  );
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function upcomingSaturdays(count: number) {
  const today = todayISO();
  const first = addDays(today, (6 - dayOfWeek(today) + 7) % 7);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

export function GameDatePicker({
  id,
  name,
  required,
  defaultValue = "",
}: {
  id?: string;
  name: string;
  required?: boolean;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const today = todayISO();
  const start = parseISODate(value || today)!;
  const [view, setView] = useState({ year: start.year, month: start.month });
  const [focused, setFocused] = useState(value || today);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const { containerRef, open, setOpen } = usePopover();
  const popoverId = useId();

  // Move keyboard focus to the focused day while the calendar is open
  useEffect(() => {
    if (!open) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${focused}"]`)?.focus();
  }, [open, focused]);

  const openCalendar = () => {
    const anchor = parseISODate(value || today)!;
    setView({ year: anchor.year, month: anchor.month });
    setFocused(value || today);
    setOpen(true);
  };

  const choose = (iso: string) => {
    setValue(iso);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const moveFocus = (iso: string) => {
    const parts = parseISODate(iso)!;
    setFocused(iso);
    setView({ year: parts.year, month: parts.month });
  };

  const shiftMonth = (delta: number) => {
    const date = new Date(Date.UTC(view.year, view.month - 1 + delta, 1));
    setView({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  };

  const onGridKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      moveFocus(addDays(focused, moves[event.key]));
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      moveFocus(addDays(focused, event.key === "PageUp" ? -28 : 28));
    } else if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  // Six weeks starting on the Sunday on or before the 1st
  const firstOfMonth = toISODate(view.year, view.month, 1);
  const gridStart = addDays(firstOfMonth, -dayOfWeek(firstOfMonth));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthLabel = formatGameDate(firstOfMonth, { month: "long", year: "numeric" });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popoverId}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        className={triggerClass}
      >
        <span className={value ? "" : "text-subtle"}>
          {value ? formatGameDate(value, { weekday: "long", month: "long", day: "numeric", year: "numeric" }) : "Pick a date"}
        </span>
        <CalendarBlank size={20} className={iconClass} aria-hidden />
      </button>
      <FormValue name={name} value={value} required={required} />

      {/* Most games are on Saturdays: one tap for the next few */}
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Upcoming Saturdays">
        {upcomingSaturdays(4).map((iso) => (
          <button
            key={iso}
            type="button"
            aria-pressed={value === iso}
            onClick={() => setValue(iso)}
            className={`${chipBase} ${value === iso ? chipActive : chipIdle}`}
          >
            {formatGameDate(iso, { weekday: "short", month: "short", day: "numeric" })}
          </button>
        ))}
      </div>

      {open && (
        <div id={popoverId} role="dialog" aria-label="Choose game date" className={`${popoverClass} left-0`}>
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className={navButtonClass}>
              <CaretLeft size={18} weight="bold" aria-hidden />
            </button>
            <div className="font-semibold" aria-live="polite">{monthLabel}</div>
            <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className={navButtonClass}>
              <CaretRight size={18} weight="bold" aria-hidden />
            </button>
          </div>

          <div className="grid grid-cols-7 text-center text-xs font-medium text-muted">
            {WEEKDAYS.map((day, i) => (
              <div key={i} className={`py-1 ${i === 6 ? "text-primary" : ""}`}>{day}</div>
            ))}
          </div>

          <div ref={gridRef} role="grid" onKeyDown={onGridKeyDown} className="grid grid-cols-7 gap-0.5">
            {days.map((iso) => {
              const parts = parseISODate(iso)!;
              const inMonth = parts.month === view.month;
              const selected = iso === value;
              const isToday = iso === today;
              const saturday = dayOfWeek(iso) === 6;
              return (
                <button
                  key={iso}
                  type="button"
                  data-iso={iso}
                  tabIndex={iso === focused ? 0 : -1}
                  aria-label={formatGameDate(iso, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                  aria-pressed={selected}
                  onClick={() => choose(iso)}
                  className={[
                    "h-9 rounded-lg text-sm tabular transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    selected
                      ? "bg-primary font-semibold text-white"
                      : saturday && inMonth
                        ? "bg-primary-soft text-primary-ink hover:bg-primary/15"
                        : "hover:bg-surface-2",
                    !selected && !inMonth ? "text-subtle" : "",
                    !selected && isToday ? "font-semibold ring-1 ring-inset ring-primary" : "",
                  ].join(" ")}
                >
                  {parts.day}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between border-t border-line pt-2 text-sm">
            <button type="button" onClick={() => choose(today)} className="rounded-md px-2 py-1.5 font-medium text-primary hover:bg-primary-soft">
              Today
            </button>
            {!required && value && (
              <button type="button" onClick={() => choose("")} className="rounded-md px-2 py-1.5 text-muted hover:bg-surface-2 hover:text-ink">
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Typical youth game hours; anything else goes through "Other time"
const HOURS = Array.from({ length: 13 }, (_, i) => i + 7); // 7 AM - 7 PM
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);
const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour >= 12 ? "PM" : "AM"}`;
const pad = (n: number) => String(n).padStart(2, "0");

export function GameTimePicker({
  id,
  name,
  defaultValue = "",
}: {
  id?: string;
  name: string;
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { containerRef, open, setOpen } = usePopover();
  const popoverId = useId();

  const [hourText, minuteText] = value ? value.split(":") : ["", ""];
  const hour = value ? Number(hourText) : null;
  const minute = value ? Number(minuteText) : null;

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <button
          ref={triggerRef}
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          onClick={() => setOpen(!open)}
          className={triggerClass}
        >
          <span className={value ? "" : "text-subtle"}>{value ? formatGameTime(value) : "Pick a time"}</span>
          <Clock size={20} className={iconClass} aria-hidden />
        </button>
        {value && (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label="Clear time"
            className="absolute right-10 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-ink"
          >
            <X size={16} weight="bold" aria-hidden />
          </button>
        )}
      </div>
      <FormValue name={name} value={value} />

      {open && (
        <div
          id={popoverId}
          role="dialog"
          aria-label="Choose game time"
          onKeyDown={(event) => event.key === "Escape" && close()}
          // Right-aligned: the time field sits in the right-hand column
          className={`${popoverClass} right-0`}
        >
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Hour</div>
          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Hour">
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                aria-pressed={hour === h}
                onClick={() => setValue(`${pad(h)}:${pad(minute ?? 0)}`)}
                className={`rounded-lg border py-1.5 text-sm font-medium transition ${hour === h ? chipActive : chipIdle}`}
              >
                {hourLabel(h)}
              </button>
            ))}
          </div>

          <div className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Minute</div>
          <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Minute">
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                disabled={hour === null}
                aria-pressed={minute === m}
                onClick={() => {
                  setValue(`${pad(hour!)}:${pad(m)}`);
                  close();
                }}
                className={`rounded-lg border py-1.5 text-sm font-medium tabular transition disabled:cursor-not-allowed disabled:opacity-40 ${minute === m && hour !== null ? chipActive : chipIdle}`}
              >
                :{pad(m)}
              </button>
            ))}
          </div>
          {hour === null && <p className="mt-2 text-xs text-muted">Pick an hour first.</p>}

          <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-sm">
            <label className="flex items-center gap-2 text-muted">
              Other time
              <input
                type="time"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                className="rounded-md border border-line-strong bg-surface px-2 py-1 text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </label>
            <button type="button" onClick={close} className="rounded-md px-2 py-1.5 font-medium text-primary hover:bg-primary-soft">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
