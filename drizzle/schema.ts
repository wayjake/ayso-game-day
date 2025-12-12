import { sqliteTable, AnySQLiteColumn, foreignKey, integer, text, uniqueIndex } from "drizzle-orm/sqlite-core"
  import { sql } from "drizzle-orm"

export const assignments = sqliteTable("assignments", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	gameId: integer("game_id").notNull().references(() => games.id),
	playerId: integer("player_id").notNull().references(() => players.id),
	positionNumber: integer("position_number").notNull(),
	positionName: text("position_name"),
	quarter: integer(),
	isSittingOut: integer("is_sitting_out").default(false),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const games = sqliteTable("games", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	formationId: integer("formation_id").references(() => templateFormations.id),
	opponent: text(),
	gameDate: text("game_date").notNull(),
	gameTime: text("game_time"),
	field: text(),
	homeAway: text("home_away"),
	status: text().default("scheduled"),
	notes: text(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const players = sqliteTable("players", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	coachId: integer("coach_id").references(() => users.id),
	name: text().notNull(),
	description: text(),
	profilePicture: text("profile_picture"),
	preferredPositions: text("preferred_positions"),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	profileImageBase: text("profile_image_base"),
	jerseyNumber: integer("jersey_number"),
});

export const positions = sqliteTable("positions", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	number: integer().notNull(),
	abbreviation: text().notNull(),
	fullName: text("full_name").notNull(),
	category: text().notNull(),
	format: text().default("all").notNull(),
});

export const sitOuts = sqliteTable("sit_outs", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	gameId: integer("game_id").notNull().references(() => games.id),
	playerId: integer("player_id").notNull().references(() => players.id),
	quarter: integer().notNull(),
	reason: text(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const teams = sqliteTable("teams", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	name: text().notNull(),
	coachId: integer("coach_id").notNull().references(() => users.id),
	format: text().notNull(),
	ageGroup: text("age_group"),
	season: text(),
	region: text(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const templateFormations = sqliteTable("template_formations", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	name: text().notNull(),
	format: text().notNull(),
	formation: text().notNull(),
	positions: text().notNull(),
	description: text(),
	isDefault: integer("is_default").default(false),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const users = sqliteTable("users", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	email: text().notNull(),
	password: text().notNull(),
	role: text().default("coach").notNull(),
	teamName: text("team_name"),
	gameFormat: text("game_format"),
	region: text(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
},
(table) => [
	uniqueIndex("users_email_unique").on(table.email),
]);

export const shareLinks = sqliteTable("share_links", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	gameId: integer("game_id").notNull().references(() => games.id),
	teamId: integer("team_id").notNull().references(() => teams.id),
	shareId: text("share_id").notNull(),
	expiresAt: text("expires_at").notNull(),
	createdBy: integer("created_by").notNull().references(() => users.id),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const contacts = sqliteTable("contacts", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	playerId: integer("player_id").references(() => players.id),
	name: text().notNull(),
	email: text().notNull(),
	phone: text(),
	relationship: text(),
	isPrimary: integer("is_primary").default(false),
	notes: text(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const oauthTokens = sqliteTable("oauth_tokens", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	userId: integer("user_id").notNull().references(() => users.id),
	provider: text().notNull(),
	accessToken: text("access_token").notNull(),
	refreshToken: text("refresh_token").notNull(),
	tokenType: text("token_type").default("Bearer"),
	expiresAt: text("expires_at").notNull(),
	scope: text(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const emailLogs = sqliteTable("email_logs", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	gameId: integer("game_id").references(() => games.id),
	sentBy: integer("sent_by").notNull().references(() => users.id),
	provider: text().notNull(),
	providerMessageId: text("provider_message_id"),
	subject: text().notNull(),
	recipients: text().notNull(),
	body: text(),
	status: text().default("sending"),
	errorMessage: text("error_message"),
	sentAt: text("sent_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	deliveredAt: text("delivered_at"),
});

export const inboxThreads = sqliteTable("inbox_threads", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	gameId: integer("game_id").references(() => games.id),
	subject: text().notNull(),
	participants: text().notNull(),
	lastMessageAt: text("last_message_at").notNull(),
	lastMessagePreview: text("last_message_preview"),
	isRead: integer("is_read").default(false),
	messageCount: integer("message_count").default(1),
	gmailThreadId: text("gmail_thread_id"),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const inboxMessages = sqliteTable("inbox_messages", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	threadId: integer("thread_id").notNull().references(() => inboxThreads.id),
	provider: text().notNull(),
	providerMessageId: text("provider_message_id"),
	gmailMessageId: text("gmail_message_id"),
	direction: text().notNull(),
	fromEmail: text("from_email").notNull(),
	fromName: text("from_name"),
	toEmails: text("to_emails").notNull(),
	subject: text().notNull(),
	body: text(),
	bodyHtml: text("body_html"),
	attachments: text(),
	receivedAt: text("received_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
},
(table) => [
	uniqueIndex("inbox_messages_provider_message_id_unique").on(table.providerMessageId),
]);

export const threadNotes = sqliteTable("thread_notes", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	threadId: integer("thread_id").notNull().references(() => inboxThreads.id),
	userId: integer("user_id").notNull().references(() => users.id),
	note: text().notNull(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const teamMembers = sqliteTable("team_members", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	userId: integer("user_id").notNull().references(() => users.id),
	role: text().notNull(),
	invitedBy: integer("invited_by").references(() => users.id),
	invitedAt: text("invited_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	joinedAt: text("joined_at"),
	status: text().default("active").notNull(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
	updatedAt: text("updated_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
});

export const teamInvites = sqliteTable("team_invites", {
	id: integer().primaryKey({ autoIncrement: true }).notNull(),
	teamId: integer("team_id").notNull().references(() => teams.id),
	email: text(),
	shareCode: text("share_code"),
	role: text().notNull(),
	invitedBy: integer("invited_by").notNull().references(() => users.id),
	expiresAt: text("expires_at").notNull(),
	status: text().default("pending").notNull(),
	createdAt: text("created_at").default("sql`(CURRENT_TIMESTAMP)`").notNull(),
},
(table) => [
	uniqueIndex("team_invites_share_code_unique").on(table.shareCode),
]);

