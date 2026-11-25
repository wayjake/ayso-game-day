import { useEffect, useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import { Form, Link, useLocation } from "react-router";
import { GearSix, SignOut, type IconProps } from "@phosphor-icons/react";
import { PersonAvatar } from "~/components/PersonAvatar";
import { cx } from "~/components/ui";

// Your avatar at the top right of every signed-in page. Tap it for your
// account settings, switching between the coach and family views, and
// logging out. Portalled like NotificationsMenu, since the family header's
// backdrop blur would trap fixed layers inside it.

export type AccountMenuLink = { to: string; label: string; icon: ComponentType<IconProps> };

export function AccountMenu({
  me,
  settingsTo,
  links = [],
}: {
  me: { id: number; name: string | null; email: string; avatarUrl?: string | null };
  settingsTo: string;
  links?: AccountMenuLink[];
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, right: 12 });
  const trigger = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  const name = me.name?.trim() || me.email.split("@")[0];

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const item =
    "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-ink transition hover:bg-surface-2";

  return (
    <div className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          if (!open && trigger.current) {
            const rect = trigger.current.getBoundingClientRect();
            const bottom = trigger.current.closest("header")?.getBoundingClientRect().bottom ?? rect.bottom;
            setPosition({ top: bottom + 8, right: Math.max(12, window.innerWidth - rect.right) });
          }
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={`Account: ${name}`}
        className={cx(
          "flex size-11 items-center justify-center rounded-full transition hover:bg-surface-2",
          open && "bg-surface-2",
        )}
      >
        <PersonAvatar person={{ ...me, name }} size="md" />
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)}>
            <div
              role="menu"
              aria-label="Account"
              className="fixed z-50 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl bg-surface p-2 shadow-overlay ring-1 ring-line"
              style={position}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 px-3 pt-2 pb-3">
                <PersonAvatar person={{ ...me, name }} size="lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{name}</p>
                  <p className="truncate text-xs text-muted">{me.email}</p>
                </div>
              </div>
              <div className="border-t border-line pt-1">
                <Link to={settingsTo} role="menuitem" className={item}>
                  <GearSix size={20} className="text-muted" aria-hidden />
                  Account settings
                </Link>
                {links.map(({ to, label, icon: Icon }) => (
                  <Link key={to} to={to} role="menuitem" className={item}>
                    <Icon size={20} className="text-muted" aria-hidden />
                    {label}
                  </Link>
                ))}
              </div>
              <div className="mt-1 border-t border-line pt-1">
                <Form action="/user/logout" method="post">
                  <button type="submit" role="menuitem" className={item}>
                    <SignOut size={20} className="text-muted" aria-hidden />
                    Log out
                  </button>
                </Form>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
