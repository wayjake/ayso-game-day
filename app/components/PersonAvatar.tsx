import { cx } from "~/components/ui";

// A person's avatar: their photo when there is one, otherwise their initials
// on a gradient picked from their user id, so the same person always looks
// the same everywhere (header, feed, comments) without uploading anything.

const sizes = {
  sm: "size-7 text-[11px]",
  md: "size-9 text-xs",
  lg: "size-12 text-base",
  xl: "size-16 text-xl",
};

// Whole class strings so Tailwind sees them. Each pair is dark enough at both
// ends for white initials.
const gradients = [
  "from-primary to-primary-ink",
  "from-pitch to-pitch-dark",
  "from-coral to-coral-ink",
  "from-primary to-pitch",
  "from-coral-ink to-primary-ink",
  "from-pitch-dark to-primary",
  "from-warning to-coral-ink",
  "from-primary-ink to-pitch",
];
const directions = ["bg-linear-to-br", "bg-linear-to-tr", "bg-linear-to-bl", "bg-linear-to-tl"];

/** A well-spread number from the id (a UUID), so the colour is stable per person */
function seed(id: string) {
  // FNV-1a over the id's characters
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.imul(h ^ 0x5bd1e995, 2654435761) >>> 0;
}

export function avatarInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0][0]).toUpperCase();
}

export function PersonAvatar({
  person,
  size = "md",
  className,
}: {
  person: { id: string; name: string; avatarUrl?: string | null };
  size?: keyof typeof sizes;
  className?: string;
}) {
  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt=""
        className={cx("shrink-0 rounded-full object-cover ring-1 ring-line", sizes[size], className)}
      />
    );
  }
  const n = seed(person.id);
  return (
    <span
      aria-hidden
      className={cx(
        "grid shrink-0 select-none place-items-center rounded-full font-bold text-white",
        directions[n % directions.length],
        gradients[(n >>> 2) % gradients.length],
        sizes[size],
        className,
      )}
    >
      {avatarInitials(person.name)}
    </span>
  );
}
