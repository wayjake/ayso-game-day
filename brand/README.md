# BenchTalk brand files

Source artwork for the logo and icons. Nothing in this folder is served; the live icons are in `public/`.

The brand guide (colors, type, voice, logo rules) lives in a Design System artifact:
https://claude.ai/artifact/H6v9fa4PmVBCpRXgnxiudc

## Final files, on primary blue (#2251C4)

These match the brand guide's Logos group.

| File | Use |
| --- | --- |
| `benchtalk-mark.svg` | The logo: white bench on a rounded `primary` tile |
| `benchtalk-mark-ink.svg` | The same on an `ink` tile, for one-colour and dark contexts |
| `benchtalk-glyph.svg` | The bench alone in `primary`, for favicons and small sizes |
| `benchtalk-app-icon.svg` | Full-bleed 1024px square, the source of every app and Home Screen icon |
| `benchtalk-lockup.svg` | Tile plus the Barlow wordmark, "Bench" in ink and "Talk" in primary |

## Original pack (indigo #4338CA)

`benchtalk-logomark/` and `benchtalk-web-icons/` are the pack as delivered, kept for reference. The app does not use the indigo: the icons in `public/` were re-rendered from the same mark path on `#2251C4` with identical geometry, so the icon matches the app's buttons. The pack's lockup sets the name in a different typeface from the app header; the app and guide use Barlow Semi Condensed.

## Re-exporting the icons

Every icon in `public/` is drawn from the mark path in `benchtalk-glyph.svg`:

- App icons (`icons/app-192.png`, `icons/app-512.png`, `apple-touch-icon.png`): `benchtalk-app-icon.svg` at that size. Opaque and full-bleed; the platform rounds the corners.
- Maskable icon (`icons/app-maskable-512.png`): the same square with the mark scaled to `translate(168.5 163.1) scale(10.7)` on the 1024 canvas, so it stays inside the 80% safe circle.
- Favicons: `favicon.svg` is the glyph (white in dark mode); `favicon.ico` holds 16, 32 and 48px PNGs of it on a clear ground.
