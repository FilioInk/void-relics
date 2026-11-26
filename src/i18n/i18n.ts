import { DICTS, format, usesCyrillic, type Key, type Lang } from './strings.ts';
import type { ProperName } from '../world/names.ts';

let current: Lang = 'en';

export function setLang(lang: Lang): void {
  current = lang;
  document.documentElement.lang = lang;
}

export const lang = (): Lang => current;

export function t(key: Key, vars?: Record<string, string | number>): string {
  return format(DICTS[current][key], vars);
}

export function nameOf(n: ProperName): string {
  return usesCyrillic(current) ? n.cyrillic : n.latin;
}
