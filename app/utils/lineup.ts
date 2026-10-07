// Turns a game's saved rows (assignments, absences, formation choices) into
// one plan per quarter. Used by the read-only views: the public share page
// and game-day mode. The planner keeps its own editable state.

import { getDefaultFormationIndex, getFormationsByFormat, type FormationPosition } from "./formations";
import { calculatePositionChanges, type PositionChange, type QuarterLineup } from "./position-changes";

export const QUARTERS = [1, 2, 3, 4] as const;

export type Format = "7v7" | "9v9" | "11v11";

export type LineupPlayer = {
  id: number;
  name: string;
  jerseyNumber: number | null;
  profilePicture?: string | null;
  preferredPositions?: string | null;
};

export type SavedAssignment = {
  playerId: number;
  positionNumber: number;
  quarter: number | null;
  isSittingOut: boolean | null;
};

export type SavedAbsence = {
  playerId: number;
  quarter: number | null;
  reason: string | null;
};

export type QuarterPlan = {
  quarter: number;
  formationKey: string;
  positions: FormationPosition[];
  // position number -> player on the field
  lineup: QuarterLineup;
  // on the bench (not on the field, not absent)
  sittingOut: Set<number>;
  // absent or injured, with the reason
  unavailable: Map<number, string>;
};

export function buildQuarterPlans({
  format,
  players,
  assignments,
  absences,
  quarterFormations,
}: {
  format: Format;
  players: LineupPlayer[];
  assignments: SavedAssignment[];
  absences: SavedAbsence[];
  quarterFormations: Record<string | number, number>;
}): QuarterPlan[] {
  const formations = getFormationsByFormat(format);
  const formationKeys = Object.keys(formations);
  const defaultIndex = getDefaultFormationIndex(format);
  const playerNames = new Map(players.map((p) => [p.id, p.name]));

  const plans = QUARTERS.map((quarter): QuarterPlan => {
    const index = quarterFormations[quarter] ?? defaultIndex;
    const formationKey = formationKeys[index] ?? formationKeys[defaultIndex];
    return {
      quarter,
      formationKey,
      positions: formations[formationKey]?.positions ?? [],
      lineup: new Map(),
      // Everyone starts on the bench until an assignment puts them somewhere
      sittingOut: new Set(players.map((p) => p.id)),
      unavailable: new Map(),
    };
  });

  for (const absence of absences) {
    const plan = plans[(absence.quarter ?? 1) - 1];
    if (!plan) continue;
    plan.unavailable.set(absence.playerId, absence.reason ?? "absent");
    plan.sittingOut.delete(absence.playerId);
  }

  for (const assignment of assignments) {
    const plan = plans[(assignment.quarter ?? 1) - 1];
    if (!plan) continue;
    if (assignment.isSittingOut) {
      plan.sittingOut.add(assignment.playerId);
    } else {
      plan.sittingOut.delete(assignment.playerId);
      plan.lineup.set(assignment.positionNumber, {
        playerId: assignment.playerId,
        name: playerNames.get(assignment.playerId) ?? "",
      });
    }
  }

  return plans;
}

// Changes going from one quarter to the next. Absent or injured players count
// as off the field, so a player back from an absence shows as coming on.
export function changesBetween(from: QuarterPlan, to: QuarterPlan): PositionChange[] {
  const offField = (plan: QuarterPlan) => new Set([...plan.sittingOut, ...plan.unavailable.keys()]);
  return calculatePositionChanges(from.lineup, to.lineup, offField(from), offField(to));
}

// Changes grouped the way a coach calls them out on the sideline
export function groupChanges(changes: PositionChange[]) {
  return {
    comingOn: changes.filter((c) => c.changeType === "new_in"),
    goingOff: changes.filter((c) => c.changeType === "sitting_out"),
    moving: changes.filter((c) => c.changeType === "new_position" || c.changeType === "position_swap"),
  };
}

export function positionLabel(plan: QuarterPlan, positionNumber: number | undefined) {
  if (positionNumber === undefined) return "";
  return plan.positions.find((p) => p.number === positionNumber)?.abbreviation ?? `#${positionNumber}`;
}

// "Ava Martinez" -> "Ava M."
export function shortName(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : name;
}
