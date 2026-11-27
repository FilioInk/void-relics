import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWriter, opacity, percent } from './dom.ts';

function fakeEl() {
  const writes: string[] = [];
  let text: string | null = null;
  return {
    writes,
    hidden: false,
    style: { setProperty: (n: string, v: string) => void writes.push(`${n}=${v}`) },
    get textContent() {
      return text;
    },
    set textContent(v: string | null) {
      writes.push(`text=${v}`);
      text = v;
    },
  };
}

test('a writer only touches the DOM when a value changes', () => {
  const w = createWriter();
  const el = fakeEl();
  w.style(el, 'opacity', '0.5');
  w.style(el, 'opacity', '0.5');
  w.style(el, 'width', '10%');
  w.style(el, 'opacity', '0.6');
  w.text(el, '280 m/s');
  w.text(el, '280 m/s');
  assert.deepEqual(el.writes, ['opacity=0.5', 'width=10%', 'opacity=0.6', 'text=280 m/s']);
});

test('a writer keeps separate memories per element', () => {
  const w = createWriter();
  const a = fakeEl();
  const b = fakeEl();
  w.style(a, 'opacity', '1');
  w.style(b, 'opacity', '1');
  assert.equal(a.writes.length, 1);
  assert.equal(b.writes.length, 1);
});

test('hidden is only assigned when it flips', () => {
  const w = createWriter();
  let sets = 0;
  const el = {
    _h: false,
    get hidden() {
      return this._h;
    },
    set hidden(v: boolean) {
      sets++;
      this._h = v;
    },
  };
  w.hidden(el, false);
  w.hidden(el, true);
  w.hidden(el, true);
  assert.equal(sets, 1);
});

test('percent and opacity round below what the eye can see, and survive NaN', () => {
  assert.equal(percent(0.999999), '100.0%');
  assert.equal(percent(0.12345), '12.3%');
  assert.equal(percent(NaN), '0.0%');
  assert.equal(opacity(0.35 * 0.5), '0.175');
  assert.equal(opacity(1.4), '1.000');
  assert.equal(opacity(-1), '0.000');
  assert.equal(opacity(NaN), '0.000');
});
