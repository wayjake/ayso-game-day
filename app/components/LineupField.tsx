import type { ReactNode } from "react";
import type { FormationPosition } from "~/utils/formations";
import type { QuarterLineup } from "~/utils/position-changes";
import { QUARTERS, shortName } from "~/utils/lineup";
import { cx } from "~/components/ui";

// The soccer field, shared by the planner, the public share page and
// game-day mode. Own goal at the bottom, so left backs sit on the left.
// Children are absolutely positioned slots (see FieldSlot).
export function Pitch({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cx("relative w-full rounded-2xl bg-pitch shadow-card", className)}>
      {/* Mowing stripes, clipped on their own layer so slot menus and labels can overflow */}
      <div className="pointer-events-none absolute inset-0 flex flex-col overflow-hidden rounded-2xl" aria-hidden>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className={`flex-1 ${i % 2 ? "bg-pitch-dark" : "bg-pitch"}`} />
        ))}
      </div>

      {/* Markings */}
      <div className="pointer-events-none absolute inset-3 rounded-md border-2 border-white/60" aria-hidden>
        <div className="absolute inset-x-0 top-1/2 border-t-2 border-white/60" />
        <div className="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60 sm:h-20 sm:w-20" />
        <div className="absolute top-0 left-1/4 h-[11%] w-1/2 border-x-2 border-b-2 border-white/60" />
        <div className="absolute top-0 left-[37.5%] h-[5%] w-1/4 border-x-2 border-b-2 border-white/60" />
        <div className="absolute bottom-0 left-1/4 h-[11%] w-1/2 border-x-2 border-t-2 border-white/60" />
        <div className="absolute bottom-0 left-[37.5%] h-[5%] w-1/4 border-x-2 border-t-2 border-white/60" />
      </div>

      {children}
    </div>
  );
}

// Places its content centered on a formation position
export function FieldSlot({
  position,
  className,
  children,
}: {
  position: Pick<FormationPosition, "x" | "y">;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx("absolute z-10 -translate-x-1/2 -translate-y-1/2", className)}
      style={{ left: `${position.x}%`, top: `${position.y}%` }}
    >
      {children}
    </div>
  );
}

export type SlotHighlight = "in" | "moved" | null;

// Read-only player marker: jersey number (or position) in a white disc, name below
export function FieldPlayer({
  position,
  player,
  highlight = null,
  size = "md",
}: {
  position: FormationPosition;
  player?: { name: string; jerseyNumber?: number | null } | null;
  highlight?: SlotHighlight;
  size?: "md" | "lg";
}) {
  const disc = size === "lg" ? "h-14 w-14 text-xl" : "h-11 w-11 text-base sm:h-12 sm:w-12 sm:text-lg";
  const label = size === "lg" ? "text-sm max-w-[96px]" : "text-xs max-w-[80px] sm:max-w-[110px]";

  if (!player) {
    return (
      <FieldSlot position={position}>
        <div
          className={cx(
            "flex flex-col items-center justify-center rounded-full border-2 border-dashed border-white/60 bg-pitch-dark/50 font-display font-bold leading-none text-white/80",
            disc
          )}
          title={`${position.abbreviation} is empty`}
        >
          <span className="text-sm">{position.abbreviation}</span>
        </div>
      </FieldSlot>
    );
  }

  return (
    <FieldSlot position={position}>
      <div className="flex flex-col items-center">
        <div
          className={cx(
            "flex flex-col items-center justify-center rounded-full bg-white font-display font-bold leading-none text-ink shadow-raised tabular",
            disc,
            highlight === "in" && "ring-4 ring-primary",
            highlight === "moved" && "ring-4 ring-warning",
            !highlight && "ring-2 ring-white/70"
          )}
        >
          <span>{player.jerseyNumber ?? position.abbreviation}</span>
          {player.jerseyNumber != null && (
            <span className="mt-0.5 font-sans text-[9px] font-semibold tracking-wide text-muted">{position.abbreviation}</span>
          )}
        </div>
        <div
          className={cx(
            "mt-1 truncate rounded-md bg-ink/85 px-1.5 py-0.5 font-semibold whitespace-nowrap text-white shadow-card",
            label
          )}
        >
          {shortName(player.name)}
        </div>
      </div>
    </FieldSlot>
  );
}

// A whole read-only field for one quarter
export function LineupField({
  positions,
  lineup,
  players,
  highlights,
  size = "md",
  className,
}: {
  positions: FormationPosition[];
  lineup: QuarterLineup;
  players: Array<{ id: number; name: string; jerseyNumber?: number | null }>;
  highlights?: Map<number, SlotHighlight>;
  size?: "md" | "lg";
  className?: string;
}) {
  const byId = new Map(players.map((p) => [p.id, p]));
  return (
    <Pitch className={className}>
      {positions.map((position) => {
        const assigned = lineup.get(position.number);
        const player = assigned ? byId.get(assigned.playerId) ?? { name: assigned.name } : null;
        return (
          <FieldPlayer
            key={position.number}
            position={position}
            player={player}
            highlight={assigned ? highlights?.get(assigned.playerId) ?? null : null}
            size={size}
          />
        );
      })}
    </Pitch>
  );
}

// Quarter tabs for wider screens, styled like the team tabs
export function QuarterTabs({
  current,
  onChange,
  className,
}: {
  current: number;
  onChange: (quarter: number) => void;
  className?: string;
}) {
  return (
    <nav className={cx("hidden gap-1 border-b border-line sm:flex", className)} aria-label="Quarter">
      {QUARTERS.map((quarter) => {
        const isActive = current === quarter;
        return (
          <button
            key={quarter}
            type="button"
            onClick={() => onChange(quarter)}
            aria-current={isActive ? "page" : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 pt-2 pb-3 text-sm font-semibold transition ${
              isActive ? "border-primary text-ink" : "border-transparent text-muted hover:border-line-strong hover:text-ink"
            }`}
          >
            Quarter {quarter}
          </button>
        );
      })}
    </nav>
  );
}

// Quarter bar fixed to the bottom of the screen on phones, within thumb reach.
// Renders a spacer so page content isn't hidden behind it.
export function QuarterBar({ current, onChange }: { current: number; onChange: (quarter: number) => void }) {
  return (
    <>
      <div className="h-24 sm:hidden" aria-hidden />
      <nav
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-8px_rgb(16_27_45/0.15)] sm:hidden"
        aria-label="Quarter"
      >
        <div className="grid grid-cols-4">
          {QUARTERS.map((quarter) => {
            const isActive = current === quarter;
            return (
              <button
                key={quarter}
                type="button"
                onClick={() => onChange(quarter)}
                aria-current={isActive ? "page" : undefined}
                className={`relative flex h-16 flex-col items-center justify-center transition ${
                  isActive ? "text-primary" : "text-muted active:bg-surface-2"
                }`}
              >
                {isActive && <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-primary" aria-hidden />}
                <span className="font-display text-xl font-bold leading-none tabular">Q{quarter}</span>
                <span className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${isActive ? "text-primary" : "text-subtle"}`}>
                  Quarter
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
