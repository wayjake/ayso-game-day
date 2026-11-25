import type { Route } from "./+types/changelog";
import { data } from "react-router";
import { getUser } from "~/utils/auth.server";
import { releases, type ChangeKind } from "~/utils/changelog";
import { AppMark } from "~/components/AppMark";
import { Badge, buttonClass, cx } from "~/components/ui";

export async function loader({ request }: Route.LoaderArgs) {
  const user = await getUser(request, false);
  return data({ isLoggedIn: !!user });
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "What's new - BenchTalk" },
    { name: "description", content: "Everything new in BenchTalk, release by release." },
  ];
}

const container = "mx-auto w-full max-w-3xl px-safe";

const kindBadge: Record<ChangeKind, { label: string; tone: "primary" | "success" | "warning" }> = {
  new: { label: "New", tone: "primary" },
  improved: { label: "Improved", tone: "success" },
  fixed: { label: "Fixed", tone: "warning" },
};

// Dates are calendar days, so format them without a time zone shift
function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function Changelog({ loaderData }: Route.ComponentProps) {
  const { isLoggedIn } = loaderData;

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="sticky top-0 z-50 border-b border-line bg-surface/90 pt-[var(--safe-top)] backdrop-blur">
        <nav className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-4 px-safe">
          <a href="/" aria-label="BenchTalk home">
            <AppMark />
          </a>
          {isLoggedIn ? (
            <a className={buttonClass({ size: "sm" })} href="/dashboard">Go to your team</a>
          ) : (
            <a className={buttonClass({ variant: "ghost", size: "sm" })} href="/user/login">Sign in</a>
          )}
        </nav>
      </header>

      <main className={cx(container, "py-12 sm:py-16")}>
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">Changelog</p>
        <h1 className="mt-1 font-display text-4xl font-bold tracking-tight">What's new</h1>
        <p className="mt-3 text-lg text-muted">Everything we've added and fixed in BenchTalk, newest first.</p>

        <ol className="mt-12 space-y-14">
          {releases.map((release) => (
            <li key={`${release.date}-${release.title}`} className="grid grid-cols-1 gap-4 sm:grid-cols-[9rem_minmax(0,1fr)] sm:gap-8">
              <time dateTime={release.date} className="text-sm font-medium text-muted sm:pt-1.5">
                {formatDate(release.date)}
              </time>
              <article>
                <h2 className="font-display text-2xl font-bold tracking-tight">{release.title}</h2>
                <p className="mt-1 text-muted">{release.summary}</p>
                <ul className="mt-5 space-y-3">
                  {release.changes.map((change) => (
                    <li key={change.text} className="flex items-start gap-3">
                      <Badge tone={kindBadge[change.kind].tone} className="mt-0.5 w-20 shrink-0 justify-center">
                        {kindBadge[change.kind].label}
                      </Badge>
                      <span className="text-[15px] leading-relaxed">{change.text}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </li>
          ))}
        </ol>
      </main>

      <footer className="border-t border-line bg-surface py-8">
        <div className={cx(container, "flex flex-wrap items-center justify-between gap-4 text-sm text-muted")}>
          <AppMark />
          <a className="transition hover:text-ink" href="/">Back to home</a>
        </div>
      </footer>
    </div>
  );
}
