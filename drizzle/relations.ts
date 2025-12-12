import { relations } from "drizzle-orm/relations";
import { players, assignments, games, templateFormations, teams, users, sitOuts, shareLinks, contacts, oauthTokens, emailLogs, inboxThreads, inboxMessages, threadNotes, teamMembers, teamInvites } from "./schema";

export const assignmentsRelations = relations(assignments, ({one}) => ({
	player: one(players, {
		fields: [assignments.playerId],
		references: [players.id]
	}),
	game: one(games, {
		fields: [assignments.gameId],
		references: [games.id]
	}),
}));

export const playersRelations = relations(players, ({one, many}) => ({
	assignments: many(assignments),
	user: one(users, {
		fields: [players.coachId],
		references: [users.id]
	}),
	team: one(teams, {
		fields: [players.teamId],
		references: [teams.id]
	}),
	sitOuts: many(sitOuts),
	contacts: many(contacts),
}));

export const gamesRelations = relations(games, ({one, many}) => ({
	assignments: many(assignments),
	templateFormation: one(templateFormations, {
		fields: [games.formationId],
		references: [templateFormations.id]
	}),
	team: one(teams, {
		fields: [games.teamId],
		references: [teams.id]
	}),
	sitOuts: many(sitOuts),
	shareLinks: many(shareLinks),
	emailLogs: many(emailLogs),
	inboxThreads: many(inboxThreads),
}));

export const templateFormationsRelations = relations(templateFormations, ({many}) => ({
	games: many(games),
}));

export const teamsRelations = relations(teams, ({one, many}) => ({
	games: many(games),
	players: many(players),
	user: one(users, {
		fields: [teams.coachId],
		references: [users.id]
	}),
	shareLinks: many(shareLinks),
	contacts: many(contacts),
	emailLogs: many(emailLogs),
	inboxThreads: many(inboxThreads),
	teamMembers: many(teamMembers),
	teamInvites: many(teamInvites),
}));

export const usersRelations = relations(users, ({many}) => ({
	players: many(players),
	teams: many(teams),
	shareLinks: many(shareLinks),
	oauthTokens: many(oauthTokens),
	emailLogs: many(emailLogs),
	threadNotes: many(threadNotes),
	teamMembers_invitedBy: many(teamMembers, {
		relationName: "teamMembers_invitedBy_users_id"
	}),
	teamMembers_userId: many(teamMembers, {
		relationName: "teamMembers_userId_users_id"
	}),
	teamInvites: many(teamInvites),
}));

export const sitOutsRelations = relations(sitOuts, ({one}) => ({
	player: one(players, {
		fields: [sitOuts.playerId],
		references: [players.id]
	}),
	game: one(games, {
		fields: [sitOuts.gameId],
		references: [games.id]
	}),
}));

export const shareLinksRelations = relations(shareLinks, ({one}) => ({
	user: one(users, {
		fields: [shareLinks.createdBy],
		references: [users.id]
	}),
	team: one(teams, {
		fields: [shareLinks.teamId],
		references: [teams.id]
	}),
	game: one(games, {
		fields: [shareLinks.gameId],
		references: [games.id]
	}),
}));

export const contactsRelations = relations(contacts, ({one}) => ({
	player: one(players, {
		fields: [contacts.playerId],
		references: [players.id]
	}),
	team: one(teams, {
		fields: [contacts.teamId],
		references: [teams.id]
	}),
}));

export const oauthTokensRelations = relations(oauthTokens, ({one}) => ({
	user: one(users, {
		fields: [oauthTokens.userId],
		references: [users.id]
	}),
}));

export const emailLogsRelations = relations(emailLogs, ({one}) => ({
	user: one(users, {
		fields: [emailLogs.sentBy],
		references: [users.id]
	}),
	game: one(games, {
		fields: [emailLogs.gameId],
		references: [games.id]
	}),
	team: one(teams, {
		fields: [emailLogs.teamId],
		references: [teams.id]
	}),
}));

export const inboxThreadsRelations = relations(inboxThreads, ({one, many}) => ({
	game: one(games, {
		fields: [inboxThreads.gameId],
		references: [games.id]
	}),
	team: one(teams, {
		fields: [inboxThreads.teamId],
		references: [teams.id]
	}),
	inboxMessages: many(inboxMessages),
	threadNotes: many(threadNotes),
}));

export const inboxMessagesRelations = relations(inboxMessages, ({one}) => ({
	inboxThread: one(inboxThreads, {
		fields: [inboxMessages.threadId],
		references: [inboxThreads.id]
	}),
}));

export const threadNotesRelations = relations(threadNotes, ({one}) => ({
	user: one(users, {
		fields: [threadNotes.userId],
		references: [users.id]
	}),
	inboxThread: one(inboxThreads, {
		fields: [threadNotes.threadId],
		references: [inboxThreads.id]
	}),
}));

export const teamMembersRelations = relations(teamMembers, ({one}) => ({
	user_invitedBy: one(users, {
		fields: [teamMembers.invitedBy],
		references: [users.id],
		relationName: "teamMembers_invitedBy_users_id"
	}),
	user_userId: one(users, {
		fields: [teamMembers.userId],
		references: [users.id],
		relationName: "teamMembers_userId_users_id"
	}),
	team: one(teams, {
		fields: [teamMembers.teamId],
		references: [teams.id]
	}),
}));

export const teamInvitesRelations = relations(teamInvites, ({one}) => ({
	user: one(users, {
		fields: [teamInvites.invitedBy],
		references: [users.id]
	}),
	team: one(teams, {
		fields: [teamInvites.teamId],
		references: [teams.id]
	}),
}));