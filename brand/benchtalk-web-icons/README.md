# BenchTalk web icon pack

| Destination | Files |
| --- | --- |
| Browser tabs and bookmarks | `favicon.svg` (indigo in light mode, white in dark mode), `favicon.ico` (16, 32, and 48 px), and individual PNGs at those sizes |
| Installed web app | `icons/app-192.png` and `icons/app-512.png` |
| Adaptive launcher shapes | `icons/app-maskable-512.png` with extra space for cropping |
| iPhone and iPad home screen | `apple-touch-icon.png` (180 px) |
| App icon source | `source/app-icon.svg` and `source/app-icon-1024.png` |

## Connect the icons

Copy the web assets to the site's public root, keeping the `icons/` folder. Add these links to the page head.

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180">
<link rel="manifest" href="/site.webmanifest">
```

For an existing PWA, merge the icon entries into its current manifest and resolve their paths relative to that manifest. For a site hosted under a subpath, prefix the HTML links with that subpath. The included manifest uses its own directory as the app's start URL. The `source/` folder is for design and export.

[Browser icon links](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/link) · [Apple touch icons](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) · [PWA maskable icons](https://web.dev/articles/maskable-icon)
