import type { Route } from "./+types/home";
import type { ReactNode } from "react";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { AppMark } from "~/components/AppMark";
import { Badge, Card, buttonClass, cx, inputClass, labelClass } from "~/components/ui";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  CalendarPlus,
  Camera,
  ChatsCircle,
  Check,
  ClipboardText,
  EnvelopeSimple,
  Key,
  Lock,
  MapPin,
  Megaphone,
  PaperPlaneTilt,
  Repeat,
  Sparkle,
  UsersThree,
} from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request, false); // Don't redirect if not logged in
  return data({ isLoggedIn: !!user });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "BenchTalk - Calm on the sideline" },
    {
      name: "description",
      content:
        "The schedule, RSVPs and every message with your team's families in one place. Free for volunteer coaches.",
    },
  ];
}

const container = "mx-auto w-full max-w-7xl px-4 sm:px-6";

export default function Home({ loaderData }: Route.ComponentProps) {
  const { isLoggedIn } = loaderData;
  const startHref = isLoggedIn ? "/dashboard" : "/user/signup";

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur">
        <nav className={cx(container, "flex h-14 items-center justify-between gap-4")}>
          <a href="/" aria-label="BenchTalk home">
            <AppMark />
          </a>
          <ul className="hidden items-center gap-1 md:flex">
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#schedule">Schedule</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#messages">Messages</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#announcements">Announcements</a></li>
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
            <p className="text-sm font-semibold text-coral-ink">For volunteer coaches</p>
            <h1 className="mt-3 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
              Calm on the sideline.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Your schedule, your RSVPs and every message with your families in one place. Post a practice, see who's
              coming, and answer a parent from your phone, whether they use the app or only read email.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={startHref} className={buttonClass({ size: "lg" })}>
                {isLoggedIn ? "Go to your team" : "Start free"}
                <ArrowRight size={18} weight="bold" />
              </a>
              <a href="#messages" className={buttonClass({ variant: "secondary", size: "lg" })}>
                See messages
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {["Free to use", "No passwords for families", "Works with families who only use email"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check size={16} weight="bold" className="text-coral-ink" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <HeroPreview />
        </div>
      </section>

      {/* Why it exists */}
      <section className="bg-coral-soft py-14 sm:py-20">
        <div className={cx(container, "grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:gap-16")}>
          <div>
            <p className="text-sm font-semibold text-coral-ink">Why we built it</p>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Coaching is the easy part</h2>
          </div>
          <div className="space-y-4 text-lg text-muted">
            <p>
              The hard part is everything around it. A group text with forty parents. An email nobody answered. "What
              time is practice?" at nine on a school night, and a field change that half the team never saw.
            </p>
            <p>
              BenchTalk puts the schedule, the RSVPs and every conversation with your families in one calm place. You
              know who's coming, families know where to be, and nothing a parent asks gets lost. It's built for the
              volunteers who give their weekends to the game.
            </p>
          </div>
        </div>
      </section>

      {/* Schedule */}
      <section id="schedule" className="scroll-mt-14 border-t border-line py-16 sm:py-24">
        <div className={cx(container, "grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div className="lg:order-2">
            <SectionLabel>Schedule and RSVPs</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Everyone knows where to be</h2>
            <p className="mt-3 max-w-xl text-lg text-muted">
              Games and practices in one schedule your families can see on their phones, with an answer from every
              family before you get to the field.
            </p>
            <ul className="mt-8 space-y-5">
              <Point icon={<Repeat size={20} />} title="Set up the season once">
                Add a game, or a weekly practice for the whole season. Move or cancel one without touching the rest.
              </Point>
              <Point icon={<CalendarCheck size={20} />} title="Yes, no or maybe in one tap">
                Families answer for each kid. You can answer for a family that tells you at the field.
              </Point>
              <Point icon={<Bell size={20} />} title="Remind only who hasn't answered">
                One tap nudges the families still missing, and leaves everyone else alone.
              </Point>
            </ul>
          </div>
          <SchedulePreview className="lg:order-1" />
        </div>
      </section>

      {/* Messages */}
      <section id="messages" className="scroll-mt-14 border-t border-line bg-surface py-16 sm:py-24">
        <div className={cx(container, "grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div>
            <SectionLabel>Messages</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Talk to families without the group text</h2>
            <p className="mt-3 max-w-xl text-lg text-muted">
              A team chat for everyone, and a private thread between each family and the coaches. Every thread says
              who can see it.
            </p>
            <ul className="mt-8 space-y-5">
              <Point icon={<Lock size={20} />} title="Private with the coaches">
                A parent writes once and every coach on the team sees it. No more forwarding texts to your assistant.
              </Point>
              <Point icon={<EnvelopeSimple size={20} />} title="Families on email still get it">
                Not everyone will join an app. They get your message by email, and their reply lands back in the thread.
              </Point>
              <Point icon={<ChatsCircle size={20} />} title="Nothing slips">
                Threads waiting on you are marked "Needs reply" until you answer or mark them done.
              </Point>
            </ul>
          </div>
          <InboxPreview />
        </div>
      </section>

      {/* Announcements */}
      <section id="announcements" className="scroll-mt-14 border-t border-line py-16 sm:py-24">
        <div className={cx(container, "grid items-center gap-12 lg:grid-cols-2 lg:gap-16")}>
          <div className="lg:order-2">
            <SectionLabel>Announcements</SectionLabel>
            <h2 className="mt-2 font-display text-4xl font-bold tracking-tight sm:text-5xl">Send it once. Know who saw it.</h2>
            <p className="mt-3 max-w-xl text-lg text-muted">
              Picture day, snack schedule, the tournament form. Email every family under your name and see where each
              one stands.
            </p>
            <ul className="mt-8 space-y-5">
              <Point icon={<PaperPlaneTilt size={20} />} title="Ask for what you need">
                Just let them know, ask for a "Got it", or ask for a reply.
              </Point>
              <Point icon={<ClipboardText size={20} />} title="A tracker for every family">
                Delivered, opened, replied or bounced, so you know who to follow up with.
              </Point>
              <Point icon={<Megaphone size={20} />} title="Replies stay private">
                When a family answers, it goes to the coaches only, never reply-all.
              </Point>
            </ul>
          </div>
          <AnnouncementPreview className="lg:order-1" />
        </div>
      </section>

      {/* Everything else */}
      <section className="border-t border-line bg-surface py-16 sm:py-24">
        <div className={container}>
          <h2 className="max-w-2xl font-display text-4xl font-bold tracking-tight">Everything else a volunteer coach needs</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Feature icon={<Key size={22} />} title="No passwords for families">
              Parents sign in with a link or a 6-digit code from their email, and see their own kids' teams.
            </Feature>
            <Feature icon={<Bell size={22} />} title="Notifications on their phone">
              Families add BenchTalk to their Home Screen and get a notification for new messages and schedule changes.
            </Feature>
            <Feature icon={<UsersThree size={22} />} title="Bring your assistant coach">
              Invite them by email. They see every family thread and can manage the schedule with you.
            </Feature>
            <Feature icon={<ClipboardText size={22} />} title="Lineups and game day">
              Plan who plays each quarter, keep playing time even, and run subs from a screen made for the sideline.
            </Feature>
            <Feature icon={<Sparkle size={22} weight="fill" />} title="AI assistant coach" ai>
              Say who's out today or who should start in goal, and get a lineup that follows fair-play rules.
            </Feature>
            <Feature icon={<Camera size={22} />} title="Import your roster" ai>
              Snap a photo of the league roster or upload the file, and the players are added for you.
            </Feature>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-14 border-t border-line py-16 sm:py-24">
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
              <p className="mt-1 text-muted">Every schedule, message and game day feature.</p>
              <ul className="mt-6 grid gap-x-6 gap-y-2.5 text-sm sm:grid-cols-2">
                {[
                  "Unlimited teams and families",
                  "Games, practices and RSVPs",
                  "Team chat and family threads",
                  "Email announcements with tracking",
                  "Notifications for families",
                  "Assistant coach invites",
                  "Lineups and game day mode",
                  "Printable game cards",
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
      <section id="faq" className="scroll-mt-14 border-t border-line bg-surface py-16 sm:py-24">
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
      <section id="cta" className="border-t border-line py-16 sm:py-20">
        <div className={cx(container, "grid items-center gap-10 md:grid-cols-2")}>
          <div>
            <h2 className="font-display text-4xl font-bold tracking-tight">Ready for the season?</h2>
            <p className="mt-3 max-w-md text-lg text-muted">
              Add your team and your families' emails, and your first message can go out tonight.
            </p>
          </div>
          {isLoggedIn ? (
            <div className="md:justify-self-end">
              <a href="/dashboard" className={buttonClass({ size: "lg" })}>Go to your team</a>
            </div>
          ) : (
            // Starts signup with these filled in; the account is created on /user/signup
            <form method="get" action="/user/signup" className="grid gap-4 rounded-2xl bg-surface p-5 ring-1 ring-line sm:p-6">
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
            <p className="mt-2 text-muted">Schedules, RSVPs and family messages for volunteer coaches.</p>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-muted">
            <li><a className="transition hover:text-ink" href="#schedule">Schedule</a></li>
            <li><a className="transition hover:text-ink" href="#messages">Messages</a></li>
            <li><a className="transition hover:text-ink" href="#pricing">Pricing</a></li>
            <li><a className="transition hover:text-ink" href="/changelog">What's new</a></li>
            <li>
              <a className="transition hover:text-ink" href={isLoggedIn ? "/dashboard" : "/user/login"}>
                {isLoggedIn ? "Your team" : "Sign in"}
              </a>
            </li>
          </ul>
        </div>
        <div className={cx(container, "mt-8 space-y-2 border-t border-line pt-6 text-xs text-subtle")}>
          <p className="max-w-3xl">
            BenchTalk is an independent volunteer tool. It is not affiliated with, endorsed by or sponsored by the
            American Youth Soccer Organization (AYSO) or any other league.
          </p>
          <p>© {new Date().getFullYear()} BenchTalk</p>
        </div>
      </footer>
    </div>
  );
}

const faqs = [
  {
    question: "Is it really free?",
    answer:
      "Yes. The schedule, RSVPs, messages, announcements and game day tools cost nothing. The only paid part is AI, and you only pay if you turn it on.",
  },
  {
    question: "Do parents have to download an app?",
    answer:
      "No. BenchTalk runs in the browser, and families sign in with a link or code from their email. On a phone they can add it to the Home Screen to get notifications.",
  },
  {
    question: "What if a family never signs up?",
    answer:
      "They still get your messages and announcements by email. When they reply, it lands in their thread with the coaches, just like a message from the app.",
  },
  {
    question: "Who can see my messages?",
    answer:
      "The team chat is for the coaches and all families on the app. A family's thread is private between that family and the team's coaches. Every thread says so at the top.",
  },
  {
    question: "Can my assistant coach help?",
    answer:
      "Yes. Invite them from your team's settings. They see every family thread and can manage the schedule, roster and games with you.",
  },
  {
    question: "Do you still do lineups?",
    answer:
      "Yes. Plan each quarter, keep playing time even with the fair-play summary, and run subs from game day mode on your phone.",
  },
  {
    question: "Is this an official AYSO app?",
    answer:
      "No. BenchTalk is independent and not affiliated with or endorsed by AYSO or any other league. It's built for volunteer coaches of any youth team.",
  },
  {
    question: "How do AI credits work?",
    answer:
      "You buy credits up front and each AI request uses some. We charge what the AI model costs us through OpenRouter, plus 50% to run the service. No subscription and no minimum.",
  },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-sm font-semibold text-coral-ink">{children}</p>;
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-coral-soft text-coral-ink">{icon}</span>
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
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">{icon}</div>
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

// ---------------------------------------------------------------------------
// Static previews of the app's screens, with sample data

function DateBlock({ month, day }: { month: string; day: string }) {
  return (
    <div className="flex w-12 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1 ring-1 ring-line">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{month}</span>
      <span className="font-display text-xl font-bold leading-none tabular">{day}</span>
    </div>
  );
}

function Bubble({ from, mine = false, children }: { from: string; mine?: boolean; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col", mine ? "items-end" : "items-start")}>
      <span className="mb-1 px-1 text-xs font-semibold text-muted">{from}</span>
      <p
        className={cx(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-snug",
          mine ? "bg-primary text-white" : "bg-surface text-ink ring-1 ring-line"
        )}
      >
        {children}
      </p>
    </div>
  );
}

// Hero: next practice with RSVPs above a private family thread
function HeroPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" role="img" aria-label="A practice with RSVP counts, and a private message thread between a family and the coaches">
      <div aria-hidden className="absolute -right-3 -bottom-3 left-8 top-10 rotate-2 rounded-2xl bg-coral sm:-right-5 sm:-bottom-5" />
      <div aria-hidden className="absolute -top-4 -left-4 size-16 rounded-full bg-coral-soft" />
      <Card className="relative overflow-hidden shadow-overlay">
        <div className="flex items-center gap-3 border-b border-line p-4 sm:p-5">
          <DateBlock month="Thu" day="14" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Practice</div>
            <div className="flex items-center gap-1 truncate text-sm text-muted">
              <MapPin size={14} weight="fill" className="shrink-0" />
              5:00 PM · Field 3
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl font-bold leading-none tabular">11</div>
            <div className="text-xs text-muted">coming</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-3 sm:px-5">
          <Badge tone="success"><Check size={12} weight="bold" />11 yes</Badge>
          <Badge>1 maybe</Badge>
          <Badge tone="warning">2 haven't answered</Badge>
        </div>
        <div className="bg-canvas p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">Patel family</div>
              <div className="text-xs text-muted">Sofia · private with the coaches</div>
            </div>
            <Lock size={16} className="text-muted" aria-hidden />
          </div>
          <div className="space-y-3">
            <Bubble from="Priya Patel">Sofia has a dentist appointment Thursday. Is it OK if she gets there at 5:30?</Bubble>
            <Bubble from="Coach Jake" mine>No problem. We scrimmage from 5:30, so she won't miss the fun part.</Bubble>
          </div>
        </div>
      </Card>
    </div>
  );
}

function SchedulePreview({ className }: { className?: string }) {
  const events = [
    { month: "Tue", day: "12", title: "Practice", detail: "5:00 PM · Field 3", yes: 12, waiting: 0 },
    { month: "Thu", day: "14", title: "Practice", detail: "5:00 PM · Field 3", yes: 11, waiting: 2, moved: true },
    { month: "Sat", day: "16", title: "vs Rockets", detail: "9:00 AM · Field 4B", yes: 9, waiting: 4 },
  ];
  return (
    <Card className={cx("mx-auto w-full max-w-md p-5 shadow-overlay sm:p-6", className)} role="img" aria-label="Example schedule with RSVP counts">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">This week</h3>
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
          <CalendarPlus size={16} />
          Add practice
        </span>
      </div>
      <ul className="mt-4 divide-y divide-line">
        {events.map((e) => (
          <li key={e.day} className="flex items-center gap-3 py-3">
            <DateBlock month={e.month} day={e.day} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{e.title}</div>
              <div className="truncate text-sm text-muted">{e.detail}</div>
              {e.moved && <div className="mt-1 text-xs font-semibold text-primary">Moved to Field 3 · families notified</div>}
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge tone="success"><Check size={12} weight="bold" />{e.yes} yes</Badge>
              {e.waiting > 0 && <span className="text-xs font-semibold text-warning">Remind {e.waiting}</span>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function InboxPreview() {
  const rows = [
    { name: "Team chat", detail: "Coaches and all families on the app", last: "Coach Jake: Bring a white shirt Saturday.", icon: <UsersThree size={18} /> },
    { name: "Chen family", detail: "Lily · private with the coaches", last: "Can Lily ride with the Riveras?", needsReply: true },
    { name: "Okafor family", detail: "Liam · by email, not on the app yet", last: "Thanks, we'll be there at 8:30.", email: true },
    { name: "Patel family", detail: "Sofia · private with the coaches", last: "You: No problem. We scrimmage from 5:30." },
  ];
  return (
    <Card className="mx-auto w-full max-w-md overflow-hidden shadow-overlay" role="img" aria-label="Example message list with a team chat and family threads">
      <div className="border-b border-line px-5 py-4">
        <h3 className="text-base font-semibold">Messages</h3>
      </div>
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.name} className="flex items-start gap-3 px-5 py-3.5">
            <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg", r.icon ? "bg-primary-soft text-primary" : "bg-coral-soft text-coral-ink")}>
              {r.icon ?? (r.email ? <EnvelopeSimple size={18} /> : <span className="text-sm font-semibold">{r.name[0]}</span>)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold">{r.name}</span>
                {r.needsReply && <Badge tone="warning">Needs reply</Badge>}
              </div>
              <div className="truncate text-xs text-muted">{r.detail}</div>
              <div className="mt-1 truncate text-sm">{r.last}</div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AnnouncementPreview({ className }: { className?: string }) {
  const families = [
    { name: "Rivera family", state: "Got it", tone: "success" as const },
    { name: "Chen family", state: "Replied", tone: "primary" as const, note: "Lily has her uniform from last year." },
    { name: "Okafor family", state: "Opened", tone: "neutral" as const },
    { name: "Nguyen family", state: "Bounced", tone: "danger" as const },
  ];
  return (
    <Card className={cx("mx-auto w-full max-w-md p-5 shadow-overlay sm:p-6", className)} role="img" aria-label="Example announcement tracker">
      <div className="text-xs font-semibold text-muted">Announcement · ask for "Got it"</div>
      <h3 className="mt-1 text-base font-semibold">Picture day is Saturday at 8:15</h3>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {[["All", 14], ["Got it", 9], ["Replied", 2], ["Waiting", 2]].map(([label, count], i) => (
          <span
            key={label}
            className={cx(
              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ring-1",
              i === 0 ? "bg-ink text-white ring-ink" : "bg-surface text-ink ring-line-strong"
            )}
          >
            {label}
            <span className={cx("tabular", i === 0 ? "text-white/70" : "text-muted")}>{count}</span>
          </span>
        ))}
      </div>
      <ul className="mt-3 divide-y divide-line">
        {families.map((f) => (
          <li key={f.name} className="py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{f.name}</span>
              <Badge tone={f.tone}>{f.state}</Badge>
            </div>
            {f.note && <p className="mt-0.5 truncate text-sm text-muted">“{f.note}”</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
