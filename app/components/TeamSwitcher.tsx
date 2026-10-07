import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";
import type { loader as dashboardLoader } from "~/routes/dashboard";

interface TeamSwitcherProps {
  team: { id: number; name: string };
}

// Team name that opens a menu of the coach's other teams, so switching
// seasons doesn't mean backing out to a list first.
export function TeamSwitcher({ team }: TeamSwitcherProps) {
  const dashboard = useRouteLoaderData<typeof dashboardLoader>("routes/dashboard");
  const otherTeams = (dashboard?.teams ?? []).filter((t) => t.id !== team.id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();

  // Close on navigation and on clicks outside the menu
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded -ml-1 px-1 py-0.5 text-xl font-bold hover:bg-[var(--bg)] transition"
      >
        {team.name}
        <svg className="w-4 h-4 text-[var(--muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-72 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
        >
          {otherTeams.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Switch team
              </div>
              {otherTeams.map((t) => (
                <Link
                  key={t.id}
                  to={`/dashboard/team/${t.id}`}
                  role="menuitem"
                  className="block px-3 py-2 hover:bg-[var(--bg)]"
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {[t.format, t.ageGroup, t.season].filter(Boolean).join(" • ")}
                  </div>
                </Link>
              ))}
              <div className="my-1 border-t border-[var(--border)]" />
            </>
          )}
          <Link to="/dashboard/teams" role="menuitem" className="block px-3 py-2 text-sm hover:bg-[var(--bg)]">
            All teams
          </Link>
          <Link to="/dashboard/teams/new" role="menuitem" className="block px-3 py-2 text-sm hover:bg-[var(--bg)]">
            New team
          </Link>
        </div>
      )}
    </div>
  );
}
