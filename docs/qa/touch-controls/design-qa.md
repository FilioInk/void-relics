# Touch controls for phones and tablets

The brief: make the game playable on a phone or tablet. A stick or drag zone to steer, buttons
for thrust (hold), brake, boost and fire, map and pause out of the HUD's way, multi-touch,
portrait and landscape, and tap targets for infinite flight. No mock-up to match.

Checked in the desktop app's browser pane. Portrait is the `mobile` preset (375×812, touch
emulated: `pointer: coarse`, five touch points). The pane only emulates touch below 768 px, so
landscape (812×375) was checked with the touch layout forced on by `__vr.touch(true)`; at that
size without it the game shows the desktop controls, as it should.

| Image | What it shows |
| --- | --- |
| `portrait-menu.jpg` | 375×812 start menu. The "played with a mouse and keyboard" notice is gone. |
| `portrait-flight.jpg` | 375×812 in flight, three fingers down: the stick pushed up-right (the HUD cursor and steering line follow it), THRUST and FIRE held (lit), 229 m/s, gun heat bar rising. |
| `portrait-map.jpg` | The map button opened the system map; it turns into a close (✕) button, pause stays next to it. |
| `portrait-pause.jpg` | The pause button: the card lists the touch controls, says "Tap to continue" and "Stick sensitivity". |
| `landscape-menu.jpg` | 812×375 start menu, buttons side by side. |
| `landscape-flight.jpg` | 812×375 in flight, stick, THRUST and FIRE held. The flight panel fits between the stick and the buttons. |
| `landscape-infinite.jpg` | Infinite flight on touch: back (top-left), camera and full screen (bottom-right), all 44 px. |

## Layout

- **Stick.** The left half of the screen is the stick's zone. A thumb lands anywhere there and
  the stick centres under it; it rests faintly in the lower-left corner as a hint. The knob
  travels 52 px; the first 14 % is a dead zone, past the rim it stays at full. It sets the same
  steering cursor the mouse sets, so the HUD's cursor ring and line show where the nose is
  heading. Let go and it recentres (the mouse cursor stays put; a thumb cannot).
- **Buttons.** An arc around the right thumb: FIRE (88 px) in the corner, THRUST (64 px) to its
  left, BOOST (56 px) above it, BRAKE (52 px) on the diagonal between. Each wears the colour the
  HUD already uses for the same thing: white throttle bar, amber reverse, pink BOOST tag, red
  aim cross. Held, a button fills and glows.
- **Map and pause.** 44 px squares in the top-right corner. The galaxy label and salvage count
  move down under them; the key hints and the map's "M — close the map" are hidden on touch.
- **Portrait.** The flight panel stays at the bottom edge (in the home-indicator zone, where
  nothing needs a tap) and the stick and buttons lift 64 px above it.
- **Landscape.** The flight panel shrinks to the narrow-window size and sits between the stick
  and the buttons. Measured at 812×375: stick 38–162 px, panel 249–563 px, THRUST from 618 px.

## Multi-touch

Every finger is tracked by its `pointerId` (`TouchRouter`, `src/game/touch.ts`). Checked in the
pane with synthetic touch pointers:

- Stick, THRUST and FIRE held at once by three pointers: the cursor moved up-right, the speed
  reached 197 m/s and the gun heat rose. Releasing all three recentred the stick and the ship
  coasted to a stop.
- A second finger on the stick is turned away; the first keeps steering.
- A tap on THRUST (under 240 ms) latches it on (dashed ring) and the ship cruises at 249 m/s
  with no thumb on it, leaving the right thumb free for FIRE. The next press of THRUST, or BRAKE,
  lets it go. A longer press is a plain hold, like W. This is a choice beyond the brief: with
  only two thumbs, steering, thrust and fire at once is otherwise impossible.
- BRAKE drops the latch and reverses (amber throttle bar).
- Pausing, opening the map, dying, switching tabs or losing focus lets go of every finger and
  stops the engine.
- The controls have `touch-action: none` and cancel `pointerdown`, so the page neither scrolls
  nor zooms and the browser's made-up mouse events do not fire the guns. Long-press menus are
  blocked.
- Clicked with the pane's mouse: the map, close and pause buttons and the infinite-flight back
  and camera buttons all work (a first tap on an idle infinite-flight screen only wakes the
  buttons, as before).

## Desktop

Unchanged: at 1024×768 the touch layer is hidden, the mouse steers and fires, the key hints
show, and the infinite-flight full-screen button is still 36 px at 16 px from the corner with
no extra buttons. If a tablet gains a trackpad (`pointer: coarse` stops matching) the game
switches to the desktop controls live.

## Not verified

- On a real phone. Everything above is the browser pane's touch emulation and synthetic
  pointers; real fingers, iOS Safari's gestures and the notch's safe areas were not tried.
- Roll and strafe have no buttons (optional in the brief); a keyboard paired to a tablet still
  has them.
