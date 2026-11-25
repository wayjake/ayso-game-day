import type { Route } from "./+types/dashboard";
import { useCallback, useState } from "react";
import { Outlet, Link, useMatches, useParams } from "react-router";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { activeTeams, canAccessTeam } from "~/utils/team-access.server";
import { isParent } from "~/utils/family.server";
import { getNotifyPrefs, vapidPublicKey } from "~/utils/push.server";
import { detectPlatform } from "~/utils/pwa";
import { db, teams } from "~/db";
import { and, desc } from "drizzle-orm";
import { UsersThree } from "@phosphor-icons/react";
import { AppMark } from "~/components/AppMark";
import { AccountMenu } from "~/components/AccountMenu";
import { InstallSheet } from "~/components/InstallSheet";
import { NotificationsMenu } from "~/components/NotificationsMenu";
import { NotifyPrompt } from "~/components/NotifyPrompt";
import { HelpButton, TourProvider } from "~/components/Tour";
import { parseToursSeen } from "~/utils/tours";
import { cx } from "~/components/ui";
import { PullToRefresh } from "~/components/PullToRefresh";
import { usePush } from "~/hooks/usePush";
import { PushContext } from "~/hooks/usePushContext";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request);

  // Teams this user can open, for the team switcher. Archived ones live under All teams.
  const userTeams = await db
    .select({
      id: teams.id,
      name: teams.name,
      format: teams.format,
      ageGroup: teams.ageGroup,
      season: teams.season,
    })
    .from(teams)
    .where(and(canAccessTeam(user.id), activeTeams()))
    .orderBy(desc(teams.createdAt));

  return data({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      teamName: user.teamName,
    },
    teams: userTeams,
    // A coach who is also a parent can hop over to the family app
    isParent: await isParent(user.id),
    vapidPublicKey: vapidPublicKey(),
    notifyPrefs: await getNotifyPrefs(user.id),
    toursSeen: parseToursSeen(user.toursSeen),
    platform: detectPlatform(request.headers.get("user-agent") ?? "", 0),
  });
}

export default function DashboardLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  // Routes with handle.workspace (Messages) fill the window on desktop and
  // scroll inside their own panes, so this layout becomes a fixed-height column
  const workspace = useMatches().some((m) => (m.handle as { workspace?: boolean } | undefined)?.workspace);

  // One push state for the whole dashboard: the bell, the prompt and the Account page share it
  const push = usePush(loaderData.vapidPublicKey, loaderData.notifyPrefs);
  const [installOpen, setInstallOpen] = useState(false);
  const openInstall = useCallback(() => setInstallOpen(true), []);

  // Tours and the Help sheet belong to a team's pages, but the ? sits in this top bar
  const teamParam = Number(useParams().teamId);
  const teamId = Number.isInteger(teamParam) && teamParam > 0 ? teamParam : null;

  return (
    <PushContext.Provider value={{ push, openInstall, audience: "coach" }}>
      <TourProvider teamId={teamId} initialSeen={loaderData.toursSeen}>
        <div className={cx("min-h-dvh bg-canvas text-ink", workspace && "lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden")}>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised"
          >
            Skip to content
          </a>
          <header className="relative z-30 shrink-0 border-b border-line bg-surface pt-[var(--safe-top)]">
            <nav className="flex h-14 items-center justify-between px-safe">
              <Link to="/" aria-label="BenchTalk home">
                <AppMark />
              </Link>

              <div className="flex items-center gap-1">
                <HelpButton className="mr-1" />
                <NotificationsMenu push={push} onInstall={openInstall} audience="coach" />
                <AccountMenu
                  me={user}
                  settingsTo="/dashboard/account"
                  links={loaderData.isParent ? [{ to: "/family", label: "Family view", icon: UsersThree }] : []}
                />
              </div>
            </nav>
          </header>

          <PullToRefresh />

          <main id="main" className={cx(workspace && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col")}>
            <Outlet />
          </main>

          {installOpen && <InstallSheet platform={loaderData.platform} openOnLoad={false} onClose={() => setInstallOpen(false)} />}
          {/* Once per phone, as soon as it can say yes (on iPhone: first launch from the Home Screen) */}
          <NotifyPrompt push={push} audience="coach" />
        </div>
      </TourProvider>
    </PushContext.Provider>
  );
}
