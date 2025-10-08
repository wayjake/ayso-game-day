# AYSO Game Day Project

This project is an AYSO (American Youth Soccer Organization) team management application built with React Router v7, Drizzle ORM, and SQLite.

## Project Overview

AYSO Game Day helps coaches manage their teams, plan game rotations, track player assignments, and ensure AYSO fair-play compliance.

### Key Features
- **Team Management**: Create and manage multiple teams
- **Player Management**: Track players with profiles, profile pictures (via UploadThing), and preferred positions
- **Game Planning**: Schedule games and plan formations
- **Lineup Planner**: Drag-and-drop player assignment to positions per quarter
- **Position Change Indicators**: Visual indicators showing when players change positions between quarters
- **Quarter Playing Count**: Badge indicators showing how many quarters each player has played
- **Previous Quarter Hints**: Visual hints showing which positions players played in the previous quarter
- **Public Game View**: Shareable public links for parents/players to view game lineups without authentication
- **AYSO Compliance**: Built-in sit-out tracking for fair play rules
- **Formation Templates**: Pre-configured 7v7, 9v9, and 11v11 formations

## Database Schema

The application uses Drizzle ORM with SQLite and includes these main entities:

### Users
- Authentication and profile information
- Roles: coach, admin, assistant-coach
- Team associations
- Fields: id, email, password (bcrypt hashed), role, teamName, gameFormat, region, timestamps

### Teams
- Team information (name, format, age group, season)
- Linked to coach/user
- Fields: id, name, coachId, format (7v7/9v9/11v11), ageGroup, season, region, timestamps

### Players
- Player profiles with names, descriptions, profile pictures (UploadThing integration)
- Supports multi-size images with `profileImageBase` field
- Preferred positions (stored as JSON array)
- Team associations
- Legacy `profilePicture` field for backward compatibility
- Fields: id, teamId, coachId, name, description, profilePicture, profileImageBase, preferredPositions (JSON), timestamps

### Template Formations
- Pre-configured formations for 7v7, 9v9, and 11v11
- Based on traditional soccer numbering (1-11)
- Includes popular formations like 3-3-2, 4-3-3, etc.
- Positions stored as JSON with x/y coordinates for visual rendering
- Fields: id, name, format, formation, positions (JSON), description, isDefault, createdAt

### Games
- Game scheduling and details
- Formation assignments
- Opponent information
- Game status tracking (scheduled, in-progress, completed, cancelled)
- Fields: id, teamId, formationId, opponent, gameDate, gameTime, field, homeAway, status, notes, timestamps

### Assignments
- Player position assignments per game/quarter
- Traditional soccer position numbering (1-11)
- Quarter-based tracking for AYSO compliance
- Fields: id, gameId, playerId, positionNumber, positionName, quarter, isSittingOut, timestamps

### Positions
- Static reference data for position definitions
- Traditional soccer numbering system
- Categorized by role (goalkeeper, defender, midfielder, forward)
- Format-specific positions (7v7, 9v9, 11v11, or all)
- Fields: id, number, abbreviation, fullName, category, format

### Sit-outs
- AYSO fair-play tracking
- Tracks which players sit out per quarter
- Includes reason for sitting out
- Fields: id, gameId, playerId, quarter, reason, createdAt

### Share Links
- Public shareable links for game lineups
- Expires after set duration
- Allows parents/players to view lineups without authentication
- Tracks creator and associated game/team
- Fields: id, gameId, teamId, shareId (unique), expiresAt, createdBy, createdAt

## Database Setup

```bash
# Install dependencies
npm i drizzle-orm @libsql/client
npm i -D drizzle-kit

# Generate and apply schema
npm run db:push

# Seed with formation templates
npm run db:seed

# Open database GUI
npm run db:studio
```

## Authentication System

The app uses cookie-based sessions with bcrypt for password hashing:

### Session Management (`app/sessions.server.ts`)
```typescript
import { createCookieSessionStorage } from "react-router";

type SessionData = {
  userId: number;
  userEmail: string;
  userRole: 'coach' | 'admin' | 'assistant-coach';
};

const { getSession, commitSession, destroySession } = createCookieSessionStorage({
  cookie: {
    name: "ayso_session",
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 7, // 1 week
    secrets: [process.env.SESSION_SECRET],
    secure: process.env.NODE_ENV === "production",
  },
});
```

### Authentication Utilities (`app/utils/auth.server.ts`)
- `hashPassword()` - bcrypt password hashing
- `createUser()` - User registration with team creation
- `authenticateUser()` - Login validation
- `requireUserId()` - Protected route authentication
- `getUser()` - Current user data fetching

### Route Protection

Protected routes use the dashboard layout which automatically checks authentication:

```typescript
// app/routes/dashboard.tsx
export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request); // Redirects if not authenticated
  return data({ user });
}
```

## Route Structure

Current route configuration (`app/routes.ts`):

```
/ - Homepage (marketing site)
/user/signup - User registration
/user/login - User login
/user/logout - Logout action
/api/uploadthing - UploadThing file upload handler
/public/game/:id - Public game lineup view (no auth required)
/dashboard - Protected dashboard layout
  /dashboard (index) - Dashboard overview with stats
  /dashboard/teams - Team management
  /dashboard/teams/new - Create new team
  /dashboard/team/:teamId - Team layout (nested routes)
    /dashboard/team/:teamId (index) - Team overview/stats
    /dashboard/team/:teamId/roster - View team roster
    /dashboard/team/:teamId/roster/new-player - Add new player
    /dashboard/team/:teamId/roster/player/:playerId/edit - Edit player
    /dashboard/team/:teamId/games - View team games
    /dashboard/team/:teamId/games/new - Create new game
    /dashboard/team/:teamId/games/:gameId/lineup - Game lineup planner
    /dashboard/team/:teamId/rotations - Player rotations overview
    /dashboard/team/:teamId/player/remove - Remove player action
```

## Environment Variables

Required environment variables:
```bash
# Database
DATABASE_URL=file:./local.db

# Session security
SESSION_SECRET=your-secret-key-here

# UploadThing (for player profile images)
UPLOADTHING_TOKEN=your-uploadthing-token
```

## Formation System

The app includes pre-configured formations based on traditional soccer numbering:

### 7v7 Formations
- Support for younger age groups
- Smaller field formations

### 9v9 Formations
1. **3-3-2 Balanced** - Most common AYSO formation
2. **3-2-3 Attack** - More attacking with strong wings
3. **2-4-2 Midfield Control** - Emphasis on midfield dominance

### 11v11 Formations
1. **4-3-3 Classic** - Traditional formation
2. **4-4-2 Traditional** - Classic two-striker system
3. **3-5-2 Wing Play** - Wing-back focused

### Position Numbering
- 1: Goalkeeper
- 2-5: Defenders (RB, LB, CB, CB)
- 6, 8, 10: Midfielders (CDM, CM, CAM)
- 7, 11: Wings (RM/RW, LM/LW)
- 9: Striker/Center Forward

## Lineup Planning Features

The game lineup planner (`/dashboard/team/:teamId/games/:gameId/lineup`) includes:

1. **Drag-and-Drop Interface**: Drag players from the roster to positions on the field
2. **Quarter Management**: Separate lineup for each quarter with quick copy functionality
3. **Position Change Indicators**: Visual circles showing positions where a player's assignment changes between quarters
4. **Playing Count Badges**: Shows how many quarters each player has been assigned
5. **Previous Quarter Hints**: Faded indicators showing where players were positioned in the previous quarter
6. **Formation Selection**: Choose from pre-configured formations or create custom layouts
7. **Public Sharing**: Generate shareable links for parents/players to view the lineup

## Development Commands

```bash
# Start development server
npm run dev

# Database commands
npm run db:push      # Apply schema changes
npm run db:generate  # Create migration files
npm run db:migrate   # Run migrations
npm run db:seed      # Seed initial data
npm run db:studio    # Open Drizzle Studio

# Build for production
npm run build
npm run start
```

## Testing & Quality Assurance

### Test User Account

For testing authenticated features and logged-in views, use the following test account:
- **Email**: jake@dubsado.com
- **Password**: Testing123

This account should be used when testing dashboard features, team management, game planning, and other authenticated functionality.

### Playwright Browser Testing

When using Playwright for browser testing:

1. **Always close the browser**: After completing any Playwright task, always close the browser using `mcp__playwright__browser_close` to free up resources.

2. **Responsive Layout Testing**: When implementing major UI features or making significant layout changes, automatically test the following viewport sizes:
   - **Mobile**: 375px width (iPhone size)
   - **Tablet**: 768px width (iPad size)
   - **Desktop**: 1440px width (standard desktop)

3. **Testing Workflow**:
   ```
   1. Start dev server if needed
   2. Navigate to the page
   3. Test mobile viewport (375px)
   4. Test tablet viewport (768px)
   5. Test desktop viewport (1440px)
   6. Take screenshots for documentation if needed
   7. Close the browser when complete
   ```

4. **Layout Validation Checklist**:
   - Check for text overflow or truncation
   - Verify proper element stacking on mobile
   - Ensure touch targets are appropriately sized (min 44x44px)
   - Confirm responsive grid layouts adapt correctly
   - Validate navigation menu behavior (mobile hamburger, desktop full)
   - Test form field layouts and spacing

## Common Issues

1. **Route not found**: Check route configuration in `routes.ts`
2. **TypeScript errors**: Run `react-router typegen` to generate route types
3. **Env variable not accessible**: Ensure client-side vars are prefixed with `VITE_`
4. **SSR hydration mismatch**: Check for browser-only code in components
5. **Authentication errors**: Ensure SESSION_SECRET is set in environment
6. **Database errors**: Run `npm run db:push` to sync schema changes
7. **UploadThing errors**: Ensure UPLOADTHING_TOKEN is set in environment
