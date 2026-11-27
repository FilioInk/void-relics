# Screen kept on in full screen, a music button in infinite flight, Install app in the menu

The brief, from the owner in chat:
- In full screen the phone must not turn its screen off.
- Infinite flight gets an icon that switches the music on and off.
- A separate menu item installs the game on a phone or a computer as a PWA, the way the Pocket
  games (Pocket Draft) do it.

Checked in the desktop app's browser pane against the built game (`npm run build`, then
`vite preview`), at 1280×720 and at 375×812 with touch emulated.

| Image | What it shows |
| --- | --- |
| `menu-desktop.jpg` | 1280×720. INSTALL APP sits next to SETTINGS under the two buttons, in the same quiet link style. Also the new `docs/screenshots/menu.jpg`. |
| `menu-phone.jpg` | 375×812. The two links share one row under the stacked buttons. |
| `install-desktop.jpg` | A browser without an install dialog (the pane itself): the card says what installing gives and how to do it from the browser's menu, or from the address bar's install icon in Chrome and Edge. |
| `install-iphone.jpg` | The same card on an iPhone (user agent stood in): Share menu, then Add to Home Screen. |
| `infinite-desktop.jpg` | Infinite flight on a computer: the note button left of the full-screen button. |
| `infinite-phone-music-off.jpg` | Infinite flight on a phone with the music off: camera, the struck-through note (dimmed), full screen; back top-left. |

Checks:

- **Install, Chrome's way.** With a stand-in `beforeinstallprompt`: the event's
  `preventDefault()` was called (the browser's own install bar is held back), a tap on INSTALL
  APP called its `prompt()` and opened no card, and `appinstalled` took INSTALL APP out of the
  menu. The pane never fires the real event, so the real dialog was not seen here.
- **Install, everywhere else.** The card opens with Back, Esc or a click outside to leave, like
  Settings. iPhone / iPad: Share → Add to Home Screen; Safari on a Mac: File → Add to Dock;
  any other browser: its menu's install item.
- **Not inside the app.** In display mode standalone or fullscreen, or with iOS's
  `navigator.standalone`, the menu has no INSTALL APP (unit tests).
- **Manifest and icons.** `dist/` has `manifest.webmanifest` (display fullscreen, falling back
  to standalone; night-blue background), the 192 and 512 icons, a maskable 512 and the Apple
  touch icon, drawn from the favicon's mark by `scripts/icons.mjs`.
- **Offline.** After one visit the service worker held the page, its script and stylesheet, the
  manifest and the icons. With the preview server stopped, `/?seed=42` still loaded the game to
  its menu.
- **Music button.** A click and M both flip the same Music setting as the menu and save it
  (`void-relics:settings`); the icon and its label follow ("Turn the music off" / "on",
  `aria-pressed`). On a phone a tap does the same. It fades out with the other buttons while
  the pointer rests, like before.
- **Wake lock.** Entering full screen made the game ask for `navigator.wakeLock.request('screen')`
  (seen by wrapping the call); the pane itself denies the permission (`NotAllowedError`), which
  the game swallows. Holding, releasing on leaving full screen, and asking again after the page
  was hidden are covered by unit tests with a stand-in browser. Not seen on a real phone.
