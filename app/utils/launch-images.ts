// The installed iPhone app's launch images: what iOS shows while the first page
// loads, instead of a blank screen. iOS only uses one whose size matches the
// screen exactly, so there's one per iPhone screen (portrait), made by
// scripts/launch-images/build.sh into public/launch/. Keep the two lists in step.
// iOS saves these when the app is added to the Home Screen: re-add it to see a change.

const SCREENS: [width: number, height: number, ratio: number][] = [
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
];

export const launchImageLinks = SCREENS.map(([w, h, r]) => ({
  rel: "apple-touch-startup-image",
  href: `/launch/launch-${w * r}x${h * r}.png`,
  media: `screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
}));
