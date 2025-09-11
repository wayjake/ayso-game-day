import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
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