import type { Route } from "./+types/team.announcements._index";
import { Link } from "react-router";
import { buttonClass } from "~/components/ui";
import { Megaphone, Plus } from "@phosphor-icons/react";

// The right pane on desktop before an announcement is picked. On phones the
// layout's list is the whole screen, so this shows nothing.

export default function AnnouncementsIndex({ params }: Route.ComponentProps) {
  return (
    <div className="hidden px-safe pt-16 pb-16 text-center lg:block">
      <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-primary-soft text-primary" aria-hidden>
        <Megaphone size={28} weight="fill" />
      </span>
      <h2 className="mt-3 font-display text-2xl font-bold">Pick an announcement</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Choose one on the left to see who opened it, who replied and who still needs a nudge, or send a new one.
      </p>
      <Link to={`/dashboard/team/${params.teamCode}/announcements/new`} className={buttonClass({ className: "mt-5" })}>
        <Plus size={18} weight="bold" />
        New announcement
      </Link>
    </div>
  );
}
