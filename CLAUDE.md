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
- **UploadThing** - Image and video upload and CDN hosting (smaller copies are made in the browser before upload)
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
npm test                 # Unit tests (node --test app/**/*.test.ts), also run on every PR

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
   - `archivedAt`/`archivedBy`: a past season, set by the owner from the team's Settings or, for any of their teams without opening each, the Account page's "Your teams" (`setTeamArchived` in `staff-invites.server.ts`). Archived teams are left out wherever teams are listed for picking (the team switcher via the dashboard loader, the `/dashboard` redirect including the last-team cookie, the main grid on All teams, the Account page's fallback team) using `activeTeams()` from `team-access.server.ts` alongside `canAccessTeam`. They still open and work everywhere else (access checks, messages, the family app); All teams lists them under "Archived teams", and a banner inside says it's archived with Unarchive for the owner.

3. **players** - Player profiles with photos and preferred positions
   - Fields: id, teamId, coachId, name, description, profilePicture, profileImageBase (unused), preferredPositions (JSON array), timestamps
   - `profilePicture` is one 320px square JPEG, made in the browser by `ImageUploader` (`makeSquareJpeg`); photos only ever show as squares of 96px or less. Uploads before 2026-11-25 are 150px PNG thumbnails (or one full original).
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
11b. **Team staff roles** - Coach access comes only from owning the team (`teams.coachId`) or an active `team_members` row. `team_members.role` is the staff role: `coach`, `assistant-coach` or `team-manager` (legacy `owner` rows read as coach; an owner with no row is a coach). All three get the same access; the role is a label shown as `StaffBadge` in messages, Settings and Families (`utils/team-roles.ts`, `getTeamStaff`/`setStaffRole`/`removeFromStaff` in `team-access.server.ts`). Only the owner invites staff, with a role: a team's Settings invites to that team only, the Account page (`/dashboard/account`, "Add to team staff") to any of the teams they own at once; both go through `inviteStaff` in `staff-invites.server.ts` and the `StaffInviteForm` component, gives a parent already on the app a role or takes it away (Families), and changes roles. Game cards print the first coach and the first assistant coach (or a second coach); team managers aren't printed.
11c. **Households** - A "family" in invites, threads, notes and announcements is still one email. The Edit family page (`team.families.edit.tsx`, `getHousehold`/`saveHousehold`/`setGuardianRole` in `family-admin.server.ts`) edits every email whose kids match exactly as one household: add or remove parents, one shared Players list, and (owner only) each parent's team role. A parent not on the app gets a coach invite for the role; accepting a coach invite also links them to their kids (`routes/invite.tsx`). The Families list groups the same households into one row with a line per parent (`groupHouseholds`). "Save and invite" saves, then invites every parent without a working invite. The parent invite email (`parentInviteEmail` in `parent-invites.server.ts`) explains BenchTalk, the team and its staff, and how to add it to an iPhone or Android home screen; like other family mail it goes to the coach outside production.
12. **parentInvites** - One invite per family email per team (`/join/:code`). Accepting links every player on the team whose contacts use that email, so siblings come together.
13. **practices** - One row per practice; a weekly series is rows sharing `seriesId`.
14. **rsvps** - One answer (yes/no/maybe) per player per event, where `eventType` is `game` or `practice`.
15. **conversations / messages / conversationReads** - A `team` chat per team (all coaches and parents), plus one-to-one `direct` threads: one staff member (`staffUserId`) and one family. Only those two can read a direct thread. Other staff can't, the team owner included, and nothing is shared between staff (no shared inbox). `getConversationAccess` is the single gate; every lookup or insert of a direct thread passes the staff member (`getOrCreateDirectConversation`, `getOrCreateFamilyConversation`). Families start a thread with any staff member from their Messages list (`/family/messages/with/:teamId/:staffId` makes it on first open). When a staff member leaves, they lose the thread and the parent keeps it read-only (`canPost`). Unread = message ids above `lastReadMessageId`.
15c. **Group chats (`conversations.kind = 'group'`, `name`, `createdBy`; `conversationMembers`)** - Anyone on the team, staff or parent, starts one from New message (the coach Messages index card, `/family/messages/new`): a searchable picker of staff and families (`PeoplePicker.tsx`, `pickerOptions`/`startConversation` in `utils/groups.server.ts`). One family (as staff) or one staff member (as a parent) still opens the private `direct` thread; anything else, or any pick with a name, is a group, and picking the same people again reopens the same unnamed group. Only members can read a group: no other staff, the team owner included, so a parents-only group is invisible to coaches. A member counts only while still on the team (`activeGroupMemberIds`, `conversationReaderIds`, which every push now goes through). A family not on the app is an email-only member row (`userId` null); `claimFamilyConversation` turns it into their account when they join, and they see the history. Groups are never emailed and have no Needs reply. The organizer (`groupManagerId`: the creator while still in it, otherwise the longest-standing member) renames it and adds or removes people; anyone can leave (`handleGroupAction`, `GroupPanel.tsx`). Realtime channel is `dm:<id>`, like direct threads. Pickers and member lists never send a family's email to a parent: families are keyed by an HMAC of the email.
15a. **messages.parentId / messageReactions** - Tap a message to react (fixed set in `utils/reactions.ts`) or reply. Replies form a one-level thread under the root (`parentId` = root id; replying to a reply re-parents to the root), opened with `?thread=<id>` on the conversation page so pushes can deep-link. Replies notify only people in the thread (root author and repliers) and count as unread only for them; reactions notify the message's author.
15c. **conversationReadMarks (read receipts)** - Telegram style. Your own messages show ✓ once sent and ✓✓ once someone else has read them. Tapping a message shows "Read today at 11:15 AM" in a direct thread (your own messages only), or "Seen by N" with each person and time in a group or the team chat (any message, for everyone in it). `conversationReads` holds each person's latest marker; `markRead` returns whether it moved and logs each move in `conversationReadMarks`, so a message's read time is the first mark at or past it (reads from before the table existed show "Read" with no time). `getReadReceipts` (`utils/read-receipts.server.ts`) sends one summary per conversation and the browser derives each message's readers (`utils/read-receipts.ts`). Only current participants count (direct: its staff member and parent; group: members with an account; team chat: staff and guardians), since old read rows can outlive access. Thread replies show no receipts (opening a conversation marks its replies read too). Loading a thread marks it read, so `MessageThread` doesn't reload on realtime events while the tab is hidden; it catches up when it's visible again. `markConversationRead` publishes a `read` event in direct threads and groups only when the marker moved (never in the team chat, where polling covers it).
16. **pushSubscriptions** - Web Push endpoints, one per browser. Which kinds of push a person gets is per account, in `users.notifyPrefs` (JSON overrides). Categories live in `utils/notify.ts`; `sendPush(userIds, kind, payload)` drops anyone who turned that kind off. `team` (announcements, schedule changes, RSVP reminders) is locked on; `chat`, `replies`, `reactions` and coach-only `dropouts` and `payments` can be switched off.
15b. **conversations.familyEmail / needsReply** - The family side of a `direct` thread is a parent account, a family email, or both. Families not on the app get email-only threads (no `parentUserId`), one per staff member who wrote to them; `claimFamilyConversation` hands them all to their account when they prove the email (invite or magic link, via `linkFamily`). An announcement to every family is posted once in the team chat; replies to it (email replies too, matched by headers or a "Re:" subject) go in the public thread under it, while auto-replies and fresh emails stay private. An announcement to some families puts a copy in each one's thread with the sender, so only the sender sees those replies in the tracker. Only the sender sends reminders. Inbound email goes to the thread it answers; otherwise to the staff member it was addressed to, then whoever last wrote to that family, then the owner. Sorting an email from "Emails to sort" files it into the sorter's thread. A coach's top-level message in a direct thread is emailed to the family only when the coach ticks "Send by email" (`EmailToggle`; it starts ticked for families without push, per `familyDelivery` in `messages.server.ts`). Thread replies are never emailed. `needsReply` is set when the family writes and cleared when the thread's staff member replies or marks it done. `messages.senderId` is null for an email reply from a family with no account (`source = 'email'`, `senderEmail`/`senderName` set).
17. **loginLinks** - Email sign-in links for families (`/user/magic-link`). Keyed by email, not user: any email on a player's contacts (or already linked to a player) can ask for one, and using it creates a parent account if needed and links every player whose contacts list that email. Hashed token, single use, 20 minutes. Opening the link shows a button and only the POST signs in, so mail scanners can't burn it. Needs Resend in production; there's no fallback. The same email has a 6-digit code (`codeHash`, hashed with the email) for the Home Screen app, since links in Mail always open in the browser: `/user/magic-link?step=code`. Five wrong codes burn the link. Either way, parents land on `/family?install=1`, which opens the Add to Home Screen sheet on phones not already in the installed app.

### Announcements and email replies
18. **announcements / announcementRecipients** - An email blast. Each family gets its own email (from the coach's address) plus a copy in the app: one message in the team chat when it goes to every family, otherwise a copy in each family's private thread with the sender (`conversationId`/`messageId` point at it; in the team chat every row shares one message, and "Got it" there is matched to the tapping parent's family); one recipient row per family tracks sent/delivered/opened/bounced/replied/"Got it" (`/ack/:token`, POST-only). `emailMessageId` holds every RFC Message-ID sent to them (announcement and reminders), space-separated.
19. **inboundEmails** - Every email received on the domain, kept whole. Matched to a family by In-Reply-To/References first, then by sender address only if SPF/DKIM/DMARC passed (so a spoofed parent can't post into a thread); the rest wait in "Emails to sort" on the Messages page. Auto-replies never mark a family as replied. Inbound HTML is never rendered.
20. **familyNotes** - Coach-only notes per family email per team. Never loaded by anything a parent can reach.

### Team feed (photos and videos)
21. **posts / postMedia / postLikes / postComments / postUploads** - A photo and video feed per team, ported from disney-social's posting UX (no geotagging). Team staff and parents on the team can post, like and comment; only they can see it. Coaches can delete any post or comment, everyone their own. Comments are flat and carry a browser `clientId` so retries don't duplicate. Files upload the moment they're picked (UploadThing route `feedMedia`, input `{ teamId }`, checked with `feedRole`) and wait in `postUploads` as drafts; "Post" (`POST /api/feed`, `intent: publish`) turns the caller's drafts for that team into one post. Drafts older than a day are swept, files and all. The browser also uploads a 1280px and a 400px JPEG of each file (`utils/media-derivatives.client.ts`; for video, the frame at 3 s is the poster). **Files are public UploadThing URLs** (decided 2026-11-24, not the private-ACL plan): access control is on the pages and APIs, which always check the viewer against the post's own team. Deleting a post deletes its files. Pages and polling page by post id, never `created_at`. Helpers: `utils/feed.server.ts`, `utils/feed.ts` (shared types, `postPath`, `sendPostAction`), `hooks/useTeamFeed.ts`, `components/feed/*`. Realtime: a `changed` event on `team:<teamId>:feed` after posts, likes, comments and deletes (parents' token gets that channel; coaches have `team:<id>:*`). Push: `posts` (new posts, off by default) and `comments` (on your posts).
22. **tasks / taskAssignments** - Things families need to do ("Pay the $85 uniform fee", "Sign the code of conduct"): free text, optional details, link and due date. Any staff role manages them (Roster > Tasks). One assignment row per task per player. `assignAll` tasks also cover players added later (rows are backfilled on read by `ensureAssignments`; taking a player off turns the task into a picked-players one). Two checkmarks per row: the family's (`familyDoneAt/By/Via`: `app`, `link`, `coach`, `import`) and the coach's (`confirmedAt/By`). Confirming fills in the family side too (`via = 'coach'`), and taking it back clears that. Families can only undo their own unconfirmed check. `coachConfirms` tasks count as done only once confirmed; otherwise the family's check is enough. `perFamily` tasks fan a check out to siblings: players listed under the same contact email (one hop). `note` is coach-only and never loaded on a family page. The rules live in `utils/tasks.core.ts`, which takes `db` as an argument and uses relative imports so the MCP server can run the same code. Families see a To do card on `/family`; families not on the app get `/todo/:token` (no login, POST to check off), a signed per-family-per-team link (HMAC of team and email with `SESSION_SECRET`, nothing stored, so it can't be revoked one at a time). Nothing is sent when a task is made: the Message button on the Tasks page opens the family's thread with their open tasks drafted in the box (`?draft=tasks`, built in the thread loader), for the coach to edit and send. Removing a player deletes their assignments.

23. **calendarFeeds** - One private calendar link per person (`/cal/<token>.ics`), shown on the coach Account page and family Settings (`CalendarCard`). The token is stored as is (Settings shows the link again) and Reset link replaces it. The feed is every game and practice from 60 days back on every team the person coaches or has kids on, worked out on each fetch, built only through `getEvents` so coach-only game notes never go out. Games have no end time, so they run 60/75/90 minutes by format; cancelled events stay in with `STATUS:CANCELLED` and "Cancelled:" in the title. Links come from `APP_URL`, so on a preview deploy they point at production. Helpers: `utils/calendar-feed.server.ts`, `utils/ical.ts` (pure iCalendar writer).

24. **ledgerItems / ledgerFunds / ledgerTxns / ledgerEntries / ledgerClaims (Money)** - What families and staff owe for ref fees, tournaments, lodging and travel, and what's been paid and passed on (Roster > Money). Personal Venmo only for now (decided 2026-11-26): families paying by credit card pay Venmo's 3% themselves, so there's no surcharge logic. Any staff role handles money. **Double entry**: every transaction (`ledgerTxns`) has entries (`ledgerEntries`) that add up to exactly zero, in whole cents; nothing is ever edited or deleted, a mistake is undone with a reversal (`reversesId`, unique), and balances are always summed from the entries. Accounts: one per player (their family), per staff member (their own share, or money they fronted, which the team then owes them), per line item (`ledgerItems`, optionally `refundable`), per fund (`ledgerFunds`: "Team fund" is made on first visit, more like "Savings" can be added, each `visibleToFamilies` by default), and one team cash account (money received, less money passed on). Kinds: `charge`, `payment`, `cover` (a fund pays someone's charge), `donation`, `transfer`, `expense` (passed on for an item or spent from a fund, from team cash or fronted by staff), `reimburse`, `credit` (refundable items only: money back to families), `refund`, `vendor_refund`, `reversal`. The rules are pure and unit tested in `utils/ledger.ts` and `utils/money.ts`; `utils/ledger.server.ts` is the only writer, and every write goes through `postTxn`, which checks the lines balance, refuses to overdraw team cash or a fund (reversals excepted), and takes a per-form `clientKey` (unique per team) so a double submit posts once. Payments pay off a member's charges oldest first; a family payment spreads over the kids picked (in full, or in proportion when short); anything over stays as credit unless the payer chose to donate it. A sibling's credit is never netted against another sibling's debt. Families (`/family/money`) read only the entry rows on their own kids' accounts, the items those point at, and visible funds' balances; a payer's name is shown only to that payer. Their Pay button opens `venmo.com/<handle>?txn=pay&amount=…&note=…&audience=private` (handle in `teams.venmoHandle`, set on the Money page), with a per-family code in the note (`familyRefCode`, HMAC, nothing stored) instead of kids' names, since a Venmo feed can be public. "I sent a payment" makes a `ledgerClaims` row and pushes staff (`payments` kind); nothing posts until staff confirm it with the amount that arrived. A player with any ledger entries can't be removed (the foreign keys also stop it).

Flow: Resend sends and receives for the whole domain (one MX record on the root). `app/routes/api.email-webhook.ts` takes every `email.*` event (Svix-signed; set `RESEND_WEBHOOK_SECRET`). Helpers: `utils/announcements.server.ts`, `utils/inbound-email.server.ts`, `utils/email-reply.ts` (pure: quote stripping, header parsing, auto-reply detection), `utils/email.server.ts`. Outside production (and on Vercel preview deploys) every family email is redirected to the sending coach unless `EMAIL_DELIVER_TO_FAMILIES=true`. Only `admin` users can set `users.sendingEmail` (their own address on the sending domain, unique per account); everyone else sends from `EMAIL_FROM` with their own display name. Opens show only if open tracking is on for the domain in Resend; leave click tracking off (it rewrites magic links).

Phone app feel (the installed PWA): iOS fills the status bar strip with the root background, so `html` is white and every page paints its own `bg-canvas`; a page whose top is grey rather than a white bar adds `canvas-top` to its wrapper. Anything pinned to the top pads or offsets by `var(--safe-top)`. Full-width containers pad sideways with `px-safe` (1rem, 1.5rem from sm, or the landscape notch inset when bigger), never a plain `px-4 sm:px-6`, and a bar that spans its padded container uses `bleed-x`; the body itself isn't inset, so backgrounds reach both edges in landscape. Touch targets are at least 44px on touch screens: `buttonClass` sizes grow there (`pointer-coarse:`), a small hand-made icon button gets `tap` (an invisible 44px hit area), checkboxes are 22px on touch and sit inside their `<label>`. Text is never lighter than `text-subtle` or smaller than 11px. Borders of things you type into or tick use `border-field` (3:1); `line-strong` is for decorative borders. Checkboxes and radios are drawn in app.css, so `accent-*` does nothing. An already-positioned small control gets `tap-area` instead of `tap`. On iPhone and iPad the root font follows the Text Size setting (Dynamic Type, 17px at the default), so every rem scales: a single-column grid on phones needs `grid-cols-1` (an implicit column grows to its widest content and pushes the page off screen), and button labels wrap instead of overflowing. Page transitions are View Transitions: spread `navMotion("tab" | "push" | "back")` from `utils/nav-motion.ts` onto a `Link`/`NavLink` (or call `setNavMotion` before `navigate`); browser back and the iOS edge swipe deliberately animate nothing. Switching tabs in either layout also shows `TabTransition` (`components/TabTransition.tsx`): while the next tab's page loads, an outline of it turns in over the old page, then the tab View Transition cross-fades it into the real page. It's a fixed layer under the bars, driven only by `useNavigation()`; each layout lists its tabs with a skeleton kind and the page's container classes, so add a tab there too. `PullToRefresh` sits in the family and dashboard layouts (installed app only); mark an area `data-no-pull` where a downward drag means something else. `haptic()` (`utils/haptics.ts`) gives a light tap from a tap handler. The installed app's launch images (what iOS shows while the first page loads) are one PNG per iPhone screen in `public/launch/`, built by `sh scripts/launch-images/build.sh` with headless Chrome and linked from `utils/launch-images.ts`; the two screen lists must match. None of the iOS-only parts can be checked in desktop Chrome: test on a phone, after deleting and re-adding the Home Screen app.

Account menu: the avatar at the top right of both layouts (`AccountMenu.tsx`) opens account settings (`/dashboard/account` or `/family/settings`), the coach/family switch, and Log out. Avatars are `PersonAvatar` (`components/PersonAvatar.tsx`): initials on a gradient seeded by user id, or a photo when given `avatarUrl` (users have no photo column yet). Settings that belong to the person, not a team, live in `components/AccountSettings.tsx` with one action helper, `accountAction` (`utils/account.server.ts`); team Settings keeps only team details and staff.

Tours: `utils/tours.ts` defines them, `components/Tour.tsx` runs them and the Help sheet (the ? in the coach top bar, left of the bell, shown on a team's pages). `TourProvider` sits in `routes/dashboard.tsx` so the ? can live in its top bar; off a team's pages its teamId is null and the ? hides. Steps point at `data-tour="..."` attributes. Finished/dismissed tours are saved per account in `users.toursSeen`; bump a tour's `version` to show it again.

Server helpers: `utils/family.server.ts` (parent access), `parent-invites.server.ts`, `magic-link.server.ts`, `schedule.server.ts` (games and practices as one event list, RSVPs, `notifyFamilies`), `messages.server.ts`, `push.server.ts`. Push is sent inline from actions (awaited) and is a no-op without the VAPID env vars. Realtime goes through Ably (`utils/realtime.server.ts`, `hooks/useConversationRealtime.ts`): after each message or reaction the server publishes a `changed` event on the conversation's channel (`team:<teamId>:conversation:<id>` for the team chat, `dm:<id>` for a direct thread, from `conversationChannel(conversation)`) and open threads reload; typing uses Ably presence. Direct threads stay outside `team:<id>:*`, which every staff member's token covers; each token lists only that person's own `dm:` channels. `/api/realtime/token` gives each person a 1-hour token for only the channels they can read. The account is billed per monthly active user, so it must use `@ably/pubsub-server` and `@ably/pubsub-device`; the old `ably` package is refused. Without `ABLY_API_KEY` pages poll instead. `public/sw.js` handles push only and caches nothing. Each layout (`routes/dashboard.tsx` for coaches, `routes/family.tsx` for families) owns one `usePush` and shares it through `PushContext` (`hooks/usePushContext.ts`, a React context because `team.tsx` doesn't forward outlet context). It drives the header bell (`NotificationsMenu`), the one-time `NotifyPrompt` and the settings page's `NotificationsCard`. `audience` is `coach` for anyone who coaches, family view included, so they also see coach-only kinds. The kind switches show on the settings pages whatever this device's state, since they're account-wide. `public/manifest.webmanifest` makes it installable, which iOS requires for push.

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
/changelog - What's new, linked from the home page footer. Entries live in `app/utils/changelog.ts`
/dashboard/team/:teamId/games/:gameId/game-day - Sideline view, full screen outside the dashboard layout
/join/:code - Parent invite: sign up or log in, linked to their kids
/ack/:token - "Got it" from an announcement email (POST to confirm)
/todo/:token - A family's tasks without signing in (POST to check one off)
/cal/:file - A person's calendar feed (`<token>.ics`), no sign-in; 404 once reset
/api/email/webhook - Resend events and received email
/api/tours - Save finished/dismissed tours
/api/feed - JSON: feed pages and polling (?team=<id> or ?scope=family), publish and discard uploads
/api/feed/posts/:postId - JSON: like, comment, delete a comment, delete the post
/api/push - JSON: subscribe, unsubscribe, test push
/family - Family app (parents): schedule with RSVPs
  /family/messages - Team chat + private thread with the coaches
  /family/messages/new - New message: a coach (private thread) or several people (group chat)
  /family/messages/with/:teamId/:staffId - Opens (or starts) the private thread with one staff member
  /family/messages/:conversationId - Thread
  /family/feed - Team photo and video feed (every team the parent has kids on)
  /family/feed/:postId - One post with likes and comments
  /family/settings - Notifications, linked players, name
  /family/money - What the family owes, has paid and is owed back; Pay with Venmo; "I sent a payment"

/dashboard - Protected dashboard layout
  /dashboard - Dashboard overview
  /dashboard/teams - Team list
  /dashboard/teams/new - Create team
  /dashboard/account - The coach's own settings on every team: name, notifications, sending address, log out
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
    /dashboard/team/:teamId/messages - Team chat, family threads and group chats; New message starts a private thread or a group
    /dashboard/team/:teamId/messages/:conversationId - Thread (notes, mark done; replies email families not on the app)
    /dashboard/team/:teamId/announcements - Announcements, in the same workspace as Messages: the list on the left from lg, with the open announcement or the compose form beside it (layout route, like team.messages.tsx)
    /dashboard/team/:teamId/announcements/new - Compose: audience, ask for nothing / "Got it" / a reply, send a test
    /dashboard/team/:teamId/announcements/:announcementId - Tracker with filters; ?family=<email> opens the family panel
    /dashboard/team/:teamId/feed - Team photo and video feed (coach view)
    /dashboard/team/:teamId/feed/:postId - One post; coaches can delete any post or comment
    /dashboard/team/:teamId/tasks - Tasks: a card per task and a players x tasks grid by family; tap a mark to confirm; Message drafts a family's open tasks
    /dashboard/team/:teamId/tasks/new - New task: text, link, due date, per family, coach confirms, everyone or picked players
    /dashboard/team/:teamId/tasks/:taskId - One task: filters, bulk confirm / take back / remove, coach notes, add players, delete
    /dashboard/team/:teamId/tasks/:taskId/edit - Edit a task
    /dashboard/team/:teamId/money - Money: totals, payments to confirm, charges, funds, people, recent activity; the Venmo handle
    /dashboard/team/:teamId/money/items/new - New charge: what it's for, refundable, who pays, an amount each or a total split to the cent
    /dashboard/team/:teamId/money/items/:itemId - One charge: who's paid; pass money on, cover from a fund, money came back, give money back, charge more people
    /dashboard/team/:teamId/money/funds - Funds: money in, spend, move between funds, new fund, family visibility
    /dashboard/team/:teamId/money/:memberType/:memberId - One player's family (player) or staff member (staff): what each charge comes to, history with Undo, record a payment, pay back, donate credit
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
- **Sizes are made in the browser before upload** (`utils/media-derivatives.client.ts`, shared with the feed, same as disney-social): player photos are one 320px square JPEG (`makeSquareJpeg`); feed photos get a 1280px and a 400px JPEG, and feed videos a poster from their first frame, shown with `preload="none"` so nothing of the video loads until play. Videos themselves are never re-encoded (decided 2026-11-25). UploadThing URLs are random per file, so sizes can't be found by name: store each URL you need.

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
const imageUrl = getImageUrl(player.profilePicture);
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

### Unit tests
- `npm test` runs `node --test 'app/**/*.test.ts'` with Node's own type stripping, no installs needed. A GitHub Action (`.github/workflows/test.yml`) runs it on every pull request and on pushes to `preview` and `main`.
- They cover the money rules: `utils/money.test.ts` (cents parsing, rounding, splits that always add up) and `utils/ledger.test.ts` (double entry, overdraft, reversals, statements, plus randomized invariant checks). Run one file with `node --test app/utils/ledger.test.ts`.
- A tested module must be pure: no `~/` imports, no npm imports, no enums or other non-erasable TypeScript, and it imports its siblings with the `.ts` extension (`allowImportingTsExtensions` is on).
- Everything else is still tested by hand with the test account.

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
| Money (ledger) | `/app/utils/money.ts` and `ledger.ts` (pure rules, unit tested), `ledger.server.ts` (the only writer: `postTxn`), `ledger-forms.server.ts`, `/app/components/money.tsx`, `/app/routes/team.money*.tsx`, `family.money.tsx` |
| Tasks | `/app/utils/tasks.core.ts` (rules, shared with the MCP), `tasks.server.ts` (views, draft, `/todo` token), `tasks.ts`, `/app/components/tasks.tsx`, `FamilyTodo.tsx`, `/app/routes/team.tasks*.tsx`, `todo.tsx` |
| Roster import and tasks MCP | `/mcp/roster-import.ts` (registered in `.mcp.json`, targets prod by default): `list_teams`, `import_roster_csv`, `list_tasks`, `create_task`, `set_task_status`. Writes default to `dry_run`; test with `--db=file:<copy of dev.db>` |
| AI Assistant | `/app/components/AIAssistantCoach.tsx` |
| AI API Endpoint | `/app/api/ai-lineup/route.ts` |
| Global Styles | `/app/app.css` |
| Root Layout | `/app/root.tsx` |
| Dashboard Layout | `/app/routes/dashboard.tsx` |

## Worktrees for feature work

Do feature development in a git worktree, never in the main checkout, so several Claude Code sessions can work at once without touching each other's files.

- At the start of a feature session, create a worktree on a new branch (`EnterWorktree`, or `git worktree add .claude/worktrees/<name> -b <branch>`). Quick questions, reviews, and one-line fixes the user asks for in place don't need one.
- Right after creating it, say what it's for in one line: `git config branch.<branch>.description "Tasks for families"`. Other sessions see that line in the status below.
- **Worktree status:** `npm run trees` (`scripts/trees.ts`, plain Node, works before `npm install`) lists every tree with its purpose, how far it is from `preview`, uncommitted changes, its dev server port, the migrations it adds, clashing migration numbers and the next free one. It's worked out from git and running processes each time, so there's no list to keep up to date. A SessionStart hook (`.claude/settings.json`) prints the short form (`--brief`) to every session, so read it before picking a port or generating a migration.
- Trees listed "on your other machine" belong to the other computer: Syncthing syncs `.git` (so git knows about them) but not `.claude/worktrees/` (so their folders aren't here). Never `git worktree prune` or remove them from this machine; that breaks them over there.
- A new worktree has no `node_modules`, `.env`, or `data/`. Run `npm install`, and copy `.env` and `data/dev.db` from the main checkout (copy the db, don't symlink it, so two sessions never write the same SQLite file).
- Each worktree runs its own dev server, which overrides the general "don't run `npm run dev`" rule. The user's server runs from the main checkout on 5173. Start the worktree's server in the background on the first free port from 5174 up (the status shows which ports are taken), with `npm run dev -- --port <n> --strictPort`, so every tree keeps its own port. Keep it running for the whole session and tell the user the URL. Cookies are per host, not per port, so a session signed in on 5173 is signed in here too.
- Before `npm run db:generate`, check the next free migration number in the status. drizzle-kit only knows this tree's journal, so if another tree already holds that number, rename the new migration to the next free one (see "Number clashes" below).
- **When a major change is done, ship it to `preview` without waiting for the user to test it.** "Done" means it typechecks and Claude has checked it in the app. Commit on the worktree's branch, then run `npm run trees -- --check` in the worktree. It fetches, then reports whether `preview` moved, whether the merge would conflict (tested in memory, nothing touched), uncommitted changes, migration clashes, and any open `preview` → `main` PR. If `preview` moved, merge `origin/preview` into the branch in the worktree, resolve any conflicts there (never in the main checkout), typecheck, and check again. Once it passes, merge the branch into `preview` in the main checkout (fast-forward or a merge commit, never a force push) and push straight away, before `preview` can move again. Pushing adds this branch to any open `preview` → `main` PR, so finish with the merge command (see "Shipping preview to main"). Then clean up as below. This keeps worktrees and branches from piling up; the user tests on the preview deploy. If the merge conflicts, or the branch needs a migration that isn't additive, stop and ask. Never merge into `main` unless asked.
- Small or unfinished work stays on its branch: commit it and tell the user the branch name.
- **Once the branch is merged and pushed, clean up straight away:**
  1. Stop every background task the session started for it: the worktree's dev server and anything else still running (stop the task, or kill whatever listens on its port).
  2. Remove the worktree with `git worktree remove .claude/worktrees/<name>`. That deletes its files, including its `node_modules`, `.env` and `data/dev.db` copies.
  3. Delete the merged branch with `git branch -d <branch>`, and its remote copy with `git push origin --delete <branch>` if it was pushed.
  4. Only clean up what this session created. Leave other sessions' worktrees and dev servers alone.
  5. If either one refuses (the worktree has uncommitted or untracked changes, or the branch isn't merged), stop and tell the user. Don't use `--force` or `-D`.

### Shipping preview to main

Main goes live through a PR from `preview` to `main`, which the user merges. Before opening it, add a release to the top of `app/utils/changelog.ts` covering everything in `main..preview`, written for coaches and families (what they can do now, not how it was built), and ship that to `preview` first.

**After every push to `preview`, hand the user the merge command for it.** Claude never merges to `main`, but every push to `preview` ends with the command that takes it live:
1. If a `preview` → `main` PR is open, the push just joined it. Otherwise open one, as described above.
2. Make sure the PR's release in `app/utils/changelog.ts` covers everything in `main..preview`, this push included. Push the changelog update to `preview` if it needed one.
3. Check the global merge criteria on the PR's latest commit: CI passes, review comments are answered, and `gh pr view <n> --json mergeable,mergeStateStatus` says it's mergeable.
4. Give the command on its own line, with `!` in front so it runs in the session, and say which checks passed: `! gh pr merge <n> --merge`. If a check fails, say which one and hold the command back.

Merge these PRs with a merge commit, never squash: hand the user `! gh pr merge <n> --merge` (this overrides the global `--squash` default). `preview` is long-lived, and a squash gives `main` a commit `preview` doesn't have, so the next PR conflicts. `git log --first-parent main` shows just the releases. (#4 was squashed; `preview` was reconciled with `git merge -s ours origin/main` after checking `git diff origin/main preview` held only new work.) Feature branches into `preview` can still be squashed.

### After every push, update the local checkout

Any time Claude pushes (a merge to `preview` or `main`, or a feature branch), bring the main checkout up to date straight after. The user's dev server on 5173 runs from it.

1. In the main checkout, run `git fetch origin`, then `git merge --ff-only origin/<branch>` for its current branch. Not `git pull`: sessions share `.git`, so another session's fetch (the SessionStart status runs one) can rewrite `FETCH_HEAD` mid-pull, and the pull fails with "Cannot fast-forward to multiple branches". If that branch is the one just pushed and it can't fast-forward, stop and tell the user. Don't reset or force anything.
2. If the pushed changes touch `package.json`, run `npm install` there. If they add migrations, check they're applied to `data/dev.db` (see below).
3. For worktrees still in use, tell the user if their branches are now behind. Only rebase or merge them when asked.
4. Report the result: the branch, and the old and new commit.

### Migrations and production data

- **Run migrations without asking once a feature is ready**, meaning it typechecks and has been checked in the app. Do these three steps:
  1. Generate the migration with `npm run db:generate -- --name <name>`.
  2. Apply its SQL with `sqlite3` to both the worktree's `data/dev.db` and the main checkout's `data/dev.db`, because `db:push` is broken.
  3. Run `npm run db:prod:migrate`.
- **Number clashes between branches:** two worktrees can each generate the same next number. Drizzle decides what to run on prod by each journal entry's `when` (newer than the last applied `created_at`), not by number or tag, so a migration that's already on prod must keep its `when` and never be regenerated. On a clash, the one not yet on prod moves: rename its SQL and snapshot to the next number and fix `idx`/`tag` in the journal, keeping its SQL and `when`. When merging, keep both journal entries, and afterwards `npm run db:generate` should report no changes (if the two snapshots share a parent, regenerate the later snapshot on top of the earlier one).
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
