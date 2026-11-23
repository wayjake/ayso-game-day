import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  // Handle .well-known requests (Chrome DevTools, etc.)
  route(".well-known/*", "routes/well-known.ts"),
  // API routes
  route("api/uploadthing", "routes/api.uploadthing.ts"),
  route("api/ai-lineup", "api/ai-lineup/route.ts"),
  route("api/roster-import", "api/roster-import/route.ts"),
  route("api/push", "routes/api.push.ts"),
  // Public routes (no auth required)
  route("public/game/:id", "routes/public.game.tsx"),
  route("invite/:code", "routes/invite.tsx"),
  route("join/:code", "routes/join.tsx"),
  // Family app: parents' schedule, RSVPs and messages
  route("family", "routes/family.tsx", [
    index("routes/family._index.tsx"),
    route("messages", "routes/family.messages.tsx"),
    route("messages/:conversationId", "routes/family.messages.thread.tsx"),
    route("settings", "routes/family.settings.tsx"),
  ]),
  // Sideline view: full screen, outside the dashboard chrome
  route("dashboard/team/:teamId/games/:gameId/game-day", "routes/game-day.tsx"),
  route("user", "routes/user.tsx", [
    route("signup", "routes/user.signup.tsx"),
    route("login", "routes/user.login.tsx"),
    route("logout", "routes/user.logout.tsx"),
    route("forgot-password", "routes/user.forgot-password.tsx"),
    route("reset-password/:token", "routes/user.reset-password.tsx"),
    route("magic-link", "routes/user.magic-link.tsx"),
    route("magic-link/:token", "routes/user.magic-link.token.tsx"),
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
      route("games/:gameId/edit", "routes/team.games.edit.tsx"),
      route("games/:gameId/lineup", "routes/team.games.game.lineup.tsx"),
      route("games/:gameId/game-card", "routes/team.games.game.card.ts"),
      route("player/remove", "routes/team.player.remove.tsx"),
      route("contacts", "routes/team.contacts.tsx"),
      route("contacts/new", "routes/team.contacts.new.tsx"),
      route("contacts/:contactId/edit", "routes/team.contacts.edit.tsx"),
      route("settings", "routes/team.settings.tsx"),
      route("families", "routes/team.families.tsx"),
      route("practices/new", "routes/team.practices-new.tsx"),
      route("practices/:practiceId/edit", "routes/team.practices.edit.tsx"),
      route("rsvps/:eventType/:eventId", "routes/team.rsvps.tsx"),
      route("messages", "routes/team.messages.tsx"),
      route("messages/:conversationId", "routes/team.messages.thread.tsx"),
    ]),
  ])
] satisfies RouteConfig;
