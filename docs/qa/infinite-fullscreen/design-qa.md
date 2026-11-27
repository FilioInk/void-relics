# Infinite flight: clean screen and a full-screen button

No mock-up to match; the brief was "remove the debug info from infinite flight, add a small
full-screen icon in the bottom-right corner". Checked in the desktop app's browser pane.

| Image | What it shows |
| --- | --- |
| `before-phone.jpg` | Live site before the change: the place name ("DEEP SPACE") over the scene and the key hint along the bottom. |
| `after-phone.jpg` | Same moment after: only the flight and the button in the corner. Taken with `?perf=1`, whose readout is hidden here too. |
| `after-desktop.jpg` | 1280×800, mouse just moved: the button sits 16 px from the bottom-right corner. |
| `button-hover.png` | The button under the pointer: accent colour and border, like the menu buttons. |
| `after-desktop-idle.jpg` | 2.5 s after the mouse stopped: the button (and the cursor) have faded out. |

Checks:

- The button is 36×36 px, in the HUD's colours (`--ink`, `--faint`, `--accent`) on
  a dark translucent background. The icon is drawn inline as an SVG, so the game still ships
  no image files.
- It fades in within 0.2 s on any pointer move or tap and out over 0.8 s. While faded it does
  not catch clicks: the first tap on a touch screen only brings it back.
- The tooltip and `aria-label` read "Full screen" or "Exit full screen", following the real
  state, including when Esc leaves full screen.
- The button is hidden where the browser has no Fullscreen API (iPhone Safari).
- Not verified: actually entering full screen. The app's browser pane refuses
  `requestFullscreen` ("Permissions check failed"). The code reaches the call and absorbs the
  refusal, and the unit tests cover entering, leaving, the Safari fallback and the refusal.
