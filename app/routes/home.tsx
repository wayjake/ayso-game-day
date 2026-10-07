import type { Route } from "./+types/home";
import type { ReactNode } from "react";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { AppMark } from "~/components/AppMark";
import { LineupField, type SlotHighlight } from "~/components/LineupField";
import { Badge, Card, buttonClass, cx, inputClass, labelClass } from "~/components/ui";
import { getDefaultFormationIndex, getFormationsByFormat } from "~/utils/formations";
import {
  buildQuarterPlans,
  changesBetween,
  groupChanges,
  positionLabel,
  shortName,
  type SavedAssignment,
} from "~/utils/lineup";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowsLeftRight,
  Camera,
  ChartBar,
  Check,
  DeviceMobile,
  HandTap,
  Play,
  Printer,
  ShareNetwork,
  Sparkle,
  Sun,
  UserPlus,
  UsersThree,
} from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request, false); // Don't redirect if not logged in
  return data({ isLoggedIn: !!user });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AYSO Game Day" },
    {
      name: "description",
      content:
        "Plan fair AYSO lineups for every quarter and run substitutions from your phone on game day. Free for coaches; AI is optional, pay as you go.",
    },
  ];
}

const container = "mx-auto w-full max-w-7xl px-4 sm:px-6";

// ---------------------------------------------------------------------------
// Sample game, run through the same lineup code the app uses. Twelve players,
// a 9v9 field, three on the bench each quarter, everyone plays three quarters.

const demoPlayers = [
  "Maya Chen", "Liam Okafor", "Ethan Brooks", "Zoe Ramirez", "Sofia Patel", "Ava Johnson",
  "Noah Kim", "Tyler Nguyen", "Emma Rossi", "Mia Torres", "Lucas Green", "Aria Shah",
].map((name, i) => ({ id: i + 1, name, jerseyNumber: [1, 4, 5, 2, 7, 8, 11, 9, 10, 6, 3, 12][i] }));

const demoFormation = (() => {
  const formations = getFormationsByFormat("9v9");
  return formations[Object.keys(formations)[getDefaultFormationIndex("9v9")]];
})();

// Like a real coach would: three come off each quarter and the bench steps into
// their spots, so most players keep their position. Plus one swap in Q3.
const demoAssignments: SavedAssignment[] = (() => {
  const positions = demoFormation.positions.map((p) => p.number);
  const field = demoPlayers.slice(0, positions.length).map((p) => p.id); // field[i] plays positions[i]
  let bench = demoPlayers.slice(positions.length).map((p) => p.id);
  const rows: SavedAssignment[] = [];
  for (let quarter = 1; quarter <= 4; quarter++) {
    if (quarter > 1) {
      const spots = [0, 1, 2].map((k) => ((quarter - 2) * 3 + k) % positions.length);
      const comingOff = spots.map((i) => field[i]);
      spots.forEach((i, k) => (field[i] = bench[k]));
      bench = comingOff;
    }
    if (quarter === 3) [field[1], field[2]] = [field[2], field[1]]; // fullbacks switch sides
    field.forEach((playerId, i) => rows.push({ playerId, positionNumber: positions[i], quarter, isSittingOut: false }));
    bench.forEach((playerId) => rows.push({ playerId, positionNumber: 0, quarter, isSittingOut: true }));
  }
  return rows;
})();

const demoPlans = buildQuarterPlans({
  format: "9v9",
  players: demoPlayers,
  assignments: demoAssignments,
  absences: [],
  quarterFormations: {},
});

// Hero shows Q2 with rings on who changed, and what changes going into Q3
const heroPlan = demoPlans[1];
const heroHighlights = new Map<number, SlotHighlight>(
  changesBetween(demoPlans[0], heroPlan).flatMap((change): [number, SlotHighlight][] =>
    change.changeType === "new_in"
      ? [[change.playerId, "in"]]
      : change.changeType === "new_position" || change.changeType === "position_swap"
        ? [[change.playerId, "moved"]]
        : []
  )
);
const nextChanges = groupChanges(changesBetween(heroPlan, demoPlans[2]));

export default function Home({ loaderData }: Route.ComponentProps) {
  const { isLoggedIn } = loaderData;
  const startHref = isLoggedIn ? "/dashboard" : "/user/signup";

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur">
        <nav className={cx(container, "flex h-14 items-center justify-between gap-4")}>
          <a href="/" aria-label="AYSO Game Day home">
            <AppMark />
          </a>
          <ul className="hidden items-center gap-1 md:flex">
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#planning">Planning</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#game-day">Game day</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#pricing">Pricing</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#faq">FAQ</a></li>
          </ul>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <a className={buttonClass({ size: "sm" })} href="/dashboard">Go to your team</a>
            ) : (
              <>
                <a className={buttonClass({ variant: "ghost", size: "sm" })} href="/user/login">Sign in</a>
                <a className={buttonClass({ size: "sm", className: "hidden sm:inline-flex" })} href="/user/signup">Start free</a>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="overflow-hidden">
        <div className={cx(container, "grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16")}>
          <div>
            <p className="text-sm font-semibold text-primary">For AYSO coaches</p>
            <h1 className="mt-3 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
              Fair lineups for every quarter. Calm on the sideline.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Plan who plays where, keep playing time even, and make the fair sub when someone gets hurt, right from your
              phone. Free for volunteer coaches.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={startHref} className={buttonClass({ size: "lg" })}>
                {isLoggedIn ? "Go to your team" : "Start free"}
                <ArrowRight size={18} weight="bold" />
              </a>
              <a href="#game-day" className={buttonClass({ variant: "secondary", size: "lg" })}>
                See game day
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {["Free to use", "7v7, 9v9 and 11v11", "Parents don't need an account"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check size={16} weight="bold" className="text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <GameDayPreview />
        </div>
      </section>

      {/* Why it exists */}
      <section className="border-t border-line bg-surface py-14 sm:py-20">
        <div className={cx(container, "grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16")}>
          <div>
            <SectionLabel>Why we built it</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Less work for volunteer coaches</h2>
          </div>
          <div className="space-y-4 text-lg text-muted">
            <p>
              The hardest moment in a youth game is often the middle of a quarter: a player gets hurt, and you need to
              make a sub while remembering who has played and who hasn't, and keep it fair.
            </p>
            <p>
              AYSO Game Day keeps that count for you. Mark the injury, see who's on the bench and how many quarters each
              player has sat, and make the fair call without the mental math. It's built for the volunteers who give
              their weekends to the game.
            </p>
          </div>
        </div>
      </section>

      {/* Planning */}
      <section id="planning" className="scroll-mt-14 border-t border-line py-16 sm:py-24">
        <div className={cx(container, "grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div className="lg:order-2">
            <SectionLabel>Before the game</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Plan the whole game in one sitting</h2>
            <p className="mt-3 max-w-xl text-lg text-muted">
              Built around how an AYSO game runs: four quarters, a full bench, and everyone gets their time.
            </p>
            <ul className="mt-8 space-y-5">
              <Point icon={<HandTap size={20} />} title="Drag players onto the field">
                Or tap a name and pick a position. Use a different formation each quarter if you like.
              </Point>
              <Point icon={<ChartBar size={20} />} title="See playing time as you go">
                Every player shows how many quarters they've sat, and the fair play summary flags anyone who's short.
              </Point>
              <Point icon={<UserPlus size={20} />} title="Mark who can't make it">
                Absent or injured for one quarter or the rest of the game, and the counts adjust.
              </Point>
              <Point icon={<Printer size={20} />} title="Print the AYSO game card">
                Filled in from your lineup, ready for the referee.
              </Point>
            </ul>
          </div>
          <PlayingTime className="lg:order-1" />
        </div>
      </section>

      {/* Game day */}
      <section id="game-day" className="scroll-mt-14 border-t border-line bg-surface py-16 sm:py-24">
        <div className={cx(container, "grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div>
            <SectionLabel>On the sideline</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">One tap at every whistle</h2>
            <p className="mt-3 max-w-xl text-lg text-muted">
              Game day mode turns your plan into a phone screen made for the sideline: big type, big buttons, and just
              what you need for the next quarter.
            </p>
            <ul className="mt-8 space-y-5">
              <Point icon={<ArrowsLeftRight size={20} />} title="Who's coming on, coming off and switching">
                Read it straight off the screen when the quarter ends.
              </Point>
              <Point icon={<Play size={20} weight="fill" />} title="Start the next quarter with one tap">
                It keeps your place if your phone locks or the page reloads.
              </Point>
              <Point icon={<Sun size={20} />} title="Keep the screen on">
                So it doesn't dim while you're watching the game.
              </Point>
            </ul>
          </div>
          <ChangesPreview />
        </div>
      </section>

      {/* Everything else */}
      <section className="border-t border-line py-16 sm:py-24">
        <div className={container}>
          <h2 className="max-w-2xl font-display text-4xl font-bold tracking-tight">Everything else a volunteer coach needs</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Feature icon={<ShareNetwork size={22} />} title="Share with parents">
              Send a link that opens a view-only lineup on any phone. No account needed, and it expires after a day.
            </Feature>
            <Feature icon={<UsersThree size={22} />} title="Bring your assistant coach">
              Invite them by email. They can plan lineups, manage the roster and edit games with you.
            </Feature>
            <Feature icon={<DeviceMobile size={22} />} title="Works on any phone">
              Nothing to install. It runs in the browser, on a phone or a laptop.
            </Feature>
            <Feature icon={<Sparkle size={22} weight="fill" />} title="AI assistant coach" ai>
              Type or say what you need, like who's out today or who should start in goal, and get a lineup that follows
              fair play rules.
            </Feature>
            <Feature icon={<Camera size={22} />} title="Import your roster" ai>
              Snap a photo of the league roster or upload the file, and the players are added for you.
            </Feature>
            <Feature icon={<Check size={22} weight="bold" />} title="Every format">
              7v7, 9v9 and 11v11, each with several formations to choose from.
            </Feature>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-14 border-t border-line bg-surface py-16 sm:py-24">
        <div className={container}>
          <div className="max-w-2xl">
            <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Free to coach. Pay only for AI.</h2>
            <p className="mt-3 text-lg text-muted">No plans and no subscription. AI is optional and you only pay for what you use.</p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="flex flex-col rounded-2xl bg-surface p-6 shadow-raised ring-2 ring-primary sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">Coaching</h3>
                <Badge tone="primary">Everyone</Badge>
              </div>
              <div className="mt-4 font-display text-6xl font-bold tracking-tight">Free</div>
              <p className="mt-1 text-muted">Every planning and game day feature.</p>
              <ul className="mt-6 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                {[
                  "Unlimited teams, games and players",
                  "Lineup planner for all four quarters",
                  "Game day mode",
                  "Fair play summary",
                  "Share links for parents",
                  "Printable AYSO game cards",
                  "Assistant coach invites",
                  "7v7, 9v9 and 11v11",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              <a href={startHref} className={buttonClass({ size: "lg", className: "mt-8 self-start" })}>
                {isLoggedIn ? "Go to your team" : "Create free account"}
              </a>
            </div>

            <div className="flex flex-col rounded-2xl bg-canvas p-6 ring-1 ring-line sm:p-8">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold">AI features</h3>
                <Badge>Optional</Badge>
              </div>
              <div className="mt-4 font-display text-4xl font-bold tracking-tight">Pay as you go</div>
              <p className="mt-2 text-muted">
                Turn AI on when you want it and buy credits as you need them. Each request costs what the AI model costs
                us through OpenRouter, plus 50%.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {["AI assistant coach (text or voice)", "Roster import from a photo or file", "No subscription or minimum"].map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <Sparkle size={16} weight="fill" className="mt-0.5 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-14 border-t border-line py-16 sm:py-24">
        <div className={container}>
          <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Questions coaches ask</h2>
          <dl className="mt-10 grid gap-x-12 gap-y-8 md:grid-cols-2">
            {faqs.map((faq) => (
              <div key={faq.question}>
                <dt className="text-lg font-semibold">{faq.question}</dt>
                <dd className="mt-2 max-w-prose text-muted">{faq.answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Call to action */}
      <section id="cta" className="border-t border-line bg-surface py-16 sm:py-20">
        <div className={cx(container, "grid items-center gap-10 md:grid-cols-2")}>
          <div>
            <h2 className="font-display text-4xl font-bold tracking-tight">Ready for your next game?</h2>
            <p className="mt-3 max-w-md text-lg text-muted">
              Add your roster and your next game, and you'll have a fair lineup in a few minutes.
            </p>
          </div>
          {isLoggedIn ? (
            <div className="md:justify-self-end">
              <a href="/dashboard" className={buttonClass({ size: "lg" })}>Go to your team</a>
            </div>
          ) : (
            // Starts signup with these filled in; the account is created on /user/signup
            <form method="get" action="/user/signup" className="grid gap-4 rounded-2xl bg-canvas p-5 ring-1 ring-line sm:p-6">
              <div>
                <label htmlFor="cta-email" className={labelClass}>Email</label>
                <input id="cta-email" name="email" type="email" className={inputClass} placeholder="coach@club.org" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cta-team" className={labelClass}>Team name</label>
                  <input id="cta-team" name="teamName" className={inputClass} placeholder="U12 Spartans" />
                </div>
                <div>
                  <label htmlFor="cta-format" className={labelClass}>Format</label>
                  <select id="cta-format" name="format" defaultValue="9v9" className={inputClass}>
                    <option value="7v7">7v7</option>
                    <option value="9v9">9v9</option>
                    <option value="11v11">11v11</option>
                  </select>
                </div>
              </div>
              <button type="submit" className={buttonClass({ size: "lg", className: "w-full" })}>Create free account</button>
            </form>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line bg-surface py-10">
        <div className={cx(container, "flex flex-col gap-6 text-sm sm:flex-row sm:items-center sm:justify-between")}>
          <div>
            <AppMark />
            <p className="mt-2 text-muted">Lineups and game day for AYSO coaches.</p>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-muted">
            <li><a className="transition hover:text-ink" href="#planning">Planning</a></li>
            <li><a className="transition hover:text-ink" href="#game-day">Game day</a></li>
            <li><a className="transition hover:text-ink" href="#pricing">Pricing</a></li>
            <li>
              <a className="transition hover:text-ink" href={isLoggedIn ? "/dashboard" : "/user/login"}>
                {isLoggedIn ? "Your team" : "Sign in"}
              </a>
            </li>
          </ul>
        </div>
        <div className={cx(container, "mt-8 space-y-2 border-t border-line pt-6 text-xs text-subtle")}>
          <p className="max-w-3xl">
            AYSO Game Day is an independent volunteer tool. It is not affiliated with, endorsed by or sponsored by the
            American Youth Soccer Organization (AYSO). We use the name only because the app is built around AYSO's fair
            play rules.
          </p>
          <p>© {new Date().getFullYear()} AYSO Game Day</p>
        </div>
      </footer>
    </div>
  );
}

const faqs = [
  {
    question: "Is it really free?",
    answer:
      "Yes. Planning, game day mode, share links, game cards and assistant coaches cost nothing. The only paid part is AI, and you only pay if you turn it on.",
  },
  {
    question: "How do AI credits work?",
    answer:
      "You buy credits up front and each AI request uses some. We charge what the AI model costs us through OpenRouter, plus 50% to run the service. No subscription and no minimum.",
  },
  {
    question: "Does it follow AYSO fair play?",
    answer:
      "It counts the quarters each player sits, and the fair play summary flags anyone who hasn't played at least two quarters or sits more than one. Absent and injured players are left out of the count.",
  },
  {
    question: "Do parents need an account?",
    answer: "No. Share a link and it opens a view-only lineup on any phone. Links expire after 24 hours.",
  },
  {
    question: "Can my assistant coach help plan?",
    answer: "Yes. Invite them from your team's settings. They can plan lineups, manage the roster and edit games.",
  },
  {
    question: "Is this an official AYSO app?",
    answer:
      "No. We're independent and not affiliated with or endorsed by AYSO. The name is there because the app is built around AYSO's fair play rules, to make coaching easier for volunteers.",
  },
  {
    question: "What do I need on game day?",
    answer:
      "Just your phone. Open the game, tap Game day, and you'll see each quarter's field and who changes at the next whistle.",
  },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold text-primary">{children}</p>;
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</span>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="mt-0.5 text-muted">{children}</p>
      </div>
    </li>
  );
}

function Feature({ icon, title, ai = false, children }: { icon: ReactNode; title: string; ai?: boolean; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</div>
        {ai && (
          <Badge tone="primary">
            <Sparkle size={12} weight="fill" />
            AI credits
          </Badge>
        )}
      </div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted">{children}</p>
    </Card>
  );
}

// Hero: the game day screen as it looks in the app, on the sample game
function GameDayPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" role="img" aria-label="Game day mode showing quarter 2 of a sample 9v9 game">
      <Card className="p-4 shadow-overlay sm:p-5">
        <div className="flex items-start justify-between gap-4 px-1">
          <div>
            <div className="font-display text-2xl font-bold tracking-tight">vs Rockets</div>
            <div className="text-xs text-muted">U12 Thunder · 9:00 AM · Field 4B</div>
          </div>
          <Badge tone="warning">
            <Sun size={12} weight="fill" />
            Screen on
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-surface-2 p-1">
          {[1, 2, 3, 4].map((q) => (
            <div
              key={q}
              className={cx(
                "rounded-lg py-2 text-center font-display text-lg font-bold tabular",
                q === 2 ? "bg-primary text-white shadow-card" : "text-muted"
              )}
            >
              Q{q}
            </div>
          ))}
        </div>
        <LineupField
          positions={heroPlan.positions}
          lineup={heroPlan.lineup}
          players={demoPlayers}
          highlights={heroHighlights}
          className="mt-3 aspect-[4/5]"
        />
        <div className="mt-3 flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-base font-semibold text-white shadow-card">
          Start Q3
          <ArrowRight size={18} weight="bold" />
        </div>
      </Card>
    </div>
  );
}

// The "changes for next quarter" list from game day, on the sample game
function ChangesPreview() {
  const groups = [
    { title: "Coming on", icon: <ArrowUp size={14} weight="bold" />, tone: "bg-primary-soft text-primary-ink", rows: nextChanges.comingOn, plan: demoPlans[2], field: "toPosition" as const },
    { title: "Coming off", icon: <ArrowDown size={14} weight="bold" />, tone: "bg-surface-2 text-muted", rows: nextChanges.goingOff, plan: heroPlan, field: "fromPosition" as const },
    { title: "Switching positions", icon: <ArrowsLeftRight size={14} weight="bold" />, tone: "bg-warning-soft text-warning", rows: nextChanges.moving, plan: demoPlans[2], field: "toPosition" as const },
  ].filter((group) => group.rows.length > 0);
  const jersey = (playerId: number) => demoPlayers.find((p) => p.id === playerId)?.jerseyNumber;

  return (
    <Card className="mx-auto w-full max-w-md p-5 shadow-overlay sm:p-6" role="img" aria-label="Example list of changes for the next quarter">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">Changes for Q3</h3>
        <span className="text-sm text-subtle tabular">
          {nextChanges.comingOn.length + nextChanges.goingOff.length + nextChanges.moving.length}
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.title}>
            <div className={cx("mb-1 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold", group.tone)}>
              {group.icon}
              {group.title}
            </div>
            <ul className="divide-y divide-line">
              {group.rows.map((change) => (
                <li key={change.playerId} className="flex items-center gap-3 py-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 font-display text-sm font-bold tabular ring-1 ring-line">
                    {jersey(change.playerId)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{shortName(change.playerName)}</span>
                  <span className="text-sm font-semibold">{positionLabel(group.plan, change[group.field])}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}

// Playing time across the sample game, the way the fair play summary counts it
function PlayingTime({ className }: { className?: string }) {
  return (
    <Card className={cx("p-5 shadow-overlay sm:p-6", className)} role="img" aria-label="Example playing time across four quarters">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Fair play summary</h3>
        <Badge tone="success">
          <Check size={12} weight="bold" />
          Everyone plays 3 of 4
        </Badge>
      </div>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_repeat(4,2.25rem)] items-center gap-x-1.5 gap-y-1.5 text-sm sm:grid-cols-[minmax(0,1fr)_repeat(4,3rem)] sm:gap-x-2">
        <span className="text-xs font-semibold text-muted">Player</span>
        {[1, 2, 3, 4].map((q) => (
          <span key={q} className="text-center text-xs font-semibold text-muted">Q{q}</span>
        ))}
        {demoPlayers.slice(0, 8).map((player) => (
          <PlayingTimeRow key={player.id} player={player} />
        ))}
      </div>
    </Card>
  );
}

function PlayingTimeRow({ player }: { player: (typeof demoPlayers)[number] }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="w-5 shrink-0 text-right font-display font-bold text-subtle tabular">{player.jerseyNumber}</span>
        <span className="truncate font-medium">{shortName(player.name)}</span>
      </span>
      {demoPlans.map((plan) => {
        const position = [...plan.lineup.entries()].find(([, p]) => p.playerId === player.id)?.[0];
        return (
          <span
            key={plan.quarter}
            className={cx(
              "flex h-7 items-center justify-center rounded-md text-[11px] font-semibold",
              position !== undefined ? "bg-primary text-white" : "bg-warning-soft text-warning ring-1 ring-inset ring-warning/20"
            )}
          >
            {position !== undefined ? positionLabel(plan, position) : "Bench"}
          </span>
        );
      })}
    </>
  );
}
