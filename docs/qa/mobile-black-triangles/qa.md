# Black triangles over the sky on an Android phone

The report, from the owner in chat: on a phone, in Chrome, a grid of black triangles runs across
the whole screen, and it shows up when the view turns.

Phone: Mali-G615 MC2, ANGLE on OpenGL ES 3.2, Chrome 158 on Android. It has `EXT_clip_control`,
so the game runs with the reversed depth buffer. The frames below were read straight out of the
game's canvas on that phone and sent to a dev server on the Mac over Wi-Fi, one a second, while
the owner flew and turned.

| Image | What it shows |
| --- | --- |
| `before-staircase.jpg` | Before. The sky glow is cut off by a black area with a stair-step edge; stars, ship and smoke on top of it draw normally. |
| `before-triangles.jpg` | Before. A grid of black triangles and strips over the sky glow, behind the ship. |
| `after-turning.jpg` | After, flying at an asteroid cluster with speed streaks: the sky glow is whole. |
| `after-nebula.jpg` | After, infinite flight with the camera off to the side of the ship: the sky glow is whole. |

Before the fix, 9 of the first 48 frames had the black pieces; after it, none of 96 frames
across the menu, the relic hunt and infinite flight did.

On a desktop GPU the picture does not change. Captures of `__vr.spot('nebula')` at a pinned clock
with and without the fix differ in 328 pixels, by at most 17 of 255, which is exactly how much
two loads of the same build differ from each other.
