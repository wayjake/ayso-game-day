// The installed iPhone app's launch images: what iOS shows while the first page
// loads, instead of a blank screen. iOS only uses one whose size matches the
// screen exactly, so there's one per iPhone screen (portrait) and two per iPad, made by
// scripts/launch-images/build.sh into public/launch/. Keep the two lists in step.
// iOS saves these when the app is added to the Home Screen: re-add it to see a change.

// [width, height] are the portrait CSS size, as iOS's media query sees them in
// either orientation. iPads open in either orientation, so they get both images.
const SCREENS: [width: number, height: number, ratio: number, ipad?: true][] = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [420, 912, 3], // Air
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [414, 736, 3], // 6 Plus to 8 Plus
  [375, 667, 2], // 6 to 8, SE (2nd and 3rd)
  [320, 568, 2], // SE (1st)
  [1032, 1376, 2, true], // iPad Pro 13" (M4)
  [1024, 1366, 2, true], // iPad Pro 12.9", iPad Air 13"
  [834, 1210, 2, true], // iPad Pro 11" (M4)
  [834, 1194, 2, true], // iPad Pro 11", iPad Air 11"
  [820, 1180, 2, true], // iPad Air (4th, 5th), iPad (10th, A16)
  [834, 1112, 2, true], // iPad Air (3rd), iPad Pro 10.5"
  [810, 1080, 2, true], // iPad (7th to 9th)
  [744, 1133, 2, true], // iPad mini (6th, A17 Pro)
  [768, 1024, 2, true], // iPad mini (5th), older 9.7" iPads
];

const link = (w: number, h: number, r: number, orientation: "portrait" | "landscape") => {
  const [pw, ph] = orientation === "portrait" ? [w * r, h * r] : [h * r, w * r];
  return {
    rel: "apple-touch-startup-image",
    href: `/launch/launch-${pw}x${ph}.png`,
    media: `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: ${orientation})`,
  };
};

export const launchImageLinks = SCREENS.flatMap(([w, h, r, ipad]) =>
  ipad ? [link(w, h, r, "portrait"), link(w, h, r, "landscape")] : [link(w, h, r, "portrait")]
);
