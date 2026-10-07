import type { Route } from "./+types/game-day";
import { data, Link, useSearchParams } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { getLineupRows } from "~/utils/lineup.server";
import { db, games } from "~/db";
import { and, eq } from "drizzle-orm";
import { parseGameNotes } from "~/utils/game-notes";
import { formatGameTime } from "~/utils/dates";
import {
  QUARTERS,
  buildQuarterPlans,
  changesBetween,
  groupChanges,
  positionLabel,
  shortName,
  type Format,
  type QuarterPlan,
} from "~/utils/lineup";
import { LineupField, type SlotHighlight } from "~/components/LineupField";
import { Badge, Card, CardHeader, EmptyState, buttonClass, cx } from "~/components/ui";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowsLeftRight,
  CaretLeft,
  Chair,
  FirstAid,
  PencilSimple,
  SoccerBall,
  Sun,
  UserMinus,
} from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  const gameId = parseInt(params.gameId);
  const { team } = await requireTeamAccess(teamId, user.id);

  const [game] = await db
    .select()
    .from(games)
    .where(and(eq(games.id, gameId), eq(games.teamId, teamId)))
    .limit(1);

  if (!game) {
    throw new Response("Game not found", { status: 404 });
  }

  const rows = await getLineupRows(teamId, gameId);

  return data({
    team: { id: team.id, name: team.name, format: team.format },
    game: { id: game.id, opponent: game.opponent, gameDate: game.gameDate, gameTime: game.gameTime, field: game.field },
    quarterFormations: parseGameNotes(game.notes).quarterFormations ?? {},
    ...rows,
  });
}

export function meta({ data }: Route.MetaArgs) {
  return [{ title: `Game day - vs ${data?.game.opponent ?? "game"} - AYSO Game Day` }];
}

export default function GameDay({ loaderData }: Route.ComponentProps) {
  const { team, game, players, assignments, absences, quarterFormations } = loaderData;
  const base = `/dashboard/team/${team.id}`;
  const lineupHref = `${base}/games/${game.id}/lineup`;

  const plans = useMemo(
    () =>
      buildQuarterPlans({
        format: team.format as Format,
        players,
        assignments,
        absences,
        quarterFormations,
      }),
    [team.format, players, assignments, absences, quarterFormations]
  );

  // Current quarter lives in the URL so a refresh or a locked phone keeps your place
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = Number(searchParams.get("q"));
  const quarter = QUARTERS.includes(requested as 1) ? requested : 1;
  const goTo = (q: number) => {
    setSearchParams({ q: String(q) }, { replace: true, preventScrollReset: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const current = plans[quarter - 1];
  const previous = quarter > 1 ? plans[quarter - 2] : null;
  const next = quarter < 4 ? plans[quarter] : null;
  const playersById = new Map(players.map((p) => [p.id, p]));
  const nothingPlanned = plans.every((plan) => plan.lineup.size === 0);

  // Who's new or has moved since last quarter, for rings on the field
  const highlights = new Map<number, SlotHighlight>();
  if (previous) {
    for (const change of changesBetween(previous, current)) {
      if (change.changeType === "new_in") highlights.set(change.playerId, "in");
      if (change.changeType === "new_position" || change.changeType === "position_swap") highlights.set(change.playerId, "moved");
    }
  }

  const bench = players.filter((p) => current.sittingOut.has(p.id));
  const unavailable = players.filter((p) => current.unavailable.has(p.id));
  const benchQuarters = (playerId: number) => plans.filter((plan) => plan.sittingOut.has(playerId)).length;

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Slim header */}
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-2 sm:px-4">
          <Link to={base} className={buttonClass({ variant: "ghost", size: "icon" })} aria-label="Back to team">
            <ArrowLeft size={20} weight="bold" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-xl font-bold leading-tight tracking-tight">vs {game.opponent}</div>
            <div className="truncate text-xs text-muted">
              {[team.name, formatGameTime(game.gameTime), game.field].filter(Boolean).join(" · ")}
            </div>
          </div>
          <KeepAwakeButton />
          <Link to={lineupHref} className={buttonClass({ variant: "ghost", size: "icon" })} aria-label="Edit lineup" title="Edit lineup">
            <PencilSimple size={20} />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-4 pb-36 sm:px-6">
        {nothingPlanned ? (
          <Card className="mt-6">
            <EmptyState
              icon={<SoccerBall size={24} />}
              title="No lineup yet"
              action={
                <Link to={lineupHref} className={buttonClass({ size: "lg" })}>
                  Plan lineup
                </Link>
              }
            >
              Plan who plays where each quarter, then come back here on the sideline.
            </EmptyState>
          </Card>
        ) : (
          <>
            {/* Quarter picker */}
            <div className="grid grid-cols-4 gap-1 rounded-2xl bg-surface p-1 shadow-card ring-1 ring-line/70" role="tablist" aria-label="Quarter">
              {QUARTERS.map((q) => (
                <button
                  key={q}
                  type="button"
                  role="tab"
                  aria-selected={q === quarter}
                  onClick={() => goTo(q)}
                  className={cx(
                    "h-12 rounded-xl font-display text-xl font-bold tabular transition",
                    q === quarter ? "bg-primary text-white shadow-card" : "text-muted hover:bg-surface-2 hover:text-ink"
                  )}
                >
                  Q{q}
                </button>
              ))}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-6">
              {/* Field */}
              <section aria-label={`Quarter ${quarter} lineup`}>
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <h1 className="font-display text-2xl font-bold tracking-tight">Quarter {quarter}</h1>
                  <Badge tone="primary" className="tabular">{current.formationKey}</Badge>
                </div>
                <LineupField
                  positions={current.positions}
                  lineup={current.lineup}
                  players={players}
                  highlights={highlights}
                  size="lg"
                  className="h-[min(64dvh,36rem)]"
                />
                {previous && highlights.size > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted">
                    <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full ring-[3px] ring-primary" />New this quarter</span>
                    <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full ring-[3px] ring-warning" />Changed position</span>
                  </div>
                )}
              </section>

              <div className="space-y-4">
                {/* What changes at the next whistle */}
                {next ? (
                  <NextChanges from={current} to={next} playersById={playersById} />
                ) : (
                  <Card className="p-5">
                    <CardHeader title="Last quarter" />
                    <p className="mt-1 text-sm text-muted">No more changes after this one.</p>
                  </Card>
                )}

                {/* Bench */}
                <Card className="p-5">
                  <CardHeader title={`On the bench · Q${quarter}`} count={bench.length} />
                  {bench.length > 0 ? (
                    <ul className="mt-2 divide-y divide-line">
                      {bench.map((player) => (
                        <li key={player.id} className="flex items-center gap-3 py-2.5">
                          <JerseyChip number={player.jerseyNumber} />
                          <span className="min-w-0 flex-1 truncate font-medium">{player.name}</span>
                          <span className="shrink-0 text-xs text-muted tabular">
                            sits {benchQuarters(player.id)}/4
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm text-muted">Everyone is on the field.</p>
                  )}

                  {unavailable.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                      {unavailable.map((player) => {
                        const reason = current.unavailable.get(player.id);
                        return (
                          <li key={player.id} className="flex items-center gap-3 text-sm text-muted">
                            <JerseyChip number={player.jerseyNumber} muted />
                            <span className="min-w-0 flex-1 truncate">{player.name}</span>
                            <Badge tone={reason === "injured" ? "danger" : "neutral"}>
                              {reason === "injured" ? <FirstAid size={14} weight="bold" /> : <UserMinus size={14} weight="bold" />}
                              {reason === "injured" ? "Injured" : "Absent"}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Advance the game with one big thumb-sized button */}
      {!nothingPlanned && (
        <nav
          className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-8px_rgb(16_27_45/0.15)]"
          aria-label="Quarter controls"
        >
          <div className="mx-auto flex max-w-6xl gap-2 px-4 py-3 sm:px-6">
            {quarter > 1 && (
              <button type="button" onClick={() => goTo(quarter - 1)} className={buttonClass({ variant: "secondary", size: "lg", className: "px-4" })}>
                <CaretLeft size={20} weight="bold" />
                Q{quarter - 1}
              </button>
            )}
            {next ? (
              <button type="button" onClick={() => goTo(quarter + 1)} className={buttonClass({ size: "lg", className: "flex-1 text-lg" })}>
                Start Q{quarter + 1}
                <ArrowRight size={20} weight="bold" />
              </button>
            ) : (
              <Link to={base} className={buttonClass({ variant: "secondary", size: "lg", className: "flex-1" })}>
                Done
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

// Coming on / going off / switching for the next quarter
function NextChanges({
  from,
  to,
  playersById,
}: {
  from: QuarterPlan;
  to: QuarterPlan;
  playersById: Map<number, { name: string; jerseyNumber: number | null }>;
}) {
  const { comingOn, goingOff, moving } = groupChanges(changesBetween(from, to));
  const formationChanges = from.formationKey !== to.formationKey;
  const total = comingOn.length + goingOff.length + moving.length;
  const jersey = (playerId: number) => playersById.get(playerId)?.jerseyNumber ?? null;

  return (
    <Card className="p-5">
      <CardHeader title={`Changes for Q${to.quarter}`} count={total} />
      {formationChanges && (
        <p className="mt-2 rounded-lg bg-primary-soft px-3 py-2 text-sm font-medium text-primary-ink">
          Formation changes to {to.formationKey}
        </p>
      )}
      {total === 0 ? (
        <p className="mt-1 text-sm text-muted">Same players, same positions.</p>
      ) : (
        <div className="mt-3 space-y-4">
          {comingOn.length > 0 && (
            <ChangeGroup title="Coming on" icon={<ArrowUp size={16} weight="bold" />} tone="primary">
              {comingOn.map((change) => (
                <ChangeRow key={change.playerId} jersey={jersey(change.playerId)} name={change.playerName}>
                  <span className="font-semibold text-ink">{positionLabel(to, change.toPosition)}</span>
                </ChangeRow>
              ))}
            </ChangeGroup>
          )}
          {goingOff.length > 0 && (
            <ChangeGroup title="Coming off" icon={<ArrowDown size={16} weight="bold" />} tone="neutral">
              {goingOff.map((change) => (
                <ChangeRow key={change.playerId} jersey={jersey(change.playerId)} name={change.playerName}>
                  <span className="flex items-center gap-1">
                    {positionLabel(from, change.fromPosition)}
                    <ArrowRight size={12} weight="bold" />
                    <Chair size={14} />
                  </span>
                </ChangeRow>
              ))}
            </ChangeGroup>
          )}
          {moving.length > 0 && (
            <ChangeGroup title="Switching positions" icon={<ArrowsLeftRight size={16} weight="bold" />} tone="warning">
              {moving.map((change) => (
                <ChangeRow key={change.playerId} jersey={jersey(change.playerId)} name={change.playerName}>
                  <span className="flex items-center gap-1">
                    {positionLabel(from, change.fromPosition)}
                    <ArrowRight size={12} weight="bold" />
                    <span className="font-semibold text-ink">{positionLabel(to, change.toPosition)}</span>
                  </span>
                </ChangeRow>
              ))}
            </ChangeGroup>
          )}
        </div>
      )}
    </Card>
  );
}

function ChangeGroup({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "neutral" | "warning" | "primary";
  children: React.ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-2 text-muted",
    warning: "bg-warning-soft text-warning",
    primary: "bg-primary-soft text-primary-ink",
  };
  return (
    <div>
      <div className={cx("mb-1 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold", tones[tone])}>
        {icon}
        {title}
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </div>
  );
}

function ChangeRow({ jersey, name, children }: { jersey: number | null; name: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <JerseyChip number={jersey} />
      <span className="min-w-0 flex-1 truncate text-base font-semibold">{shortName(name)}</span>
      <span className="shrink-0 text-sm text-muted">{children}</span>
    </li>
  );
}

function JerseyChip({ number, muted = false }: { number: number | null; muted?: boolean }) {
  return (
    <span
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold tabular ring-1 ring-line",
        muted ? "bg-surface-2 text-subtle" : "bg-surface-2 text-ink"
      )}
      aria-hidden
    >
      {number ?? "–"}
    </span>
  );
}

// Stops the phone screen from dimming mid-game (Screen Wake Lock API)
function KeepAwakeButton() {
  const [supported, setSupported] = useState(false);
  const [wanted, setWanted] = useState(false);
  const [active, setActive] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => setSupported("wakeLock" in navigator), []);

  useEffect(() => {
    if (!wanted) {
      lock.current?.release();
      lock.current = null;
      return;
    }
    const acquire = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        lock.current = await navigator.wakeLock.request("screen");
        setActive(true);
        lock.current.addEventListener("release", () => setActive(false));
      } catch {
        setActive(false);
      }
    };
    acquire();
    // The browser drops the lock when the tab is hidden; take it back on return
    document.addEventListener("visibilitychange", acquire);
    return () => document.removeEventListener("visibilitychange", acquire);
  }, [wanted]);

  useEffect(() => () => void lock.current?.release(), []);

  if (!supported) return null;

  return (
    <button
      type="button"
      onClick={() => setWanted(!wanted)}
      aria-pressed={active}
      title={active ? "Screen stays on" : "Keep screen on"}
      className={cx(
        buttonClass({ variant: "ghost", size: "sm" }),
        active && "bg-warning-soft text-warning hover:bg-warning-soft hover:text-warning"
      )}
    >
      <Sun size={18} weight={active ? "fill" : "regular"} />
      <span className="hidden sm:inline">{active ? "Screen on" : "Keep screen on"}</span>
    </button>
  );
}
