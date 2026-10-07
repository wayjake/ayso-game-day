import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useRouteLoaderData } from "react-router";
import type { loader as dashboardLoader } from "~/routes/dashboard";
import { CaretUpDown, Check, Plus, SquaresFour } from "@phosphor-icons/react";

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
        className="-ml-2 flex items-center gap-1.5 rounded-lg px-2 py-0.5 font-display text-2xl font-bold tracking-tight transition hover:bg-surface-2"
      >
        {team.name}
        <CaretUpDown size={18} weight="bold" className="text-subtle" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 w-72 rounded-xl bg-surface p-1.5 shadow-overlay ring-1 ring-line"
        >
          {otherTeams.length > 0 && (
            <>
              <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <div className="min-w-0 flex-1 text-sm font-semibold truncate">{team.name}</div>
                <Check size={16} weight="bold" className="text-primary" />
              </div>
              {otherTeams.map((t) => (
                <Link
                  key={t.id}
                  to={`/dashboard/team/${t.id}`}
                  role="menuitem"
                  className="block rounded-lg px-3 py-2 transition hover:bg-surface-2"
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted">
                    {[t.format, t.ageGroup, t.season].filter(Boolean).join(" • ")}
                  </div>
                </Link>
              ))}
              <div className="mx-2 my-1.5 border-t border-line" />
            </>
          )}
          <Link to="/dashboard/teams" role="menuitem" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink">
            <SquaresFour size={18} />
            All teams
          </Link>
          <Link to="/dashboard/teams/new" role="menuitem" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink">
            <Plus size={18} />
            New team
          </Link>
        </div>
      )}
    </div>
  );
}
