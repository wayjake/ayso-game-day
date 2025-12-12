# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# AYSO Game Day Project

This project is an AYSO (American Youth Soccer Organization) team management application built with React Router v7, Drizzle ORM, and SQLite/Turso.

## Technology Stack & Architecture

### Core Framework
- **React Router v7** - Full-stack React framework with server-side rendering
- **TypeScript** - Full type safety with auto-generated route types
- **Vite** - Build tool and dev server with HMR
- **Node.js 20+** - Server runtime

### Database Layer
- **Drizzle ORM** - Type-safe database toolkit with schema inference
- **Turso/LibSQL** - Cloud-based SQLite for staging and production
- **SQLite** - Local development fallback
- **Database environments**:
  - **Local/Staging**: Uses `TURSO_URL` and `TURSO_TOKEN` (or falls back to local SQLite)
    - Commands: `npm run db:push`, `npm run db:migrate`, `npm run db:studio`
  - **Production**: Uses `TURSO_PROD_URL` and `TURSO_PROD_TOKEN`
    - Commands: `npm run db:prod:migrate`, `npm run db:prod:studio`
    - No `db:prod:push` by design (use migrations only for production)

### Styling & UI
- **Tailwind CSS v4** - Utility-first CSS framework
- CSS custom properties for theming in `/app/app.css`
- Color scheme: Cyan-Blue primary (#0EA5E9), AYSO Red accent (#EF4444)

### File Uploads & AI
- **UploadThing** - Image upload and CDN hosting with multi-size support
- **OpenAI API** - AI-powered lineup generation and transcription
- **Anthropic Claude SDK** - Advanced AI assistant features

## Project Structure

```
app/
├── api/
│   └── ai-lineup/          # AI lineup generation modules
│       ├── route.ts        # Main AI API endpoint
│       ├── types.ts        # Shared TypeScript types
│       ├── prompt-builder.ts
│       ├── validation.ts
│       └── data-fetchers.ts
├── components/             # Reusable UI components
├── db/
│   ├── schema.ts          # Drizzle ORM schema definitions
│   ├── index.ts           # Database client with Turso/SQLite fallback
│   └── seed.ts            # Database seeding script
├── hooks/                 # Custom React hooks
├── routes/                # Route modules (file-based routing)
├── server/                # Server-side utilities
├── utils/
│   ├── auth.server.ts     # Authentication utilities
│   ├── formations.ts      # Formation definitions
│   ├── position-changes.ts # Position change detection
│   └── image.ts           # Image URL helpers
├── app.css                # Global styles and theme
├── root.tsx               # Root layout component
├── routes.ts              # Route configuration
└── sessions.server.ts     # Session management
```

## Development Commands

```bash
# Development
npm run dev              # Start dev server (localhost:5173)
npm run build            # Production build
npm run start            # Start production server
npm run typecheck        # TypeScript + route type generation

# Database (Local/Staging)
npm run db:push          # Apply schema changes to database
npm run db:generate      # Create migration files
npm run db:migrate       # Run migrations
npm run db:seed          # Seed formations and positions
npm run db:studio        # Open Drizzle Studio GUI (localhost:4983)

# Database (Production)
npm run db:prod:migrate  # Run migrations on production
npm run db:prod:studio   # Open Drizzle Studio for production
```

## Database Schema

The application uses Drizzle ORM with 8 main tables:

### Core Entities
1. **users** - Authentication and user profiles
   - Fields: id, email, password (bcrypt hashed), role, teamName, gameFormat, region, timestamps
   - Roles: coach, admin, assistant-coach

2. **teams** - Team information and settings
   - Fields: id, name, coachId, format (7v7/9v9/11v11), ageGroup, season, region, timestamps
   - Relationship: One user (coach) can have many teams

3. **players** - Player profiles with photos and preferred positions
   - Fields: id, teamId, coachId, name, description, profilePicture (legacy), profileImageBase, preferredPositions (JSON array), timestamps
   - Multi-size image support: `-thumbnail.jpg`, `-medium.jpg`, `-large.jpg`
   - Use `getImageUrl()` helper from `/app/utils/image.ts` for all player images

4. **templateFormations** - Pre-configured formation templates
   - Fields: id, name, format, formation, positions (JSON with x/y coordinates), description, isDefault, createdAt
   - Percentage-based coordinates (x: 0-100, y: 0-100)
   - Traditional soccer numbering (1=GK, 2-11=field positions)

5. **games** - Game scheduling and details
   - Fields: id, teamId, formationId, opponent, gameDate, gameTime, field, homeAway, status, notes, timestamps
   - Status: scheduled, in-progress, completed, cancelled

6. **assignments** - Player position assignments per game/quarter
   - Fields: id, gameId, playerId, positionNumber, positionName, quarter, isSittingOut, timestamps
   - Quarter-based tracking (1-4) for AYSO compliance

7. **positions** - Static reference data for position definitions
   - Fields: id, number, abbreviation, fullName, category, format
   - Categories: goalkeeper, defender, midfielder, forward
   - Format-specific positions (7v7, 9v9, 11v11, or all)

8. **shareLinks** - Public shareable links for game lineups
   - Fields: id, gameId, teamId, shareId (unique), expiresAt, createdBy, createdAt
   - Allows parents/players to view lineups without authentication

9. **sitOuts** - AYSO fair-play tracking
   - Fields: id, gameId, playerId, quarter, reason, createdAt

## Authentication System

### Session Management (`app/sessions.server.ts`)
- Cookie-based sessions with `createCookieSessionStorage`
- Session cookie name: `ayso_session`
- Max age: 1 week
- HttpOnly, Secure in production
- Session data: `userId`, `userEmail`, `userRole`

### Authentication Utilities (`app/utils/auth.server.ts`)
- `hashPassword(password)` - bcrypt password hashing (10 rounds)
- `createUser(email, password, userData)` - User registration with automatic team creation
- `authenticateUser(email, password)` - Email/password validation
- `requireUserId(request)` - Throws redirect if not authenticated
- `getUser(request)` - Fetches current user, optional redirect to `/user/login`

### Route Protection Pattern
Protected routes use the dashboard layout which automatically checks authentication:

```typescript
// app/routes/dashboard.tsx
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request); // Auto-redirects to /user/login if not authenticated
  return data({ user });
}
```

## Routing System (React Router v7)

### Route Configuration
Routes are defined in `/app/routes.ts` using React Router v7's configuration:

```typescript
// Nested layout pattern
route("dashboard", "routes/dashboard.tsx", [
  route("", "routes/dashboard._index.tsx"),
  route("team/:teamId", "routes/team.tsx", [
    route("roster", "routes/team.roster.tsx"),
    route("games/:gameId/lineup", "routes/team.games.game.lineup.tsx"),
  ])
])
```

### Route Module Pattern
Every route file exports:
- `loader()` - Server-side data fetching (runs on every request)
- `action()` - Form submissions and mutations (POST/PUT/DELETE)
- `default` component - React component
- `meta()` - Page metadata (optional)

Example:
```typescript
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await getUser(request);
  const team = await db.query.teams.findFirst({
    where: eq(teams.id, parseInt(params.teamId!)),
  });
  return data({ team, user });
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const _action = formData.get('_action');
  // Handle different actions based on _action field
  return data({ success: true });
}

export default function Component({ loaderData }: Route.ComponentProps) {
  const { team, user } = loaderData;
  return <div>...</div>;
}
```

### Current Route Structure
```
/ - Homepage
/user/signup - Registration
/user/login - Login
/user/logout - Logout
/api/uploadthing - File upload handler
/api/ai-lineup - AI lineup generation
/public/game/:id - Public game view (no auth)

/dashboard - Protected dashboard layout
  /dashboard - Dashboard overview
  /dashboard/teams - Team list
  /dashboard/teams/new - Create team
  /dashboard/team/:teamId - Team layout (nested routes)
    /dashboard/team/:teamId - Team overview
    /dashboard/team/:teamId/roster - Player roster
    /dashboard/team/:teamId/roster/new-player - Add player
    /dashboard/team/:teamId/roster/player/:playerId/edit - Edit player
    /dashboard/team/:teamId/games - Games list
    /dashboard/team/:teamId/games/new - Create game
    /dashboard/team/:teamId/games/:gameId/lineup - Lineup planner ⭐
    /dashboard/team/:teamId/rotations - Rotation overview
    /dashboard/team/:teamId/player/remove - Remove player
```

## Key Features & Implementation Patterns

### 1. Lineup Planner (`/app/routes/team.games.game.lineup.tsx`)
The core feature of the app with:
- **Drag-and-drop player assignment**: Drag from roster to field positions
- **Quarter-by-quarter management**: 4 quarters with independent lineups
- **Formation selection**: Choose from templates or create custom
- **Position change indicators**: Visual circles showing position changes between quarters
- **Playing count badges**: Tracks how many quarters each player has played
- **Previous quarter hints**: Faded indicators showing prior positions
- **Absent/injured player tracking**: Modal to mark players unavailable
- **AI Assistant Coach**: Voice and text-based lineup suggestions
- **Public share links**: Generate expiring links for parents/players

**Data Flow:**
```
loader() → Fetch game, players, assignments, formations
action() → Handle assignPlayer, removePlayer, copyQuarter, updateFormation
Component → Drag/drop UI, visual indicators, AI assistant
```

### 2. AI Assistant Coach (`/app/components/AIAssistantCoach.tsx` + `/app/api/ai-lineup/`)
Features:
- Text-based lineup suggestions
- Voice recording and transcription (OpenAI Whisper)
- Context-aware recommendations (player history, preferred positions)
- Fair-play compliance validation
- Multi-quarter lineup generation
- Sequential and hybrid AI strategies

AI Context Includes:
- Player preferred positions
- Position history across games
- Absent/injured players
- Current partial lineups
- AYSO fair-play requirements

### 3. Formation System (`/app/utils/formations.ts`)
Supports 7v7, 9v9, and 11v11 formats:
- **Storage**: Percentage-based coordinates (x: 0-100, y: 0-100)
- **Numbering**: Traditional soccer numbering (1=GK, 2-11=field)
- **Templates**: Pre-configured formations in database (seeded via `npm run db:seed`)
- **Formats**:
  - 11v11: 4-4-2, 4-3-3, 3-5-2, 4-2-3-1
  - 9v9: 3-3-2, 3-2-3, 2-4-2
  - 7v7: 2-3-1, 3-2-1, 2-2-2

### 4. Image Upload System
- **Server**: `/app/server/uploadthing.ts` - FileRouter configuration
- **Client**: `/app/components/ImageUploader.tsx` - Upload UI with drag-drop
- **Utilities**: `/app/utils/image.ts` - URL helpers
- **Multi-size images**: Base URL in `profileImageBase`, variants auto-generated
- **Legacy support**: `profilePicture` field for backward compatibility

### 5. Position Change Detection (`/app/utils/position-changes.ts`)
Change types:
- `new_in` - Player coming from bench
- `position_swap` - Player changing positions
- `sitting_out` - Player going to bench
- `new_position` - Player in different position

Visual indicators:
- Color-coded circles on field positions
- Previous quarter ghost positions
- Playing count badges per player

### 6. Public Game Sharing
Flow:
1. Coach generates share link (stored in `shareLinks` table)
2. Unique `shareId` created with expiration time
3. Public route: `/public/game/:id` (no authentication required)
4. Parents/players view lineup without login

## Important Development Patterns

### 1. Server-Only Code
- Files suffixed `.server.ts` are never sent to client
- Auth utilities, database queries stay server-side
- Always use `getUser(request)` for protected routes

### 2. Database Queries
Always filter by `coachId` for ownership checks:
```typescript
const players = await db.query.players.findMany({
  where: and(
    eq(players.teamId, parseInt(params.teamId!)),
    eq(players.coachId, user.id) // Ownership check
  ),
});
```

Common patterns:
- Use `eq()`, `and()`, `or()` from `drizzle-orm`
- Use `.limit(1)` for single record queries
- Use `db.query.tableName.findFirst()` or `findMany()`

### 3. Form Submission Pattern
Use `_action` field to differentiate multiple actions in one route:

```typescript
// Client-side with useFetcher
const fetcher = useFetcher();
fetcher.submit(
  { _action: "assignPlayer", playerId, positionNumber },
  { method: "post" }
);

// Server-side action
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const _action = formData.get('_action');

  if (_action === 'assignPlayer') {
    // Handle assignment
  } else if (_action === 'removePlayer') {
    // Handle removal
  }

  return data({ success: true });
}
```

### 4. Type Safety
- Route types auto-generated with `react-router typegen`
- Drizzle infers types from schema: `User`, `Player`, `Game`, etc.
- Import route types: `import type { Route } from "./+types/routename"`
- Always run `npm run typecheck` after route or schema changes

### 5. Data Loading Pattern
```typescript
// Server-side (loader)
const players = await db.query.players.findMany({
  where: eq(players.teamId, teamId),
});
return data({ players });

// Client-side (component)
export default function Component({ loaderData }: Route.ComponentProps) {
  const { players } = loaderData;
  // Use players...
}
```

### 6. Image URL Helpers
Always use `getImageUrl()` helper for player images:
```typescript
import { getImageUrl } from '~/utils/image';

// In component
const imageUrl = getImageUrl(player, 'medium'); // 'thumbnail', 'medium', or 'large'
```

### 7. CSS Variables
Use CSS custom properties for theming:
```css
/* Defined in /app/app.css */
var(--primary-color)
var(--accent-color)
var(--background)
var(--text-color)
```

## Environment Variables

Required:
```bash
DATABASE_URL=file:./local.db          # SQLite local database
SESSION_SECRET=your-secret-key-here   # Required in production
UPLOADTHING_TOKEN=your-token          # For image uploads
```

Optional:
```bash
TURSO_URL=your-turso-url             # Staging database (Turso)
TURSO_TOKEN=your-turso-token         # Staging database auth
TURSO_PROD_URL=your-prod-url         # Production database (Turso)
TURSO_PROD_TOKEN=your-prod-token     # Production database auth
OPENAI_API_KEY=your-key              # For AI assistant
ANTHROPIC_API_KEY=your-key           # For advanced AI features
```

## Testing & Quality Assurance

### Test User Account
For testing authenticated features:
- **Email**: jake@dubsado.com
- **Password**: Testing123

### No Formal Test Suite
- Currently no Jest/Vitest/Playwright tests in codebase
- Testing done manually with test account
- Opportunity for future test implementation

### Playwright Browser Testing (when using MCP)
When using Playwright for browser testing:
1. **Always close the browser** after completing tasks using `mcp__playwright__browser_close`
2. **Responsive layout testing**: Test mobile (375px), tablet (768px), desktop (1440px) viewports
3. **Layout validation checklist**:
   - Check for text overflow or truncation
   - Verify proper element stacking on mobile
   - Ensure touch targets are min 44x44px
   - Confirm responsive grid layouts adapt correctly
   - Validate navigation menu behavior
   - Test form field layouts and spacing

## Common Issues & Solutions

1. **Route not found**: Check route configuration in `/app/routes.ts` and ensure route file exists
2. **TypeScript errors**: Run `react-router typegen` to generate route types
3. **Env variable not accessible on client**: Client-side vars must be prefixed with `VITE_`
4. **SSR hydration mismatch**: Check for browser-only code in components (use `useEffect` for client-only code)
5. **Authentication errors**: Ensure `SESSION_SECRET` is set in environment
6. **Database errors**: Run `npm run db:push` to sync schema changes
7. **UploadThing errors**: Ensure `UPLOADTHING_TOKEN` is set in environment
8. **Type errors after route changes**: Run `npm run typecheck` to regenerate types

## Deployment

### Docker Support
Multi-stage Dockerfile included for containerized deployment:
```bash
docker build -t ayso-game-day .
docker run -p 3000:3000 ayso-game-day
```

Compatible platforms: AWS ECS, Google Cloud Run, Azure Container Apps, Digital Ocean, Fly.io, Railway

### Build Output
```
build/
├── client/    # Static assets
└── server/    # SSR server code
```

## Quick Reference for Common Tasks

### Adding a new route
1. Add route to `/app/routes.ts`
2. Create route file in `/app/routes/`
3. Export `loader()`, `action()`, and `default` component
4. Run `npm run typecheck` to generate types

### Database schema changes
1. Edit `/app/db/schema.ts`
2. Run `npm run db:push` to apply changes
3. Update seed script if needed (`/app/db/seed.ts`)

### Adding a new formation template
1. Edit `/app/utils/formations.ts`
2. Add formation definition with positions
3. Run `npm run db:seed` to seed database

### Creating protected routes
```typescript
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request); // Auto-redirects if not authenticated
  // ... rest of loader
}
```

### Handling form submissions with multiple actions
```typescript
export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const _action = formData.get('_action');

  switch (_action) {
    case 'create':
      // Handle create
      break;
    case 'update':
      // Handle update
      break;
    case 'delete':
      // Handle delete
      break;
  }

  return data({ success: true });
}
```

## Key Files Reference

| Purpose | File Path |
|---------|-----------|
| Route Config | `/app/routes.ts` |
| Database Schema | `/app/db/schema.ts` |
| Database Client | `/app/db/index.ts` |
| Auth Utils | `/app/utils/auth.server.ts` |
| Session Config | `/app/sessions.server.ts` |
| Formation Data | `/app/utils/formations.ts` |
| Position Changes | `/app/utils/position-changes.ts` |
| Image Helpers | `/app/utils/image.ts` |
| Main Lineup UI | `/app/routes/team.games.game.lineup.tsx` |
| AI Assistant | `/app/components/AIAssistantCoach.tsx` |
| AI API Endpoint | `/app/api/ai-lineup/route.ts` |
| Global Styles | `/app/app.css` |
| Root Layout | `/app/root.tsx` |
| Dashboard Layout | `/app/routes/dashboard.tsx` |

## Git Commit Guidelines

When making commits:
- Do NOT include the Claude Code watermark or "Co-Authored-By: Claude" line
- Write clear, concise commit messages focused on the "why" rather than the "what"
- Use conventional commit style when appropriate (feat:, fix:, docs:, refactor:, etc.)
