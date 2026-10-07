import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeft } from "@phosphor-icons/react";
import { getImageUrl } from "~/utils/image";
import { formatGameDate } from "~/utils/dates";

// Shared building blocks. Colors come from the tokens in app.css.

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Buttons. Use <Button> for buttons, or buttonClass() on a <Link>/<a>.

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-soft";
type ButtonSize = "sm" | "md" | "lg" | "icon-sm" | "icon";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white shadow-card hover:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-2",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink",
  danger: "bg-danger text-white shadow-card hover:brightness-95",
  "danger-soft": "text-danger hover:bg-danger-soft",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
  "icon-sm": "h-9 w-9 text-sm",
  icon: "h-10 w-10 text-sm",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}

// ---------------------------------------------------------------------------
// Surfaces

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("rounded-2xl bg-surface shadow-card ring-1 ring-line/70", className)} {...props} />;
}

export function CardHeader({
  title,
  count,
  actions,
  className,
}: {
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-center justify-between gap-4", className)}>
      <h2 className="text-base font-semibold">
        {title}
        {count !== undefined && <span className="ml-1.5 font-normal text-subtle tabular">{count}</span>}
      </h2>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badges: small square labels for status and metadata

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  primary: "bg-primary-soft text-primary-ink",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"span"> & { tone?: BadgeTone }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold",
        badgeTones[tone],
        className
      )}
      {...props}
    />
  );
}

export function HomeAwayBadge({ homeAway }: { homeAway: string | null }) {
  if (!homeAway) return null;
  return <Badge tone={homeAway === "home" ? "success" : "neutral"}>{homeAway === "home" ? "Home" : "Away"}</Badge>;
}

// ---------------------------------------------------------------------------
// Page header: title, optional description, actions on the right, optional back link

export function PageHeader({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { to: string; label: string };
  className?: string;
}) {
  return (
    <header className={cx("mb-6", className)}>
      {back && (
        <Link
          to={back.to}
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted transition hover:text-ink"
        >
          <ArrowLeft size={16} weight="bold" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {description && <p className="mt-1 max-w-prose text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

// Page body container: same gutters and max width everywhere
export function Page({
  width = "wide",
  className,
  ...props
}: ComponentProps<"div"> & { width?: "wide" | "narrow" }) {
  return (
    <div
      className={cx(
        "mx-auto w-full px-4 pt-6 pb-16 sm:px-6 sm:pt-8",
        width === "wide" ? "max-w-7xl" : "max-w-2xl",
        className
      )}
      {...props}
    />
  );
}

// Calendar-style date block for game lists ("OCT / 17")
export function DateTile({ iso, className }: { iso: string; className?: string }) {
  return (
    <div className={cx("flex w-12 shrink-0 flex-col items-center rounded-lg bg-surface-2 py-1 ring-1 ring-line", className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
        {formatGameDate(iso, { month: "short" })}
      </span>
      <span className="font-display text-xl font-bold leading-none tabular">{formatGameDate(iso, { day: "numeric" })}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col items-center px-6 py-12 text-center", className)}>
      {icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-semibold">{title}</h3>
      {children && <p className="mt-1 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// "Ava Martinez" -> "AM", "Kai" -> "K"
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.[0] ?? "";
  return letters.toUpperCase();
}

// ---------------------------------------------------------------------------
// Player avatar: photo if there is one, otherwise jersey number or initial

const avatarSizes = {
  sm: "h-8 w-8 text-xs rounded-lg",
  md: "h-10 w-10 text-sm rounded-xl",
  lg: "h-14 w-14 text-lg rounded-2xl",
};

export function PlayerAvatar({
  player,
  size = "md",
  className,
}: {
  player: { name: string; profilePicture?: string | null; jerseyNumber?: number | null };
  size?: keyof typeof avatarSizes;
  className?: string;
}) {
  const src = getImageUrl(player.profilePicture);
  if (src) {
    return <img src={src} alt={player.name} className={cx("object-cover ring-1 ring-line", avatarSizes[size], className)} />;
  }
  return (
    <div
      aria-hidden
      className={cx(
        "flex shrink-0 items-center justify-center bg-surface-2 font-display font-bold text-muted tabular ring-1 ring-line",
        avatarSizes[size],
        className
      )}
    >
      {player.jerseyNumber ?? initials(player.name)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields

export const inputClass =
  "block w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-subtle transition focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-surface-2 disabled:text-muted";

export const labelClass = "mb-1.5 block text-sm font-medium text-ink";

export const hintClass = "mt-1.5 text-xs text-muted";

export function Alert({
  tone = "danger",
  className,
  ...props
}: ComponentProps<"div"> & { tone?: "danger" | "success" | "warning" | "primary" }) {
  const tones = {
    danger: "bg-danger-soft text-danger",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    primary: "bg-primary-soft text-primary-ink",
  };
  return <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg px-4 py-3 text-sm font-medium", tones[tone], className)} {...props} />;
}

export { cx };
