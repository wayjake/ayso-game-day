import { Link, Outlet } from "react-router";
import { ArrowLeft } from "@phosphor-icons/react";
import { AppMark } from "~/components/AppMark";

// Shell for sign in and sign up: a pitch panel on wide screens, the form on canvas
export default function UserLayout() {
  return (
    <div className="min-h-dvh bg-canvas text-ink lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-pitch text-white lg:flex lg:flex-col lg:justify-end">
        <PitchLines className="absolute inset-0 h-full w-full" />
        <div className="relative bg-linear-to-t from-pitch-dark via-pitch-dark/80 to-transparent p-10 pt-32 xl:p-14 xl:pt-40">
          <p className="font-display text-4xl font-bold leading-tight tracking-tight xl:text-5xl">
            Every kid plays.
            <br />
            Every quarter planned.
          </p>
          <p className="mt-4 max-w-sm text-white/80">
            Lineups, sit-outs and position changes for your AYSO team, ready before kickoff.
          </p>
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col px-4 sm:px-6">
        <header className="flex h-16 items-center justify-between gap-4">
          <Link to="/" aria-label="AYSO Game Day home">
            <AppMark />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink">
            <ArrowLeft size={16} weight="bold" />
            <span className="hidden sm:inline">Back to home</span>
            <span className="sm:hidden">Home</span>
          </Link>
        </header>

        <main className="flex flex-1 items-start justify-center py-8 sm:items-center sm:py-12">
          <div className="w-full max-w-md">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

// Full-height pitch with mowing stripes and markings, seen from above
function PitchLines({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={i} y={i * 100 + 50} width="400" height="50" fill="var(--color-pitch-dark)" />
      ))}
      <g fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="3">
        <rect x="30" y="30" width="340" height="740" />
        <line x1="30" y1="400" x2="370" y2="400" />
        <circle cx="200" cy="400" r="62" />
        <rect x="100" y="30" width="200" height="110" />
        <rect x="150" y="30" width="100" height="45" />
        <path d="M160 140 A 50 50 0 0 0 240 140" />
        <rect x="100" y="660" width="200" height="110" />
        <rect x="150" y="725" width="100" height="45" />
        <path d="M160 660 A 50 50 0 0 1 240 660" />
      </g>
      <circle cx="200" cy="400" r="4" fill="white" fillOpacity="0.35" />
    </svg>
  );
}
