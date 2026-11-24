// Guided tours. Each step points at an element marked data-tour="<target>"
// (or nothing, for a centered card). Steps with a `path` move to that page
// first. Bump a tour's version when its steps change enough that coaches who
// finished it should see it again.

export type TourStep = {
  title: string;
  body: string;
  target?: string;
  path?: (teamId: number) => string;
};

export type Tour = {
  id: string;
  version: number;
  title: string;
  summary: string;
  steps: TourStep[];
};

const team = (teamId: number) => `/dashboard/team/${teamId}`;

export const TOURS: Tour[] = [
  {
    id: "welcome",
    version: 1,
    title: "Getting around",
    summary: "The five team tabs and where everything lives",
    steps: [
      {
        title: "Welcome to AYSO Game Day",
        body: "A quick look around. It takes under a minute, and you can replay it any time from the ? button.",
        path: team,
      },
      {
        title: "Your team tabs",
        body: "Overview, Schedule, Roster, Messages and Settings. Everything for this team is one tap away.",
        target: "team-tabs",
        path: team,
      },
      {
        title: "Schedule and lineups",
        body: "Add games and practices here. Open a game to plan who plays where each quarter, by hand or with the AI assistant coach.",
        target: "tab-schedule",
        path: team,
      },
      {
        title: "Messages",
        body: "Team chat, private threads with each family, and email announcements with replies and read tracking.",
        target: "tab-messages",
        path: team,
      },
      {
        title: "Help is always here",
        body: "Tap ? for these tours and quick answers.",
        target: "help-button",
        path: team,
      },
    ],
  },
  {
    id: "announcements",
    version: 1,
    title: "Announcements and replies",
    summary: "Email every family, then track who read and replied",
    steps: [
      {
        title: "Inbox and Announcements",
        body: "Inbox holds every conversation with families, from the app or by email. Announcements is where you send to everyone at once.",
        target: "messages-tabs",
        path: (id) => `${team(id)}/announcements`,
      },
      {
        title: "Write an announcement",
        body: "Each family gets their own email from your address. When they hit reply, it comes back here, never to the other families.",
        target: "new-announcement",
        path: (id) => `${team(id)}/announcements`,
      },
      {
        title: "Choose who gets it",
        body: "Everyone, only families on the app, only those who aren't, or pick families by hand.",
        target: "announcement-audience",
        path: (id) => `${team(id)}/announcements/new`,
      },
      {
        title: "Ask for something",
        body: "A “Got it” button is the surest sign someone read it. Email opens are only a guess, since many mail apps hide or fake them.",
        target: "announcement-ask",
        path: (id) => `${team(id)}/announcements/new`,
      },
      {
        title: "Track every family",
        body: "After sending, each announcement shows who opened, replied, tapped Got it, or bounced. “Needs you” collects replies to answer and families who haven't responded.",
      },
      {
        title: "Reply and take notes",
        body: "Tap a family to read their reply, answer it (by email if they're not on the app), mark it done, and keep private notes only coaches can see.",
      },
    ],
  },
];

export function getTour(id: string) {
  return TOURS.find((t) => t.id === id) ?? null;
}

export type ToursSeen = Record<string, number>;

export function parseToursSeen(value: string | null | undefined): ToursSeen {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function hasSeen(seen: ToursSeen, tour: Tour) {
  return (seen[tour.id] ?? 0) >= tour.version;
}
