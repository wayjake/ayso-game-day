import { createContext, useContext } from "react";
import type { PushState } from "~/hooks/usePush";

// The one push state per layout (dashboard or family app), so the header
// bell, the one-time prompt and the settings page always agree. Nested
// layouts (team.tsx) don't forward outlet context, so this is a React context.

export type PushContextValue = {
  push: PushState;
  openInstall: () => void;
  /** Coaches also see coach-only kinds (players dropping out) */
  audience: "family" | "coach";
};

export const PushContext = createContext<PushContextValue | null>(null);

export function usePushContext() {
  const value = useContext(PushContext);
  if (!value) throw new Error("usePushContext needs a PushContext provider (dashboard or family layout)");
  return value;
}
