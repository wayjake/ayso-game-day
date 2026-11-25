import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

// Users table
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull().unique(),
  password: text('password').notNull(),
  name: text('name'), // Printed on game cards
  role: text('role', { enum: ['coach', 'admin', 'assistant-coach', 'parent'] }).notNull().default('coach'),
  teamName: text('team_name'),
  gameFormat: text('game_format', { enum: ['7v7', '9v9', '11v11'] }),
  region: text('region'),
  // Address announcements and email replies go out from, on the app's sending
  // domain (e.g. jake@benchtalk.app). Falls back to EMAIL_FROM.
  sendingEmail: text('sending_email'),
  toursSeen: text('tours_seen'), // JSON: { [tourId]: version } for tours finished or dismissed
  notifyPrefs: text('notify_prefs'), // JSON: { [kind]: boolean } overrides; see utils/notify.ts
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Password reset links. Only a SHA-256 hash of the token is stored; the
// token itself goes out in the email. Single use, short-lived.
export const passwordResets = sqliteTable('password_resets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
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
  teamNumber: text('team_number'), // AYSO team # printed on game cards
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Players table
export const players = sqliteTable('players', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  coachId: integer('coach_id').references(() => users.id), // Historical record
  name: text('name').notNull(),
  jerseyNumber: integer('jersey_number'), // Player's jersey number
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

// Team members for multi-coach teams
export const teamMembers = sqliteTable('team_members', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  userId: integer('user_id').notNull().references(() => users.id),
  // Staff role (utils/team-roles.ts); all give the same coach access. 'owner' rows
  // are a legacy backfill of each team's creator and read as 'coach'. The owner
  // may have no row at all, in which case they're a coach.
  role: text('role', { enum: ['owner', 'coach', 'assistant-coach', 'team-manager'] }).notNull(),
  invitedBy: integer('invited_by').references(() => users.id),
  invitedAt: text('invited_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  joinedAt: text('joined_at'),
  status: text('status', { enum: ['active', 'removed'] }).notNull().default('active'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Team invites for sharing team access
export const teamInvites = sqliteTable('team_invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  email: text('email'),
  shareCode: text('share_code').unique(),
  role: text('role', { enum: ['coach', 'assistant-coach', 'team-manager'] }).notNull(), // Staff role given on accept
  invitedBy: integer('invited_by').notNull().references(() => users.id),
  expiresAt: text('expires_at').notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'revoked'] }).notNull().default('pending'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// ---------------------------------------------------------------------------
// Families: parent accounts, practices, RSVPs, messaging and push

// Links a parent account to a player. Being a parent comes from having rows
// here, never from users.role or team_members (which would grant coach access).
// One user can coach some teams and be a parent on others.
export const guardians = sqliteTable('guardians', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  teamId: integer('team_id').notNull().references(() => teams.id), // Denormalized from players for team-wide queries
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('guardians_user_player_idx').on(t.userId, t.playerId),
  index('guardians_team_idx').on(t.teamId),
]);

// One invite per family email per team. Accepting links the account to every
// player on the team that has a contact with this email (siblings included).
export const parentInvites = sqliteTable('parent_invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  email: text('email').notNull(), // Lowercased
  shareCode: text('share_code').notNull().unique(),
  invitedBy: integer('invited_by').notNull().references(() => users.id),
  expiresAt: text('expires_at').notNull(),
  status: text('status', { enum: ['pending', 'accepted', 'revoked'] }).notNull().default('pending'),
  acceptedBy: integer('accepted_by').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Email sign-in links for families. Keyed by email rather than user, since
// using the link creates the parent's account if there isn't one yet. Only a
// SHA-256 hash of the token is stored. Single use, short-lived.
export const loginLinks = sqliteTable('login_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(), // Lowercased
  tokenHash: text('token_hash').notNull().unique(),
  // The 6-digit code in the same email, for typing into the installed app (links open in Safari instead)
  codeHash: text('code_hash'),
  codeAttempts: integer('code_attempts').notNull().default(0),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('login_links_email_idx').on(t.email)]);

// Practices. A weekly series is just rows sharing a seriesId, so any single
// date can be moved or cancelled without touching the rest.
export const practices = sqliteTable('practices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  seriesId: text('series_id'),
  practiceDate: text('practice_date').notNull(), // YYYY-MM-DD, like games.gameDate
  startTime: text('start_time'), // HH:MM, 24h
  endTime: text('end_time'),
  location: text('location'),
  notes: text('notes'),
  status: text('status', { enum: ['scheduled', 'cancelled'] }).notNull().default('scheduled'),
  createdBy: integer('created_by').references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('practices_team_date_idx').on(t.teamId, t.practiceDate),
]);

// Whether a player is coming to a game or practice. Set by a parent, or by a
// coach on their behalf. One row per player per event.
export const rsvps = sqliteTable('rsvps', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  eventType: text('event_type', { enum: ['game', 'practice'] }).notNull(),
  eventId: integer('event_id').notNull(),
  status: text('status', { enum: ['yes', 'no', 'maybe'] }).notNull(),
  note: text('note'),
  respondedBy: integer('responded_by').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('rsvps_event_player_idx').on(t.eventType, t.eventId, t.playerId),
  index('rsvps_team_idx').on(t.teamId),
]);

// A team chat (every coach and parent on the team) or a private thread between
// one parent and the team's coaching staff.
export const conversations = sqliteTable('conversations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  kind: text('kind', { enum: ['team', 'direct'] }).notNull(),
  // A 'direct' thread is one-to-one: one staff member (staffUserId) and one
  // family. Only those two can read it; other staff can't. The family side is a
  // parent account, a family email, or both. A family that isn't on the app yet
  // has only familyEmail; the thread moves to their account when they join with
  // a proven email (invite or magic link).
  staffUserId: integer('staff_user_id').references(() => users.id),
  parentUserId: integer('parent_user_id').references(() => users.id),
  familyEmail: text('family_email'), // Lowercased
  // The family wrote last and the staff member hasn't replied or marked it done
  needsReply: integer('needs_reply', { mode: 'boolean' }).notNull().default(false),
  lastMessageAt: text('last_message_at'),
  lastMessagePreview: text('last_message_preview'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('conversations_team_chat_idx').on(t.teamId).where(sql`kind = 'team'`),
  uniqueIndex('conversations_direct_staff_idx').on(t.teamId, t.staffUserId, t.parentUserId).where(sql`kind = 'direct'`),
  uniqueIndex('conversations_family_email_staff_idx').on(t.teamId, t.staffUserId, t.familyEmail).where(sql`kind = 'direct' and family_email is not null`),
]);

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: integer('conversation_id').notNull().references(() => conversations.id),
  // Null for a reply that came in by email from a family with no account
  senderId: integer('sender_id').references(() => users.id),
  senderEmail: text('sender_email'), // Email replies: who it came from
  senderName: text('sender_name'),
  source: text('source', { enum: ['app', 'email'] }).notNull().default('app'),
  body: text('body').notNull(), // For email replies, the new text with quoted history trimmed
  announcementId: integer('announcement_id'), // Set on the copy of an announcement in a family's thread
  inboundEmailId: integer('inbound_email_id'), // Email replies: the full message
  // A coach's message that was also emailed to the family
  emailedTo: text('emailed_to'),
  resendEmailId: text('resend_email_id'),
  emailMessageId: text('email_message_id'), // RFC Message-ID, so replies to it can be matched
  // Set on a reply: the thread's root message. Threads are one level deep, so
  // a reply to a reply points at the same root.
  parentId: integer('parent_id'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('messages_conversation_idx').on(t.conversationId, t.id),
  index('messages_parent_idx').on(t.parentId, t.id),
  index('messages_resend_email_idx').on(t.resendEmailId),
  index('messages_email_message_idx').on(t.emailMessageId),
]);

// One emoji reaction per person per message per emoji, from a fixed set (utils/reactions.ts).
export const messageReactions = sqliteTable('message_reactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  messageId: integer('message_id').notNull().references(() => messages.id),
  userId: integer('user_id').notNull().references(() => users.id),
  emoji: text('emoji').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('message_reactions_unique_idx').on(t.messageId, t.userId, t.emoji),
]);

// Read position per person per conversation. Message ids only go up, so
// "unread" is any message with a higher id than lastReadMessageId.
export const conversationReads = sqliteTable('conversation_reads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  conversationId: integer('conversation_id').notNull().references(() => conversations.id),
  userId: integer('user_id').notNull().references(() => users.id),
  lastReadMessageId: integer('last_read_message_id').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('conversation_reads_idx').on(t.conversationId, t.userId),
]);

// An email blast from a coach to families. Each family gets its own email
// (so replies and opens can be tracked per family) and a copy in their
// private thread with the coaches.
export const announcements = sqliteTable('announcements', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  sentBy: integer('sent_by').notNull().references(() => users.id),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  ask: text('ask', { enum: ['none', 'ack', 'reply'] }).notNull().default('none'),
  fromEmail: text('from_email').notNull(), // The address it went out from
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('announcements_team_idx').on(t.teamId)]);

// One row per family per announcement, tracking what happened to their email.
export const announcementRecipients = sqliteTable('announcement_recipients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  announcementId: integer('announcement_id').notNull().references(() => announcements.id),
  teamId: integer('team_id').notNull().references(() => teams.id),
  familyEmail: text('family_email').notNull(), // Lowercased
  familyLabel: text('family_label').notNull(), // "Garcia (Mia, Leo)" when sent
  sentToEmail: text('sent_to_email').notNull(), // Differs from familyEmail only when dev redirect is on
  parentUserId: integer('parent_user_id').references(() => users.id), // On the app when sent
  conversationId: integer('conversation_id').references(() => conversations.id),
  messageId: integer('message_id').references(() => messages.id), // The copy in their thread
  ackToken: text('ack_token').notNull().unique(),
  status: text('status', { enum: ['pending', 'sent', 'failed'] }).notNull().default('pending'),
  error: text('error'),
  resendEmailId: text('resend_email_id'),
  emailMessageId: text('email_message_id'),
  sentAt: text('sent_at'),
  deliveredAt: text('delivered_at'),
  openedAt: text('opened_at'),
  bouncedAt: text('bounced_at'),
  bounceReason: text('bounce_reason'),
  complainedAt: text('complained_at'),
  repliedAt: text('replied_at'),
  acknowledgedAt: text('acknowledged_at'),
  // Who tapped "Got it" first, and where: in the app (a parent account) or the
  // email's link (an account only when they were signed in as one of the family)
  acknowledgedBy: integer('acknowledged_by').references(() => users.id),
  acknowledgedVia: text('acknowledged_via', { enum: ['app', 'email'] }),
  remindedAt: text('reminded_at'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('announcement_recipients_family_idx').on(t.announcementId, t.familyEmail),
  index('announcement_recipients_resend_idx').on(t.resendEmailId),
  index('announcement_recipients_message_idx').on(t.emailMessageId),
  index('announcement_recipients_team_email_idx').on(t.teamId, t.familyEmail),
]);

// Coach-only notes about a family. Never loaded by anything a parent can reach.
export const familyNotes = sqliteTable('family_notes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  familyEmail: text('family_email').notNull(), // Lowercased
  authorId: integer('author_id').notNull().references(() => users.id),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('family_notes_family_idx').on(t.teamId, t.familyEmail)]);

// Every email received on the app's domain, kept whole so it can be re-matched.
export const inboundEmails = sqliteTable('inbound_emails', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  resendEmailId: text('resend_email_id').notNull().unique(),
  fromEmail: text('from_email').notNull(), // Lowercased
  fromName: text('from_name'),
  toEmails: text('to_emails').notNull(), // JSON array
  subject: text('subject'),
  text: text('text'), // Plain text only; inbound HTML is never rendered
  emailMessageId: text('email_message_id'),
  inReplyTo: text('in_reply_to'),
  references: text('references'),
  authPassed: integer('auth_passed', { mode: 'boolean' }),
  isAutoReply: integer('is_auto_reply', { mode: 'boolean' }).notNull().default(false),
  // matched: in a family thread. unmatched: needs a coach to assign it. dismissed: ignored.
  status: text('status', { enum: ['matched', 'unmatched', 'dismissed'] }).notNull().default('unmatched'),
  matchedBy: text('matched_by'), // headers | sender | coach
  teamId: integer('team_id').references(() => teams.id),
  ownerUserId: integer('owner_user_id').references(() => users.id), // Coach whose address it was sent to
  conversationId: integer('conversation_id').references(() => conversations.id),
  recipientId: integer('recipient_id').references(() => announcementRecipients.id),
  receivedAt: text('received_at').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('inbound_emails_status_idx').on(t.status),
  index('inbound_emails_owner_idx').on(t.ownerUserId),
]);

// Web Push subscriptions, one per browser/device a person turned notifications on in.
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('push_subscriptions_user_idx').on(t.userId),
]);

// ---------------------------------------------------------------------------
// Team feed: photo and video posts that only the team's coaches and parents see.
// Files go to UploadThing and are public URLs (decided 2026-11-24); the pages
// and APIs are what check team access. See utils/feed.server.ts.

// A file uploaded from the composer before "Post" is tapped. Publishing moves
// it into post_media; drafts older than a day are swept, files and all.
export const postUploads = sqliteTable('post_uploads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  fileKey: text('file_key').notNull().unique(),
  userId: integer('user_id').notNull().references(() => users.id),
  teamId: integer('team_id').notNull().references(() => teams.id),
  type: text('type', { enum: ['image', 'video'] }).notNull(),
  url: text('url').notNull(),
  name: text('name'),
  size: integer('size'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('post_uploads_user_idx').on(t.userId),
]);

export const posts = sqliteTable('posts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  authorId: integer('author_id').notNull().references(() => users.id),
  caption: text('caption'),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('posts_team_idx').on(t.teamId, t.id),
]);

// One row per file in a post, in carousel order. display/thumb are the smaller
// JPEG copies the browser made (1280px and 400px); null when that failed.
export const postMedia = sqliteTable('post_media', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postId: integer('post_id').notNull().references(() => posts.id),
  position: integer('position').notNull().default(0),
  type: text('type', { enum: ['image', 'video'] }).notNull(),
  url: text('url').notNull(),
  fileKey: text('file_key').notNull().unique(),
  displayUrl: text('display_url'),
  displayKey: text('display_key'),
  thumbUrl: text('thumb_url'),
  thumbKey: text('thumb_key'),
  width: integer('width'),
  height: integer('height'),
}, (t) => [
  index('post_media_post_idx').on(t.postId, t.position),
]);

export const postLikes = sqliteTable('post_likes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postId: integer('post_id').notNull().references(() => posts.id),
  userId: integer('user_id').notNull().references(() => users.id),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('post_likes_unique_idx').on(t.postId, t.userId),
]);

// Flat comments. clientId comes from the browser, so a retried send can't
// post the same comment twice and the optimistic copy can be matched up.
export const postComments = sqliteTable('post_comments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  postId: integer('post_id').notNull().references(() => posts.id),
  userId: integer('user_id').notNull().references(() => users.id),
  clientId: text('client_id').notNull().unique(),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  index('post_comments_post_idx').on(t.postId, t.id),
]);

// ---------------------------------------------------------------------------
// Tasks: things families need to do ("Pay the uniform fee", "Sign the code of
// conduct"). Rules live in utils/tasks.core.ts, shared with the MCP server.

export const tasks = sqliteTable('tasks', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  teamId: integer('team_id').notNull().references(() => teams.id),
  title: text('title').notNull(),
  details: text('details'),
  link: text('link'), // e.g. a payment page or the form to sign
  dueDate: text('due_date'), // YYYY-MM-DD
  // Every player on the team, including ones added later (backfilled on read)
  assignAll: integer('assign_all', { mode: 'boolean' }).notNull().default(true),
  // One per family: checking it for one sibling checks it for every sibling
  perFamily: integer('per_family', { mode: 'boolean' }).notNull().default(false),
  // Counts as done only once a coach confirms it, not when the family checks it
  coachConfirms: integer('coach_confirms', { mode: 'boolean' }).notNull().default(false),
  createdBy: integer('created_by').references(() => users.id), // Null when imported
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [index('tasks_team_idx').on(t.teamId)]);

// One per task per player. A coach confirming also fills in the family side
// (familyDoneVia = 'coach'), so parents see it as done.
export const taskAssignments = sqliteTable('task_assignments', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  taskId: integer('task_id').notNull().references(() => tasks.id),
  teamId: integer('team_id').notNull().references(() => teams.id),
  playerId: integer('player_id').notNull().references(() => players.id),
  familyDoneAt: text('family_done_at'),
  familyDoneBy: integer('family_done_by').references(() => users.id), // Null from a no-login link, a coach, or an import
  familyDoneVia: text('family_done_via', { enum: ['app', 'link', 'coach', 'import'] }),
  confirmedAt: text('confirmed_at'),
  confirmedBy: integer('confirmed_by').references(() => users.id),
  note: text('note'), // Coach-only, e.g. "Paid cash"
  createdAt: text('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => [
  uniqueIndex('task_assignments_task_player_idx').on(t.taskId, t.playerId),
  index('task_assignments_team_player_idx').on(t.teamId, t.playerId),
]);

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
export type TeamMember = typeof teamMembers.$inferSelect;
export type NewTeamMember = typeof teamMembers.$inferInsert;
export type TeamInvite = typeof teamInvites.$inferSelect;
export type NewTeamInvite = typeof teamInvites.$inferInsert;export type Guardian = typeof guardians.$inferSelect;
export type ParentInvite = typeof parentInvites.$inferSelect;
export type Practice = typeof practices.$inferSelect;
export type NewPractice = typeof practices.$inferInsert;
export type Rsvp = typeof rsvps.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type AnnouncementRecipient = typeof announcementRecipients.$inferSelect;
export type FamilyNote = typeof familyNotes.$inferSelect;
export type InboundEmail = typeof inboundEmails.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostMedia = typeof postMedia.$inferSelect;

export type Task = typeof tasks.$inferSelect;
export type TaskAssignment = typeof taskAssignments.$inferSelect;
