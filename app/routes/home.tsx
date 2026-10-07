import type { Route } from "./+types/home";
import { useState } from "react";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { AppMark } from "~/components/AppMark";
import { Badge, Card, buttonClass, cx, inputClass, labelClass } from "~/components/ui";
import {
  ArrowRight,
  CalendarBlank,
  Camera,
  CaretDown,
  Check,
  MapPin,
  Microphone,
  ShareNetwork,
  Strategy,
} from "@phosphor-icons/react";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request, false); // Don't redirect if not logged in
  return data({ isLoggedIn: !!user });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "AYSO Game Day" },
    { name: "description", content: "Plan AYSO games, subs, and rotations in minutes. Create fair play rotations, track sit-outs, and keep everyone aligned." },
  ];
}

const container = "mx-auto w-full max-w-7xl px-4 sm:px-6";

const faqs = [
  {
    id: "q1",
    question: "How do sit-outs work?",
    answer:
      "Mark required sit-outs and the engine spreads them evenly across quarters while keeping core positions covered.",
  },
  {
    id: "q2",
    question: "Can I anchor players to positions?",
    answer:
      "Yes. Lock players to positions (for example GK or CB) and the generator rotates everyone around those anchors.",
  },
  {
    id: "q3",
    question: "Do you support 7v7, 9v9 and 11v11?",
    answer: "All three. Choose your format and templates adjust accordingly.",
  },
];

const plans = [
  {
    name: "Free",
    blurb: "Plan a single team.",
    price: "$0",
    features: ["1 team", "10 games", "PDF export"],
    cta: "Get started",
  },
  {
    name: "Coach",
    blurb: "Everything for one coach, all season.",
    price: "$9",
    features: ["3 teams", "Unlimited games", "Rotation engine", "Calendar sync"],
    cta: "Try Coach",
    featured: true,
  },
  {
    name: "Club",
    blurb: "For age-group coordinators and clubs.",
    price: "$39",
    features: ["Unlimited teams", "Bulk imports", "Role permissions", "Priority support"],
    cta: "Contact sales",
  },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { isLoggedIn } = loaderData;
  const [openFaq, setOpenFaq] = useState<string | null>(null);

  const toggleFaq = (id: string) => {
    setOpenFaq(openFaq === id ? null : id);
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      {/* Top nav */}
      <header className="sticky top-0 z-50 border-b border-line bg-surface/90 backdrop-blur">
        <nav className={cx(container, "flex h-14 items-center justify-between gap-4")}>
          <a href="/" aria-label="AYSO Game Day home">
            <AppMark />
          </a>
          <ul className="hidden items-center gap-1 md:flex">
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#features">Features</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#pricing">Pricing</a></li>
            <li><a className={buttonClass({ variant: "ghost", size: "sm" })} href="#faq">FAQ</a></li>
          </ul>
          <div className="flex items-center gap-2">
            {isLoggedIn ? (
              <a className={buttonClass({ size: "sm" })} href="/dashboard">Dashboard</a>
            ) : (
              <>
                <a className={buttonClass({ variant: "ghost", size: "sm", className: "hidden sm:inline-flex" })} href="/user/login">Sign in</a>
                <a className={buttonClass({ size: "sm", className: "hidden sm:inline-flex" })} href="/user/signup">Get started</a>
                <a className={buttonClass({ size: "sm", className: "sm:hidden" })} href="/user/login">Sign in</a>
              </>
            )}
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="overflow-hidden">
        <div className={cx(container, "grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)] lg:gap-16")}>
          <div>
            <p className="text-sm font-semibold text-primary">For coaches, schedulers and team parents</p>
            <h1 className="mt-3 font-display text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl xl:text-7xl">
              Plan AYSO games, subs and rotations in minutes.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Build fair play rotations, track sit-outs, and send everyone the lineup before you get to the field.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href={isLoggedIn ? "/dashboard" : "/user/signup"} className={buttonClass({ size: "lg" })}>
                {isLoggedIn ? "Go to dashboard" : "Start free"}
                <ArrowRight size={18} weight="bold" />
              </a>
              <a href="#features" className={buttonClass({ variant: "secondary", size: "lg" })}>
                See features
              </a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
              {["AYSO-friendly", "U8–U19", "No credit card required"].map((item) => (
                <li key={item} className="flex items-center gap-1.5">
                  <Check size={16} weight="bold" className="text-success" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <LineupPreview />
        </div>
      </section>

      {/* What it covers */}
      <section className="border-y border-line bg-surface">
        <ul className={cx(container, "grid gap-x-8 gap-y-3 py-6 text-sm text-muted sm:grid-cols-3")}>
          <li><strong className="font-semibold text-ink">7v7, 9v9 and 11v11</strong> formations included</li>
          <li><strong className="font-semibold text-ink">Quarter by quarter</strong> sit-out tracking</li>
          <li><strong className="font-semibold text-ink">Share links</strong> parents open without an account</li>
        </ul>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-14 py-16 sm:py-24">
        <div className={container}>
          <div className="max-w-2xl">
            <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">What you get</h2>
            <p className="mt-3 text-lg text-muted">
              Built around how an AYSO game actually runs: four quarters, a full bench, and everyone gets their time.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:gap-5 lg:grid-cols-6">
            {/* Lead feature */}
            <Card className="flex flex-col p-6 sm:p-8 lg:col-span-4 lg:row-span-2">
              <h3 className="font-display text-3xl font-bold tracking-tight">Fair rotations, quarter by quarter</h3>
              <p className="mt-2 max-w-lg text-muted">
                Auto-generate quarter rotations that respect mandatory sit-outs and keep positions covered. Play counts update
                as you go, and changes from the last quarter are marked so the switch goes smoothly.
              </p>
              <PlayingTime className="mt-8 lg:mt-auto lg:pt-8" />
            </Card>

            <FeatureCard
              className="lg:col-span-2"
              icon={<Strategy size={22} />}
              title="Formations for every format"
              body="Preset lineups for 7v7, 9v9 and 11v11, with a different formation each quarter if you want one."
            />
            <FeatureCard
              className="lg:col-span-2"
              icon={<ShareNetwork size={22} />}
              title="Shareable game sheets"
              body="Send parents a link that opens on any phone, or print a game card for the bench. No guessing on game day."
            />
            <FeatureCard
              className="lg:col-span-3"
              icon={<Microphone size={22} />}
              title="An assistant coach"
              body="Type or say what you need, like who is out or who should keep, and get a suggested lineup that follows fair play rules."
            />
            <FeatureCard
              className="lg:col-span-3"
              icon={<Camera size={22} />}
              title="Your roster in minutes"
              body="Add players one at a time, or import the whole roster from a photo or a file."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-14 border-y border-line bg-surface py-16 sm:py-24">
        <div className={container}>
          <div className="max-w-2xl">
            <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Simple pricing</h2>
            <p className="mt-3 text-lg text-muted">Start free. Upgrade when your season kicks off.</p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={cx(
                  "flex flex-col rounded-2xl p-6 sm:p-7",
                  plan.featured ? "bg-surface shadow-raised ring-2 ring-primary" : "bg-canvas ring-1 ring-line"
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  {plan.featured && <Badge tone="primary">Popular</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">{plan.blurb}</p>
                <div className="mt-5 font-display text-5xl font-bold tracking-tight tabular">
                  {plan.price}
                  {plan.price !== "$0" && <span className="ml-1 font-sans text-base font-normal tracking-normal text-muted">/mo</span>}
                </div>
                <ul className="mt-6 mb-8 space-y-2.5 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2">
                      <Check size={16} weight="bold" className="text-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={buttonClass({
                    variant: plan.featured ? "primary" : "secondary",
                    size: "lg",
                    className: "mt-auto w-full",
                  })}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-14 py-16 sm:py-24">
        <div className={cx(container, "grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
          <div>
            <h2 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Frequently asked</h2>
            <p className="mt-3 text-lg text-muted">Quick answers about fairness, positions and exports.</p>
          </div>

          <Card className="divide-y divide-line self-start overflow-hidden">
            {faqs.map((faq) => {
              const isOpen = openFaq === faq.id;
              return (
                <div key={faq.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold transition hover:bg-surface-2"
                    aria-expanded={isOpen}
                    onClick={() => toggleFaq(faq.id)}
                  >
                    {faq.question}
                    <CaretDown
                      size={18}
                      weight="bold"
                      className={cx("shrink-0 text-subtle transition-transform duration-200", isOpen && "rotate-180")}
                    />
                  </button>
                  {isOpen && <div className="px-5 pb-5 text-muted">{faq.answer}</div>}
                </div>
              );
            })}
          </Card>
        </div>
      </section>

      {/* Call to action */}
      <section id="cta" className="border-t border-line bg-surface py-16 sm:py-20">
        <div className={cx(container, "grid items-center gap-10 md:grid-cols-2")}>
          <div>
            <h2 className="font-display text-4xl font-bold tracking-tight">Ready to plan your next game?</h2>
            <p className="mt-3 max-w-md text-lg text-muted">
              Start with your roster and your next game time. You'll have a plan in under five minutes.
            </p>
          </div>
          <form className="grid gap-4 rounded-2xl bg-canvas p-5 ring-1 ring-line sm:p-6">
            <div>
              <label htmlFor="cta-email" className={labelClass}>Email</label>
              <input id="cta-email" type="email" className={inputClass} placeholder="coach@club.org" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="cta-team" className={labelClass}>Team name</label>
                <input id="cta-team" className={inputClass} placeholder="U12 Spartans" />
              </div>
              <div>
                <label htmlFor="cta-format" className={labelClass}>Format</label>
                <select id="cta-format" className={inputClass}>
                  <option>7v7</option>
                  <option>9v9</option>
                  <option>11v11</option>
                </select>
              </div>
            </div>
            <button className={buttonClass({ size: "lg", className: "w-full" })}>Create free account</button>
            <p className="text-xs text-muted">By continuing you agree to our terms.</p>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line py-12">
        <div className={cx(container, "grid gap-8 text-sm sm:grid-cols-2 md:grid-cols-4")}>
          <div className="sm:col-span-2">
            <AppMark />
            <p className="mt-3 max-w-xs text-muted">Designed for fairness, clarity and game-day calm.</p>
          </div>
          <div>
            <div className="font-semibold">Product</div>
            <ul className="mt-3 space-y-2 text-muted">
              <li><a className="transition hover:text-ink" href="#features">Features</a></li>
              <li><a className="transition hover:text-ink" href="#pricing">Pricing</a></li>
              <li><a className="transition hover:text-ink" href="#faq">FAQ</a></li>
            </ul>
          </div>
          <div>
            <div className="font-semibold">Support</div>
            <ul className="mt-3 space-y-2 text-muted">
              <li><a className="transition hover:text-ink" href="#">Help center</a></li>
              <li><a className="transition hover:text-ink" href="#">Status</a></li>
              <li><a className="transition hover:text-ink" href="#">Contact</a></li>
            </ul>
          </div>
        </div>
        <div className={cx(container, "mt-10 text-xs text-subtle")}>
          © {new Date().getFullYear()} AYSO Game Day
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  body,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  className?: string;
}) {
  return (
    <Card className={cx("p-6", className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-soft text-primary">{icon}</div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm text-muted">{body}</p>
    </Card>
  );
}

// Sample 9v9 lineup (3-3-2) for the hero illustration. x/y are percentages of the field.
const sampleLineup = [
  { pos: "GK", name: "Maya", x: 50, y: 90 },
  { pos: "LB", name: "Liam", x: 18, y: 70 },
  { pos: "CB", name: "Ethan", x: 50, y: 73 },
  { pos: "RB", name: "Zoe", x: 82, y: 70 },
  { pos: "LW", name: "Sofia", x: 18, y: 44 },
  { pos: "CM", name: "Ava", x: 50, y: 48 },
  { pos: "RW", name: "Noah", x: 82, y: 44 },
  { pos: "ST", name: "Tyler", x: 34, y: 18 },
  { pos: "ST", name: "Emma", x: 66, y: 18 },
];

const sampleSitOuts = ["Mia", "Lucas", "Aria", "Jake"];

// Hero illustration: a planned quarter on the field, the way it looks in the app
function LineupPreview() {
  return (
    <Card className="mx-auto w-full max-w-md p-4 shadow-overlay sm:p-5 lg:max-w-none" aria-label="Example lineup for a 9v9 game" role="img">
      <div className="flex items-start justify-between gap-4 px-1">
        <div>
          <div className="text-xs font-semibold text-primary">Next game</div>
          <div className="font-display text-2xl font-bold tracking-tight">vs Rockets</div>
        </div>
        <div className="space-y-0.5 text-right text-xs text-muted">
          <div className="flex items-center justify-end gap-1"><CalendarBlank size={14} />Sat 9:00 AM</div>
          <div className="flex items-center justify-end gap-1"><MapPin size={14} />Field GH-3</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 gap-1 rounded-lg bg-surface-2 p-1 text-center text-sm font-semibold">
        {[1, 2, 3, 4].map((q) => (
          <div key={q} className={cx("rounded-md py-1.5", q === 1 ? "bg-surface text-ink shadow-card" : "text-muted")}>
            Q{q}
          </div>
        ))}
      </div>

      <div className="relative mt-3 aspect-[5/6] overflow-hidden rounded-xl bg-pitch">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="absolute inset-x-0 bg-pitch-dark" style={{ top: `${(i * 2 + 1) * 10}%`, height: "10%" }} />
        ))}
        <div className="absolute inset-2.5 rounded-md border-2 border-white/60">
          <div className="absolute inset-x-0 top-1/2 border-t-2 border-white/60" />
          <div className="absolute top-1/2 left-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/60" />
          <div className="absolute top-0 left-1/4 h-[14%] w-1/2 border-x-2 border-b-2 border-white/60" />
          <div className="absolute bottom-0 left-1/4 h-[14%] w-1/2 border-x-2 border-t-2 border-white/60" />
        </div>

        {sampleLineup.map((p) => (
          <div
            key={p.name}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
            style={{ left: `${p.x}%`, top: `${p.y}%` }}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-sm font-bold text-white shadow-raised ring-2 ring-white">
              {p.pos}
            </span>
            <span className="rounded-md bg-ink/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{p.name}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 px-1 text-xs">
        <span className="mr-1 font-semibold text-muted">Sitting out</span>
        {sampleSitOuts.map((name, i) => (
          <Badge key={name} tone={i === 0 ? "primary" : "neutral"}>
            Q{i + 1} {name}
          </Badge>
        ))}
      </div>
    </Card>
  );
}

// Playing-time grid: each player sits one quarter, everyone plays three
const playingTime = [
  { name: "Mia", out: 1 },
  { name: "Lucas", out: 2 },
  { name: "Aria", out: 3 },
  { name: "Jake", out: 4 },
  { name: "Ava", out: 2 },
  { name: "Noah", out: 3 },
];

function PlayingTime({ className }: { className?: string }) {
  return (
    <div className={cx("rounded-xl bg-surface-2 p-4 sm:p-5", className)} aria-label="Example playing time across four quarters" role="img">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,2rem)_2.5rem] items-center gap-x-1.5 gap-y-2 text-sm sm:grid-cols-[minmax(0,1fr)_repeat(4,3.5rem)_3.5rem] sm:gap-x-2">
        <span className="text-xs font-semibold text-muted">Player</span>
        {[1, 2, 3, 4].map((q) => (
          <span key={q} className="text-center text-xs font-semibold text-muted">Q{q}</span>
        ))}
        <span className="text-right text-xs font-semibold text-muted">Played</span>

        {playingTime.map((player) => (
          <div key={player.name} className="contents">
            <span className="truncate font-medium">{player.name}</span>
            {[1, 2, 3, 4].map((q) => (
              <span
                key={q}
                className={cx(
                  "h-6 rounded-md",
                  q === player.out ? "bg-surface ring-1 ring-inset ring-line-strong" : "bg-primary"
                )}
              />
            ))}
            <span className="text-right font-display font-bold tabular">3/4</span>
          </div>
        ))}
      </div>
    </div>
  );
}
