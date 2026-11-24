import type { Route } from "./+types/team.games.game.card";
import { getUser } from "~/utils/auth.server";
import { getTeamStaff, requireTeamAccess } from "~/utils/team-access.server";
import { buildGameCard } from "~/utils/game-card.server";
import { db, games, players } from "~/db";
import { eq, and } from "drizzle-orm";

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

  // Coach is the owner unless they've given themselves another role; the
  // assistant is the first assistant coach, else a second coach. Team
  // managers aren't on the card.
  const staff = await getTeamStaff(teamId);
  const coach = staff.find((s) => s.role === "coach");
  const assistant =
    staff.find((s) => s.role === "assistant-coach") ??
    staff.find((s) => s.role === "coach" && s !== coach);

  const pdf = await buildGameCard({
    region: team.region,
    ageGroup: team.ageGroup,
    teamNumber: team.teamNumber,
    teamName: team.name,
    coachName: coach?.name ?? null,
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
