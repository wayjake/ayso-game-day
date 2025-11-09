import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Users table
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  role: text('role', { enum: ['coach', 'admin', 'assistant-coach'] }).notNull().default('coach'),
  teamName: text('team_name'),
  gameFormat: text('game_format', { enum: ['7v7', '9v9', '11v11'] }),
  region: text('region'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Teams table
export const teams = sqliteTable('teams', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  coachId: integer('coach_id').notNull().references(() => users.id),
  format: text('format', { enum: ['7v7', '9v9', '11v11'] }).notNull(),
  ageGroup: text('age_group'), // e.g., U12, U14
  season: text('season'), // e.g., Fall 2024
  region: text('region'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Players table
export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  coachId: integer('coach_id').references(() => users.id), // Historical record
  name: text('name').notNull(),
  description: text('description'), // Notes about player (e.g., "Fast, good at defense")
  profilePicture: text('profile_picture'), // Legacy single URL
  profileImageBase: text('profile_image_base'), // Base URL for multi-size images (e.g., "https://utfs.io/f/abc123")
  preferredPositions: text('preferred_positions'), // JSON array of position IDs
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Template Formations table
export const templateFormations = sqliteTable('template_formations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(), // e.g., "3-3-2 Balanced"
  format: text('format', { enum: ['7v7', '9v9', '11v11'] }).notNull(),
  formation: text('formation').notNull(), // e.g., "3-3-2", "4-3-3"
  positions: text('positions').notNull(), // JSON array of position objects
  description: text('description'),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Games table
export const games = sqliteTable('games', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  formationId: integer('formation_id').references(() => templateFormations.id),
  opponent: text('opponent'),
  gameDate: text('game_date').notNull(),
  gameTime: text('game_time'),
  field: text('field'),
  homeAway: text('home_away', { enum: ['home', 'away'] }),
  status: text('status', { enum: ['scheduled', 'in-progress', 'completed', 'cancelled'] }).default('scheduled'),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Assignments table (Player assignments for each game)
export const assignments = sqliteTable('assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').notNull().references(() => games.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  positionNumber: integer('position_number').notNull(), // Soccer position number (1-11)
  positionName: text('position_name'), // e.g., "GK", "CB", "LW"
  quarter: integer('quarter'), // Which quarter/half they play this position
  isSittingOut: integer('is_sitting_out', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Position definitions (static reference data)
export const positions = sqliteTable('positions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  number: integer('number').notNull(), // Traditional soccer number
  abbreviation: text('abbreviation').notNull(), // e.g., "GK", "CB", "LW"
  fullName: text('full_name').notNull(), // e.g., "Goalkeeper", "Center Back"
  category: text('category', { enum: ['goalkeeper', 'defender', 'midfielder', 'forward'] }).notNull(),
  format: text('format', { enum: ['7v7', '9v9', '11v11', 'all'] }).notNull().default('all'),
});

// Sit-out tracking for AYSO fair play
export const sitOuts = sqliteTable('sit_outs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').notNull().references(() => games.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  quarter: integer('quarter').notNull(),
  reason: text('reason'), // e.g., "rotation", "injury", "late arrival"
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Share links for public game viewing
export const shareLinks = sqliteTable('share_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: integer('game_id').notNull().references(() => games.id),
  teamId: integer('team_id').notNull().references(() => teams.id),
  shareId: text('share_id').notNull().unique(), // unique ID for the share link
  expiresAt: text('expires_at').notNull(), // timestamp when link expires
  createdBy: integer('created_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Contacts table for player family communications
export const contacts = sqliteTable('contacts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  playerId: integer('player_id').references(() => players.id), // Optional link to player
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  relationship: text('relationship', { enum: ['parent', 'guardian', 'self', 'emergency'] }), // Relationship to player
  isPrimary: integer('is_primary', { mode: 'boolean' }).default(false),
  notes: text('notes'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// OAuth tokens for Gmail integration
export const oauthTokens = sqliteTable('oauth_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  provider: text('provider', { enum: ['gmail'] }).notNull(),
  accessToken: text('access_token').notNull(), // Should be encrypted in production
  refreshToken: text('refresh_token').notNull(), // Should be encrypted in production
  tokenType: text('token_type').default('Bearer'),
  expiresAt: text('expires_at').notNull(),
  scope: text('scope'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Email logs for sent messages
export const emailLogs = sqliteTable('email_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  gameId: integer('game_id').references(() => games.id), // Optional association
  sentBy: integer('sent_by').notNull().references(() => users.id),
  provider: text('provider', { enum: ['brevo', 'gmail'] }).notNull(),
  providerMessageId: text('provider_message_id'), // External ID from Brevo/Gmail
  subject: text('subject').notNull(),
  recipients: text('recipients').notNull(), // JSON array of emails
  body: text('body'),
  status: text('status', { enum: ['sending', 'sent', 'failed', 'delivered', 'bounced'] }).default('sending'),
  errorMessage: text('error_message'),
  sentAt: text('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  deliveredAt: text('delivered_at'),
});

// Inbox threads for team communications
export const inboxThreads = sqliteTable('inbox_threads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  gameId: integer('game_id').references(() => games.id),
  subject: text('subject').notNull(),
  participants: text('participants').notNull(), // JSON array of email addresses
  lastMessageAt: text('last_message_at').notNull(),
  lastMessagePreview: text('last_message_preview'),
  isRead: integer('is_read', { mode: 'boolean' }).default(false),
  messageCount: integer('message_count').default(1),
  gmailThreadId: text('gmail_thread_id'), // For Gmail API integration
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Inbox messages within threads
export const inboxMessages = sqliteTable('inbox_messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').notNull().references(() => inboxThreads.id),
  provider: text('provider', { enum: ['brevo', 'gmail'] }).notNull(),
  providerMessageId: text('provider_message_id').unique(),
  gmailMessageId: text('gmail_message_id'), // Gmail specific
  direction: text('direction', { enum: ['inbound', 'outbound'] }).notNull(),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name'),
  toEmails: text('to_emails').notNull(), // JSON array
  subject: text('subject').notNull(),
  body: text('body'),
  bodyHtml: text('body_html'),
  attachments: text('attachments'), // JSON array of attachment metadata
  receivedAt: text('received_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Thread notes for internal coach collaboration
export const threadNotes = sqliteTable('thread_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  threadId: integer('thread_id').notNull().references(() => inboxThreads.id),
  userId: integer('user_id').notNull().references(() => users.id),
  note: text('note').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type TemplateFormation = typeof templateFormations.$inferSelect;
export type NewTemplateFormation = typeof templateFormations.$inferInsert;
export type Game = typeof games.$inferSelect;
export type NewGame = typeof games.$inferInsert;
export type Assignment = typeof assignments.$inferSelect;
export type NewAssignment = typeof assignments.$inferInsert;
export type Position = typeof positions.$inferSelect;
export type NewPosition = typeof positions.$inferInsert;
export type SitOut = typeof sitOuts.$inferSelect;
export type NewSitOut = typeof sitOuts.$inferInsert;
export type ShareLink = typeof shareLinks.$inferSelect;
export type NewShareLink = typeof shareLinks.$inferInsert;
export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
export type OAuthToken = typeof oauthTokens.$inferSelect;
export type NewOAuthToken = typeof oauthTokens.$inferInsert;
export type EmailLog = typeof emailLogs.$inferSelect;
export type NewEmailLog = typeof emailLogs.$inferInsert;
export type InboxThread = typeof inboxThreads.$inferSelect;
export type NewInboxThread = typeof inboxThreads.$inferInsert;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type NewInboxMessage = typeof inboxMessages.$inferInsert;
export type ThreadNote = typeof threadNotes.$inferSelect;
export type NewThreadNote = typeof threadNotes.$inferInsert;