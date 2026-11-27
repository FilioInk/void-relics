# Start menu: the name across the screen, two ways to play, settings behind a link

The brief, from the owner in chat:
- The menu's contents go behind a separate Settings item.
- Two buttons: collecting relics and infinite flight.
- The game's name in thin, large letters across the full width of the screen.

Follow-ups in the same conversation:
- The letters are white, in the typeface of the place names, in a thin cut.
- The buttons are transparent.

Checked in the desktop app's browser pane.

| Image | What it shows |
| --- | --- |
| `before-desktop.jpg` | The old menu: a card with the name, three buttons, the controls list and all settings. |
| `after-desktop.jpg` | 1280×720. The name spans the width, with the tagline under it and the ship in the middle. Two transparent buttons and SETTINGS sit at the bottom. |
| `after-settings.jpg` | SETTINGS opens a card: the galaxy number and New galaxy, the controls list, and the sound and mouse settings. Back, Esc or a click outside the card returns. |
| `after-phone.jpg` | 375×812. The name still spans the width, the buttons stack, and the mouse-and-keyboard notice sits under SETTINGS. |

Checks:

- **Typeface.** The name is Exo 2, the place names' typeface, in its Thin cut (weight 100,
  now loaded from Google Fonts alongside 300–800). It is coloured `--ink` with the same dark
  halo as the place names.
- **Width.** The name is an SVG `<text>` with `textLength`, so its letter spacing stretches it
  edge to edge (3vw side margins) at any window size. If the web font fails to load, the
  fallback font is stretched the same way.
- **Layout.** The name and tagline sit at the top and the buttons at the bottom, so the ship
  the menu camera circles stays visible between them. In the first, centred layout the
  tagline sat on the engine glow. The tagline has a dark halo, so it stays readable when the
  star passes behind it.
- **Buttons.** Both are transparent with a thin white border; hovering brightens the border
  and adds a faint fill. With relics found, the first reads "Collect relics — 4/20".
- **Settings.** Changing a setting re-renders the screen and stays in Settings; the change is
  saved as before. Esc, Back and a click outside the card all return to the title.
- **Pause screen.** It still shows the controls and settings directly. The brief was about
  the start menu.
