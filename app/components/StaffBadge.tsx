import { ClipboardText, SoccerBall } from "@phosphor-icons/react";
import { Badge, cx } from "~/components/ui";
import { staffRoleLabel, type StaffRole } from "~/utils/team-roles";

const icons = {
  coach: SoccerBall,
  "assistant-coach": SoccerBall,
  "team-manager": ClipboardText,
} satisfies Record<StaffRole, unknown>;

// A person's role on the team staff, shown next to their name wherever
// families and other staff see it (messages, Settings, Families).
export function StaffBadge({ role, short = false, className }: { role: StaffRole; short?: boolean; className?: string }) {
  const Icon = icons[role];
  const label = short && role === "assistant-coach" ? "Asst. coach" : staffRoleLabel(role);
  return (
    <Badge tone={role === "team-manager" ? "success" : "primary"} className={cx("shrink-0", className)}>
      <Icon size={12} weight="fill" aria-hidden />
      {label}
    </Badge>
  );
}
