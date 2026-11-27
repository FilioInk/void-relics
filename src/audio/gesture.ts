/**
 * Input that browsers accept as the player asking for sound. Which of them counts differs:
 * Chrome takes a key or a press, Safari on iOS only the end of a tap, so all of them are heard.
 */
export const SOUND_GESTURES = ['pointerdown', 'pointerup', 'touchend', 'keydown', 'click'] as const;

/**
 * Calls `start` on every gesture that may start sound, from the first one on the title screen.
 * Listens in the capture phase, so a control that stops the event still counts. `start` must be
 * cheap once sound runs: it is called for every key and press of the game. Returns a function
 * that stops listening.
 */
export function onSoundGesture(target: EventTarget, start: () => void): () => void {
  const listener = (): void => start();
  for (const type of SOUND_GESTURES) target.addEventListener(type, listener, { capture: true });
  return () => {
    for (const type of SOUND_GESTURES) target.removeEventListener(type, listener, { capture: true });
  };
}
