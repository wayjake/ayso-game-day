import type { Route } from "./+types/team.roster";
import { Link, useFetcher, useRevalidator } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { db, teams, players } from "~/db";
import { eq, and } from "drizzle-orm";
import { getImageUrl } from "~/utils/image";
import { useState } from "react";
import { RosterImportModal } from "~/components/RosterImportModal";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.coachId, user.id)))
    .limit(1);
  
  if (!team) {
    throw new Response("Team not found", { status: 404 });
  }
  
  // Get all players for this team
  const teamPlayers = await db
    .select({
      id: players.id,
      name: players.name,
      description: players.description,
      profilePicture: players.profilePicture,
      preferredPositions: players.preferredPositions,
    })
    .from(players)
    .where(eq(players.teamId, teamId))
    .orderBy(players.name);
  
  return data({
    team,
    players: teamPlayers,
  });
}

export function meta({ params }: Route.MetaArgs) {
  return [
    { title: "Roster - AYSO Game Day" },
    { name: "description", content: "Manage your team roster" },
  ];
}

function PlayerCard({ player, teamId }: { player: any; teamId: number }) {
  const fetcher = useFetcher();
  const [showConfirm, setShowConfirm] = useState(false);
  const busy = fetcher.state !== "idle";

  const handleRemove = () => {
    if (showConfirm) {
      fetcher.submit(
        { playerId: player.id.toString() },
        { 
          method: "post", 
          action: `/dashboard/team/${teamId}/player/remove` 
        }
      );
      setShowConfirm(false);
    } else {
      setShowConfirm(true);
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-sm hover:shadow-md transition-shadow">
      <div className="p-6">
        <div className="flex items-start gap-4">
          {getImageUrl(player.profilePicture) ? (
            <img
              src={getImageUrl(player.profilePicture)!}
              alt={player.name}
              className="w-12 h-12 rounded-full object-cover border border-[var(--border)]"
            />
          ) : (
            <div className="w-12 h-12 rounded-full bg-[var(--bg)] flex items-center justify-center text-lg font-semibold text-[var(--muted)]">
              {player.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1">
            <h3 className="font-semibold text-[var(--text)]">{player.name}</h3>
            {player.description && (
              <p className="text-sm text-[var(--muted)] mt-1">{player.description}</p>
            )}
            {player.preferredPositions && (
              <div className="flex flex-wrap gap-1 mt-2">
                {JSON.parse(player.preferredPositions).map((pos: string) => (
                  <span key={pos} className="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold border border-[var(--border)] bg-[var(--bg)] text-[var(--muted)]">
                    {pos}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {showConfirm ? (
            <>
              <div className="flex gap-2">
                <button
                  onClick={handleRemove}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-red-200 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition"
                >
                  {busy ? "Removing..." : "✓ Confirm"}
                </button>
                <button
                  onClick={handleCancel}
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
                >
                  Cancel
                </button>
              </div>
              <div className="text-xs text-red-600 text-center">
                Are you sure you want to remove {player.name}?
              </div>
            </>
          ) : (
            <div className="flex gap-2">
              <Link
                to={`/dashboard/team/${teamId}/roster/player/${player.id}/edit`}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
              >
                Edit
              </Link>
              <button
                onClick={handleRemove}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-sm rounded font-medium border border-red-200 bg-transparent text-red-600 hover:bg-red-50 transition"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function TeamRoster({ loaderData }: Route.ComponentProps) {
  const { team, players } = loaderData;
  const [showImportModal, setShowImportModal] = useState(false);
  const revalidator = useRevalidator();

  const handleImportComplete = () => {
    // Refresh the page data after import
    revalidator.revalidate();
  };

  return (
    <div className="py-4">
      <div className="container mx-auto px-4 sm:px-6 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">{team.name} Roster</h1>
            <p className="mt-2 text-[var(--muted)]">
              Manage players for your {team.format} team
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowImportModal(true)}
              className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-[var(--border)] bg-transparent text-[var(--text)] hover:bg-[var(--bg)] transition"
            >
              Import Roster
            </button>
            <Link
              to={`/dashboard/team/${team.id}/roster/new-player`}
              className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
            >
              Add Player
            </Link>
          </div>
        </div>
        
        {/* Players grid */}
        {players.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {players.map((player) => (
              <PlayerCard key={player.id} player={player} teamId={team.id} />
            ))}
          </div>
        ) : (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-12 text-center">
            <div className="max-w-sm mx-auto">
              <div className="mb-4">
                <div className="h-12 w-12 mx-auto bg-[var(--bg)] rounded-full flex items-center justify-center">
                  <span className="text-[var(--muted)] text-xl">👥</span>
                </div>
              </div>
              <h3 className="text-lg font-semibold text-[var(--text)] mb-2">
                No players yet
              </h3>
              <p className="text-[var(--muted)] mb-6">
                Add players to your roster to start planning game rotations and lineups.
              </p>
              <Link
                to={`/dashboard/team/${team.id}/roster/new-player`}
                className="inline-flex items-center justify-center px-4 py-2 rounded font-medium border border-transparent bg-[var(--primary)] text-white hover:bg-[var(--primary-600)] shadow-sm transition hover:-translate-y-0.5 active:translate-y-0"
              >
                Add Your First Player
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Import Roster Modal */}
      <RosterImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        teamId={team.id}
        existingPlayers={players.map((p) => ({ id: p.id, name: p.name }))}
        onImportComplete={handleImportComplete}
      />
    </div>
  );
}