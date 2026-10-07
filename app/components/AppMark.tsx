import { SoccerBall } from "@phosphor-icons/react";

// Logo: brand-red tile with a ball, plus the wordmark
export function AppMark({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-white shadow-card">
        <SoccerBall size={20} weight="fill" />
      </span>
      <span className="font-display text-xl font-bold tracking-tight">
        AYSO <span className="text-muted">Game Day</span>
      </span>
    </span>
  );
}
