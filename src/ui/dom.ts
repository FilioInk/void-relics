/** A tiny element builder, enough for the HUD and menus. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string | boolean | number | EventListener>> = {},
  ...children: Array<Node | string | null | undefined | false>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

type StyleTarget = { style: { setProperty(name: string, value: string): void } };
type TextTarget = { textContent: string | null };
type HiddenTarget = { hidden: boolean | 'until-found' };

/**
 * DOM writes that skip themselves when nothing changed. The HUD updates every frame, and an
 * identical style or text assignment still queues a mutation and a style recalculation. Every
 * write to a property must go through the same writer, or its memory of the last value lies.
 */
export type Writer = {
  style(el: StyleTarget, name: string, value: string): void;
  text(el: TextTarget, value: string): void;
  hidden(el: HiddenTarget, value: boolean): void;
};

export function createWriter(): Writer {
  const styles = new WeakMap<object, Map<string, string>>();
  const texts = new WeakMap<object, string>();
  return {
    style(el, name, value) {
      let last = styles.get(el);
      if (!last) {
        last = new Map();
        styles.set(el, last);
      }
      if (last.get(name) === value) return;
      last.set(name, value);
      el.style.setProperty(name, value);
    },
    text(el, value) {
      if (texts.get(el) === value) return;
      texts.set(el, value);
      el.textContent = value;
    },
    hidden(el, value) {
      if (el.hidden !== value) el.hidden = value;
    },
  };
}

/** A 0..1 fraction as a CSS percentage, to a tenth of a percent: finer is invisible. */
export const percent = (v: number): string => `${(Number.isFinite(v) ? v * 100 : 0).toFixed(1)}%`;
/** A CSS opacity to three places (8-bit alpha steps are 0.004 apart). */
export const opacity = (v: number): string => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0).toFixed(3);
