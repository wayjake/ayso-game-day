import type { Route } from "./+types/team.games.game.card";
import { getUser } from "~/utils/auth.server";
import { requireTeamAccess } from "~/utils/team-access.server";
import { buildGameCard } from "~/utils/game-card.server";
import { db, games, players, users, teamMembers } from "~/db";
import { eq, and, ne } from "drizzle-orm";

// Resource route: the official AYSO lineup card for one game, filled in as a PDF
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

  const roster = await db
    .select({ name: players.name, jerseyNumber: players.jerseyNumber })
    .from(players)
    .where(eq(players.teamId, teamId));

  const [owner] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, team.coachId))
    .limit(1);

  // First coach to join is the assistant on the card. Older data lists the
  // owner as a member of their own team, so skip them.
  const [assistant] = await db
    .select({ name: users.name })
    .from(teamMembers)
    .innerJoin(users, eq(teamMembers.userId, users.id))
    .where(and(
      eq(teamMembers.teamId, teamId),
      eq(teamMembers.status, "active"),
      ne(teamMembers.userId, team.coachId)
    ))
    .orderBy(teamMembers.joinedAt)
    .limit(1);

  const pdf = await buildGameCard({
    region: team.region,
    ageGroup: team.ageGroup,
    teamNumber: team.teamNumber,
    teamName: team.name,
    coachName: owner?.name ?? null,
    assistantCoachName: assistant?.name ?? null,
    gameDate: game.gameDate,
    opponent: game.opponent,
    players: roster,
  });

  const slug = `${team.name}-${game.opponent ?? "game"}-${game.gameDate}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="game-card-${slug}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
