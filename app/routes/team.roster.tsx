import type { Route } from "./+types/team.roster";
import { Link, useFetcher, useRevalidator } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { canAccessTeam } from "~/utils/team-access.server";
import { db, teams, players } from "~/db";
import { eq, and } from "drizzle-orm";
import { useState } from "react";
import { RosterImportModal } from "~/components/RosterImportModal";
import { Badge, Button, Card, CardHeader, EmptyState, Page, PageHeader, PlayerAvatar, buttonClass, cx } from "~/components/ui";
import { CaretRight, Plus, Trash, UploadSimple, UsersThree } from "@phosphor-icons/react";

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const teamId = parseInt(params.teamId);
  
  // Get team details
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), canAccessTeam(user.id)))
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
      jerseyNumber: players.jerseyNumber,
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

function PlayerRow({ player, teamId }: { player: any; teamId: number }) {
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
      // Keep the confirm row up so "Removing..." shows until the row disappears
    } else {
      setShowConfirm(true);
    }
  };

  const handleCancel = () => {
    setShowConfirm(false);
  };

  const positions: string[] = player.preferredPositions ? JSON.parse(player.preferredPositions) : [];

  return (
    <li className={cx("flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5 sm:px-3", busy && "opacity-50")}>
      {/* Whole row opens the edit page */}
      <Link
        to={`/dashboard/team/${teamId}/roster/player/${player.id}/edit`}
        className="group flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-surface-2"
      >
        {/* Jersey number sits beside the name, so the avatar falls back to the initial */}
        <PlayerAvatar player={{ ...player, jerseyNumber: null }} size="lg" />
        <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              {player.jerseyNumber !== null && (
                <span className="font-display text-xl font-bold leading-none text-primary tabular">
                  {player.jerseyNumber}
                </span>
              )}
              <span className="truncate font-semibold">{player.name}</span>
            </div>
            {player.description && (
              <p className="mt-0.5 line-clamp-2 text-sm text-muted sm:line-clamp-1">{player.description}</p>
            )}
          </div>
          {positions.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1 sm:mt-0 sm:max-w-[40%] sm:justify-end">
              {positions.map((pos) => (
                <Badge key={pos}>{pos}</Badge>
              ))}
            </div>
          )}
        </div>
        <CaretRight size={16} className="hidden shrink-0 text-subtle transition group-hover:translate-x-0.5 group-hover:text-ink sm:block" />
      </Link>

      {showConfirm ? (
        <div className="flex w-full items-center justify-end gap-2 pb-1.5 sm:w-auto sm:pb-0">
          <span className="mr-1 min-w-0 truncate text-sm font-medium text-danger">Remove {player.name}?</span>
          <Button variant="ghost" onClick={handleCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleRemove} disabled={busy}>
            <Trash size={16} weight="bold" />
            {busy ? "Removing..." : "Remove"}
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={handleRemove}
          aria-label={`Remove ${player.name}`}
          title="Remove player"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-subtle transition hover:bg-danger-soft hover:text-danger"
        >
          <Trash size={18} />
        </button>
      )}
    </li>
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

  const importButton = (
    <Button variant="secondary" onClick={() => setShowImportModal(true)}>
      <UploadSimple size={18} />
      Import roster
    </Button>
  );
  const addPlayerLink = (
    <Link to={`/dashboard/team/${team.id}/roster/new-player`} className={buttonClass()}>
      <Plus size={18} weight="bold" />
      Add player
    </Link>
  );

  return (
    <Page>
      <PageHeader
        title="Roster"
        description={`Manage players for your ${team.format} team.`}
        actions={
          players.length > 0 && (
            <>
              {importButton}
              {addPlayerLink}
            </>
          )
        }
      />

      <Card>
        {players.length > 0 ? (
          <>
            <CardHeader title="Players" count={players.length} className="px-5 pt-5 pb-2 sm:px-6" />
            <ul className="divide-y divide-line pb-2">
              {players.map((player) => (
                <PlayerRow key={player.id} player={player} teamId={team.id} />
              ))}
            </ul>
          </>
        ) : (
          <EmptyState
            icon={<UsersThree size={24} />}
            title="No players yet"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {importButton}
                {addPlayerLink}
              </div>
            }
          >
            Add players one at a time, or import a roster from a photo, PDF or CSV file.
          </EmptyState>
        )}
      </Card>

      {/* Import Roster Modal */}
      <RosterImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        teamId={team.id}
        existingPlayers={players.map((p) => ({ id: p.id, name: p.name }))}
        onImportComplete={handleImportComplete}
      />
    </Page>
  );
}
