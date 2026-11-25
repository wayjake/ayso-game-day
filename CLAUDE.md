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
  - **Local**: SQLite at `data/dev.db` (`DATABASE_URL=file:./data/dev.db`), for quick test data. `data/` is ignored by git and Syncthing (`~/Work/.stignore`), and so are `.claude/worktrees/`. `local.db` is a stale copy, no longer tracked; don't use it.
    - Leave `TURSO_URL`/`TURSO_TOKEN` unset locally. When they're set, both the app and drizzle-kit use them instead, so placeholder values crash the app (`URL_INVALID`) and make drizzle-kit write to a file named after the placeholder.
    - Scripts run with `tsx` (e.g. `npm run db:seed`) don't load `.env`. Prefix them with `DATABASE_URL=file:./data/dev.db` or they write to `local.db`.
    - `npm run db:push` currently fails on this schema: drizzle-kit mishandles the partial unique indexes from 0003 ("no such index") and applies nothing. Apply new migration SQL to `data/dev.db` directly with `sqlite3`.
    - Test logins: `jake@dubsado.com` (coach on team 1, below), `coach@example.com`, and parents `maria`/`chen`/`patel`/`rivera` `@example.com`.
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

10. **passwordResets** - Single-use reset links (only a SHA-256 hash of the token is stored, 60-minute expiry)
   - Fields: id, userId, tokenHash, expiresAt, usedAt, createdAt
   - Emails go through Resend (`app/utils/email.server.ts`); without `RESEND_API_KEY`/`EMAIL_FROM` the link is logged and shown on the page in development only

### Families (parent accounts, practices, RSVPs, messaging, push)
11. **guardians** - Links a parent account to a player (userId, playerId, teamId). Being a parent comes only from these rows, never from `users.role` or `team_members`, so parents never get coach access. A coach can also be a parent.
11b. **Team staff roles** - Coach access comes only from owning the team (`teams.coachId`) or an active `team_members` row. `team_members.role` is the staff role: `coach`, `assistant-coach` or `team-manager` (legacy `owner` rows read as coach; an owner with no row is a coach). All three get the same access; the role is a label shown as `StaffBadge` in messages, Settings and Families (`utils/team-roles.ts`, `getTeamStaff`/`setStaffRole`/`removeFromStaff` in `team-access.server.ts`). Only the owner invites staff (Settings, with a role), gives a parent already on the app a role or takes it away (Families), and changes roles. Game cards print the first coach and the first assistant coach (or a second coach); team managers aren't printed.
12. **parentInvites** - One invite per family email per team (`/join/:code`). Accepting links every player on the team whose contacts use that email, so siblings come together.
13. **practices** - One row per practice; a weekly series is rows sharing `seriesId`.
14. **rsvps** - One answer (yes/no/maybe) per player per event, where `eventType` is `game` or `practice`.
15. **conversations / messages / conversationReads** - A `team` chat per team (all coaches and parents), plus one-to-one `direct` threads: one staff member (`staffUserId`) and one family. Only those two can read a direct thread. Other staff can't, the team owner included, and nothing is shared between staff (no shared inbox). `getConversationAccess` is the single gate; every lookup or insert of a direct thread passes the staff member (`getOrCreateDirectConversation`, `getOrCreateFamilyConversation`). Families start a thread with any staff member from their Messages list (`/family/messages/with/:teamId/:staffId` makes it on first open). When a staff member leaves, they lose the thread and the parent keeps it read-only (`canPost`). Unread = message ids above `lastReadMessageId`.
15a. **messages.parentId / messageReactions** - Tap a message to react (fixed set in `utils/reactions.ts`) or reply. Replies form a one-level thread under the root (`parentId` = root id; replying to a reply re-parents to the root), opened with `?thread=<id>` on the conversation page so pushes can deep-link. Replies notify only people in the thread (root author and repliers) and count as unread only for them; reactions notify the message's author.
16. **pushSubscriptions** - Web Push endpoints, one per browser. Which kinds of push a person gets is per account, in `users.notifyPrefs` (JSON overrides). Categories live in `utils/notify.ts`; `sendPush(userIds, kind, payload)` drops anyone who turned that kind off. `team` (announcements, schedule changes, RSVP reminders) is locked on; `chat`, `replies`, `reactions` and coach-only `dropouts` can be switched off.
15b. **conversations.familyEmail / needsReply** - The family side of a `direct` thread is a parent account, a family email, or both. Families not on the app get email-only threads (no `parentUserId`), one per staff member who wrote to them; `claimFamilyConversation` hands them all to their account when they prove the email (invite or magic link, via `linkFamily`). An announcement's copy and the family's replies go in the sender's own thread, so only the sender sees replies in the tracker and only the sender can send reminders. Inbound email goes to the thread it answers; otherwise to the staff member it was addressed to, then whoever last wrote to that family, then the owner. Sorting an email from "Emails to sort" files it into the sorter's thread. A coach's top-level message in a direct thread is emailed to the family only when the coach ticks "Send by email" (`EmailToggle`; it starts ticked for families without push, per `familyDelivery` in `messages.server.ts`). Thread replies are never emailed. `needsReply` is set when the family writes and cleared when the thread's staff member replies or marks it done. `messages.senderId` is null for an email reply from a family with no account (`source = 'email'`, `senderEmail`/`senderName` set).
17. **loginLinks** - Email sign-in links for families (`/user/magic-link`). Keyed by email, not user: any email on a player's contacts (or already linked to a player) can ask for one, and using it creates a parent account if needed and links every player whose contacts list that email. Hashed token, single use, 20 minutes. Opening the link shows a button and only the POST signs in, so mail scanners can't burn it. Needs Resend in production; there's no fallback. The same email has a 6-digit code (`codeHash`, hashed with the email) for the Home Screen app, since links in Mail always open in the browser: `/user/magic-link?step=code`. Five wrong codes burn the link. Either way, parents land on `/family?install=1`, which opens the Add to Home Screen sheet on phones not already in the installed app.

### Announcements and email replies
18. **announcements / announcementRecipients** - An email blast. Each family gets its own email (from the coach's address) plus a copy in their private thread; one recipient row per family tracks sent/delivered/opened/bounced/replied/"Got it" (`/ack/:token`, POST-only). `emailMessageId` holds every RFC Message-ID sent to them (announcement and reminders), space-separated.
19. **inboundEmails** - Every email received on the domain, kept whole. Matched to a family by In-Reply-To/References first, then by sender address only if SPF/DKIM/DMARC passed (so a spoofed parent can't post into a thread); the rest wait in "Emails to sort" on the Messages page. Auto-replies never mark a family as replied. Inbound HTML is never rendered.
20. **familyNotes** - Coach-only notes per family email per team. Never loaded by anything a parent can reach.

### Team feed (photos and videos)
21. **posts / postMedia / postLikes / postComments / postUploads** - A photo and video feed per team, ported from disney-social's posting UX (no geotagging). Team staff and parents on the team can post, like and comment; only they can see it. Coaches can delete any post or comment, everyone their own. Comments are flat and carry a browser `clientId` so retries don't duplicate. Files upload the moment they're picked (UploadThing route `feedMedia`, input `{ teamId }`, checked with `feedRole`) and wait in `postUploads` as drafts; "Post" (`POST /api/feed`, `intent: publish`) turns the caller's drafts for that team into one post. Drafts older than a day are swept, files and all. The browser also uploads a 1280px and a 400px JPEG of each file (`utils/media-derivatives.client.ts`; for video, the frame at 3 s is the poster). **Files are public UploadThing URLs** (decided 2026-11-24, not the private-ACL plan): access control is on the pages and APIs, which always check the viewer against the post's own team. Deleting a post deletes its files. Pages and polling page by post id, never `created_at`. Helpers: `utils/feed.server.ts`, `utils/feed.ts` (shared types, `postPath`, `sendPostAction`), `hooks/useTeamFeed.ts`, `components/feed/*`. Realtime: a `changed` event on `team:<teamId>:feed` after posts, likes, comments and deletes (parents' token gets that channel; coaches have `team:<id>:*`). Push: `posts` (new posts, off by default) and `comments` (on your posts).

Flow: Resend sends and receives for the whole domain (one MX record on the root). `app/routes/api.email-webhook.ts` takes every `email.*` event (Svix-signed; set `RESEND_WEBHOOK_SECRET`). Helpers: `utils/announcements.server.ts`, `utils/inbound-email.server.ts`, `utils/email-reply.ts` (pure: quote stripping, header parsing, auto-reply detection), `utils/email.server.ts`. Outside production (and on Vercel preview deploys) every family email is redirected to the sending coach unless `EMAIL_DELIVER_TO_FAMILIES=true`. Only `admin` users can set `users.sendingEmail` (their own address on the sending domain, unique per account); everyone else sends from `EMAIL_FROM` with their own display name. Opens show only if open tracking is on for the domain in Resend; leave click tracking off (it rewrites magic links).

Tours: `utils/tours.ts` defines them, `components/Tour.tsx` runs them and the Help sheet (the ? in the team header). Steps point at `data-tour="..."` attributes. Finished/dismissed tours are saved per account in `users.toursSeen`; bump a tour's `version` to show it again.

Server helpers: `utils/family.server.ts` (parent access), `parent-invites.server.ts`, `magic-link.server.ts`, `schedule.server.ts` (games and practices as one event list, RSVPs, `notifyFamilies`), `messages.server.ts`, `push.server.ts`. Push is sent inline from actions (awaited) and is a no-op without the VAPID env vars. Realtime goes through Ably (`utils/realtime.server.ts`, `hooks/useConversationRealtime.ts`): after each message or reaction the server publishes a `changed` event on the conversation's channel (`team:<teamId>:conversation:<id>` for the team chat, `dm:<id>` for a direct thread, from `conversationChannel(conversation)`) and open threads reload; typing uses Ably presence. Direct threads stay outside `team:<id>:*`, which every staff member's token covers; each token lists only that person's own `dm:` channels. `/api/realtime/token` gives each person a 1-hour token for only the channels they can read. The account is billed per monthly active user, so it must use `@ably/pubsub-server` and `@ably/pubsub-device`; the old `ably` package is refused. Without `ABLY_API_KEY` pages poll instead. `public/sw.js` handles push only and caches nothing. In the family app, `usePush` (in `routes/family.tsx`, shared through `useFamily()`) drives the header bell (`NotificationsMenu`), the Settings page, and the one-time `NotifyPrompt`. `public/manifest.webmanifest` makes it installable, which iOS requires for push.

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
/user/forgot-password - Request a reset link
/user/reset-password/:token - Choose a new password (signs you in)
/user/magic-link - Families: email me a sign-in link (no password)
/user/magic-link/:token - Confirm and sign in (creates the parent account on first use)
/api/uploadthing - File upload handler
/api/ai-lineup - AI lineup generation
/public/game/:id - Public game view (no auth)
/dashboard/team/:teamId/games/:gameId/game-day - Sideline view, full screen outside the dashboard layout
/join/:code - Parent invite: sign up or log in, linked to their kids
/ack/:token - "Got it" from an announcement email (POST to confirm)
/api/email/webhook - Resend events and received email
/api/tours - Save finished/dismissed tours
/api/feed - JSON: feed pages and polling (?team=<id> or ?scope=family), publish and discard uploads
/api/feed/posts/:postId - JSON: like, comment, delete a comment, delete the post
/api/push - JSON: subscribe, unsubscribe, test push
/family - Family app (parents): schedule with RSVPs
  /family/messages - Team chat + private thread with the coaches
  /family/messages/with/:teamId/:staffId - Opens (or starts) the private thread with one staff member
  /family/messages/:conversationId - Thread
  /family/feed - Team photo and video feed (every team the parent has kids on)
  /family/feed/:postId - One post with likes and comments
  /family/settings - Notifications, linked players, name

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
    /dashboard/team/:teamId/families - Invite parents, see who has joined
    /dashboard/team/:teamId/practices/new - One practice or a weekly series
    /dashboard/team/:teamId/practices/:practiceId/edit - Edit, cancel, delete (one or rest of series)
    /dashboard/team/:teamId/rsvps/:eventType/:eventId - Who's coming; answer for a family; remind non-responders
    /dashboard/team/:teamId/messages - Team chat and family threads
    /dashboard/team/:teamId/messages/:conversationId - Thread (notes, mark done; replies email families not on the app)
    /dashboard/team/:teamId/announcements - Announcements list
    /dashboard/team/:teamId/announcements/new - Compose: audience, ask for nothing / "Got it" / a reply, send a test
    /dashboard/team/:teamId/announcements/:announcementId - Tracker with filters; ?family=<email> opens the family panel
    /dashboard/team/:teamId/feed - Team photo and video feed (coach view)
    /dashboard/team/:teamId/feed/:postId - One post; coaches can delete any post or comment
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
  - 11v11: 4-4-2, 4-3-3, 3-5-2, 4-1-4-1, 4-2-3-1, 4-3-2-1, 5-3-2, 3-2-4-1 (default)
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
DATABASE_URL=file:./data/dev.db       # SQLite local database
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
VAPID_PUBLIC_KEY=...                 # Web Push. Generate with `npx web-push generate-vapid-keys`
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
APP_URL=https://your-domain          # Origin used in invite links
RESEND_API_KEY / EMAIL_FROM          # Without them, invites fall back to copyable links
RESEND_WEBHOOK_SECRET=whsec_...      # Signing secret of the Resend webhook pointed at /api/email/webhook
EMAIL_DELIVER_TO_FAMILIES=true       # Outside production only: actually email families instead of the coach
ABLY_API_KEY=...                     # Realtime chat. The key needs Publish, Subscribe and Presence
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
1. Edit `/app/utils/formations.ts` and add the formation at the **end** of its format's set
2. Each quarter's formation is saved in `game.notes` as an index into that set, so inserting or reordering shifts every saved lineup's formation
3. To make it the default, set it in `defaultFormationKeys` (read via `getDefaultFormationIndex()`)

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
| Game Day (sideline) | `/app/routes/game-day.tsx` |
| Shared UI primitives | `/app/components/ui.tsx` (Page, PageHeader, Card, Badge, buttonClass, ...) |
| Field + quarter tabs | `/app/components/LineupField.tsx` |
| Per-quarter lineup plans | `/app/utils/lineup.ts` (read-only views) and `lineup.server.ts` |
| Family app (parents) | `/app/routes/family*.tsx` |
| Chat thread UI | `/app/components/MessageThread.tsx` |
| Announcements + tracker | `/app/routes/team.announcements*.tsx`, `/app/utils/announcements.server.ts` |
| Email replies (inbound) | `/app/utils/inbound-email.server.ts`, `/app/utils/email-reply.ts` |
| Tours + Help | `/app/utils/tours.ts`, `/app/components/Tour.tsx` |
| Team feed | `/app/utils/feed.server.ts`, `/app/components/feed/*`, `/app/routes/*feed*.tsx` |
| Roster CSV import MCP | `/mcp/roster-import.ts` (registered in `.mcp.json`, targets prod by default) |
| AI Assistant | `/app/components/AIAssistantCoach.tsx` |
| AI API Endpoint | `/app/api/ai-lineup/route.ts` |
| Global Styles | `/app/app.css` |
| Root Layout | `/app/root.tsx` |
| Dashboard Layout | `/app/routes/dashboard.tsx` |

## Worktrees for feature work

Do feature development in a git worktree, never in the main checkout, so several Claude Code sessions can work at once without touching each other's files.

- At the start of a feature session, create a worktree on a new branch (`EnterWorktree`, or `git worktree add .claude/worktrees/<name> -b <branch>`). Quick questions, reviews, and one-line fixes the user asks for in place don't need one.
- A new worktree has no `node_modules`, `.env`, or `data/`. Run `npm install`, and copy `.env` and `data/dev.db` from the main checkout (copy the db, don't symlink it, so two sessions never write the same SQLite file).
- Each worktree runs its own dev server, which overrides the general "don't run `npm run dev`" rule. The user's server runs from the main checkout on 5173. Start the worktree's server in the background on the first free port from 5174 up, with `npm run dev -- --port <n> --strictPort`, so every tree keeps its own port. Keep it running for the whole session and tell the user the URL. Cookies are per host, not per port, so a session signed in on 5173 is signed in here too.
- When the work is done, commit on the worktree's branch and tell the user the branch name. Don't merge into `preview`/`main` unless asked.
- **Once the branch is merged and pushed, clean up straight away:**
  1. Stop every background task the session started for it: the worktree's dev server and anything else still running (stop the task, or kill whatever listens on its port).
  2. Remove the worktree with `git worktree remove .claude/worktrees/<name>`. That deletes its files, including its `node_modules`, `.env` and `data/dev.db` copies.
  3. Delete the merged branch with `git branch -d <branch>`, and its remote copy with `git push origin --delete <branch>` if it was pushed.
  4. Only clean up what this session created. Leave other sessions' worktrees and dev servers alone.
  5. If either one refuses (the worktree has uncommitted or untracked changes, or the branch isn't merged), stop and tell the user. Don't use `--force` or `-D`.

### After every push, update the local checkout

Any time Claude pushes (a merge to `preview` or `main`, or a feature branch), bring the main checkout up to date straight after. The user's dev server on 5173 runs from it.

1. In the main checkout, run `git fetch origin`, then `git pull --ff-only` on its current branch. If that branch is the one just pushed and it can't fast-forward, stop and tell the user. Don't reset or force anything.
2. If the pushed changes touch `package.json`, run `npm install` there. If they add migrations, check they're applied to `data/dev.db` (see below).
3. For worktrees still in use, tell the user if their branches are now behind. Only rebase or merge them when asked.
4. Report the result: the branch, and the old and new commit.

### Migrations and production data

- **Run migrations without asking once a feature is ready**, meaning it typechecks and has been checked in the app. Do these three steps:
  1. Generate the migration with `npm run db:generate -- --name <name>`.
  2. Apply its SQL with `sqlite3` to both the worktree's `data/dev.db` and the main checkout's `data/dev.db`, because `db:push` is broken.
  3. Run `npm run db:prod:migrate`.
- **This only covers additive migrations:** new tables, new nullable or defaulted columns, and new indexes. Anything that drops, renames, or rewrites columns or data needs the user's OK first.
- **Read production data freely when it helps** (for example to check real data before a change). Use `TURSO_PROD_URL`/`TURSO_PROD_TOKEN` from `.env`, either from a throwaway `tsx` script or `npm run db:prod:studio`.
- **Ask before writing anything to production.** Inserts, updates, deletes and backfills all need a yes first, with what will change and how many rows.

### Vercel config and env vars

Claude owns the Vercel side of a feature: `vercel.json` and the project's environment variables. The project is linked in `.vercel/` (`ayso-game-day`), and the CLI runs with `npx vercel` (it isn't installed globally).

- **When a feature adds an env var**, push it to Vercel as part of finishing the feature. Don't leave it for the user.
  - Use `npx vercel env add <NAME> <environment>` for `production`, `preview`, and `development`, as the var needs.
  - Pipe the value from `.env`, so it never appears in the command line or the chat.
  - Then add it to the env list in this file and to `.env.example`.
- **Keep the three environments consistent.**
  - Run `npx vercel env ls` before shipping, to find vars that are missing from one environment or that the code no longer reads.
  - On Vercel, production and preview both point `TURSO_URL` at the production database (the same one as `TURSO_PROD_URL` in `.env`; checked 2026-11-24). So a preview deploy reads and writes real data. Never give preview a value that would make it send test data there, or send real email or pushes from a test.
- **The CLI needs a login on each machine.** If `npx vercel` stops at a login prompt, ask the user to run `! npx vercel login` rather than waiting on it.
- **Config changes** (`vercel.json`: regions, functions, headers, crons) go in the feature's branch like any other code.
- **Ask first before:**
  - changing or removing a production value that already exists;
  - rotating a key;
  - changing project settings in the dashboard (domains, build settings).
  Adding a missing var doesn't need a yes.
- **Never print secret values.** When reporting, list var names and environments only.

## Git Commit Guidelines

When making commits:
- Do NOT include the Claude Code watermark or "Co-Authored-By: Claude" line
- Write clear, concise commit messages focused on the "why" rather than the "what"
- Use conventional commit style when appropriate (feat:, fix:, docs:, refactor:, etc.)
