import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // API routes
  route("api/uploadthing", "routes/api.uploadthing.ts"),
  // Public routes (no auth required)
  route("public/game/:id", "routes/public.game.tsx"),
  route("user", "routes/user.tsx", [
    route("signup", "routes/user.signup.tsx"),
    route("login", "routes/user.login.tsx"),
    route("logout", "routes/user.logout.tsx"),
  ]),
  route("dashboard", "routes/dashboard.tsx", [
    route("", "routes/dashboard._index.tsx"),
    route("teams", "routes/dashboard.teams.tsx"),
    route("teams/new", "routes/dashboard.teams.new.tsx"),
    route("team/:teamId", "routes/team.tsx", [
      route("", "routes/team._index.tsx"),
      route("roster", "routes/team.roster.tsx"),
      route("roster/new-player", "routes/team.roster-new.tsx"),
      route("roster/player/:playerId/edit", "routes/team.roster.player.edit.tsx"),
      route("games", "routes/team.games.tsx"),
      route("games/new", "routes/team.games-new.tsx"),
      route("games/:gameId/lineup", "routes/team.games.game.lineup.tsx"),
      route("rotations", "routes/team.rotations.tsx"),
      route("player/remove", "routes/team.player.remove.tsx"),
    ]),
  ])
] satisfies RouteConfig;
