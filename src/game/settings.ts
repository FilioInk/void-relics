export type Settings = {
  music: boolean;
  /** 0..1 of the full music level. */
  musicVolume: number;
  sound: boolean;
  sensitivity: number;
  invertY: boolean;
};

/** Music out of the box plays 10% under its full level. */
export const DEFAULT_MUSIC_VOLUME = 0.9;

export const SETTINGS_KEY = 'void-relics:settings';

export function defaultSettings(): Settings {
  return { music: true, musicVolume: DEFAULT_MUSIC_VOLUME, sound: true, sensitivity: 1, invertY: false };
}

/** Saved settings, field by field: one broken value does not throw the rest away. */
export function parseSettings(raw: string | null, fallback: Settings): Settings {
  if (!raw) return { ...fallback };
  let d: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return { ...fallback };
    d = v as Record<string, unknown>;
  } catch {
    return { ...fallback };
  }
  const sens = typeof d['sensitivity'] === 'number' && Number.isFinite(d['sensitivity']) ? Math.min(2.5, Math.max(0.3, d['sensitivity'])) : fallback.sensitivity;
  const vol = typeof d['musicVolume'] === 'number' && Number.isFinite(d['musicVolume']) ? Math.min(1, Math.max(0, d['musicVolume'])) : fallback.musicVolume;
  return {
    music: typeof d['music'] === 'boolean' ? d['music'] : fallback.music,
    musicVolume: vol,
    sound: typeof d['sound'] === 'boolean' ? d['sound'] : fallback.sound,
    sensitivity: sens,
    invertY: typeof d['invertY'] === 'boolean' ? d['invertY'] : fallback.invertY,
  };
}

/** localStorage can be missing or throw (private mode, blocked storage): never let that break the game. */
export function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not saved; the game goes on.
  }
}
