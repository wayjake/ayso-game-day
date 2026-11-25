import { useEffect } from "react";
import { useLocation } from "react-router";

// Page transitions, the way a phone app moves between screens: tabs cross-fade,
// opening something slides it in from the right, going back slides it away.
// React Router runs the View Transition; the direction lives on
// <html data-nav="..."> and app.css ("Page transitions") picks the animation.
//
// Back and forward from the browser or iOS's edge swipe animate nothing (iOS
// already draws its own slide), unless our own back button started it.

export type NavMotion = "tab" | "push" | "back";

// Set by our own links just before they navigate, so a popstate can tell ours from the browser's
let ours = false;

export function setNavMotion(motion: NavMotion) {
  document.documentElement.dataset.nav = motion;
  ours = true;
}

/** Spread onto a <Link>/<NavLink>: `<Link to="..." {...navMotion("push")}>` */
export function navMotion(motion: NavMotion) {
  return {
    viewTransition: true,
    onClick: () => setNavMotion(motion),
  } as const;
}

/** Once, in the root component */
export function useNavMotion() {
  const { key } = useLocation();

  useEffect(() => {
    const onPop = () => {
      if (!ours) document.documentElement.dataset.nav = "none";
      ours = false;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // A navigation finished: whatever comes next has to say its own direction
  useEffect(() => {
    ours = false;
  }, [key]);
}
