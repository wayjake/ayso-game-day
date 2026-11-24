// BenchTalk logomark: a bench whose backrest is a speech bubble. Same path as public/favicon.svg
// and the brand guide's Logos files.
const MARK_PATH =
  "M16 7L48 7Q56 7 56 15L56 24Q56 32 48 32Q44 36 38 39L55 39Q59 39 59 43Q59 47 55 47L52 47L52 54Q52 58 48 58Q44 58 44 54L44 47L20 47L20 54Q20 58 16 58Q12 58 12 54L12 47L9 47Q5 47 5 43Q5 39 9 39L10 39L14 32Q8 30 8 24L8 15Q8 7 16 7ZM22 32L18 39L31 39Q35 36 35 32Z";

// The logo tile: white bench on primary, the same geometry as benchtalk-mark.svg and the app icon
export function BenchTalkTile({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden className={`shrink-0 ${className}`}>
      <rect width="64" height="64" rx="16" className="fill-primary" />
      <path fill="#fff" fillRule="evenodd" transform="translate(6.779 6.385) scale(0.788)" d={MARK_PATH} />
    </svg>
  );
}

// Logo: the tile, then "Bench" in ink and "Talk" in primary.
// Light grounds only: the two-tone wordmark doesn't go on a dark background.
export function AppMark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <BenchTalkTile />
      <span className="font-display text-xl font-bold tracking-tight text-ink">
        Bench<span className="text-primary">Talk</span>
      </span>
    </span>
  );
}
