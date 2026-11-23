import { useOutletContext } from "react-router";
import type { PushState } from "~/hooks/usePush";

/** What the family layout hands its pages: the one push state, so the header bell and Settings agree. */
export type FamilyContext = { push: PushState; openInstall: () => void };

export function useFamily() {
  return useOutletContext<FamilyContext>();
}
