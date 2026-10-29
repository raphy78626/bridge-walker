import { describe, it, expect } from 'vitest';
import { createHoldButtons, releaseWhenBackgrounded } from '../src/phone/holdButtons.js';

// A stand-in for a DOM element or document/window: records listeners, fire(type) calls them.
function fakeTarget(extra = {}) {
  const listeners = {};
  const classes = new Set();
  return {
    ...extra,
    classes,
    classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) },
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    fire: (type) => { for (const fn of listeners[type] ?? []) fn({ preventDefault() {} }); },
  };
}

describe('hold buttons', () => {
  it('send on press and on lift, never twice in a row, and show the press', () => {
    const holds = createHoldButtons();
    const walk = fakeTarget();
    const sent = [];
    holds.hold(walk, (on) => sent.push(on));
    walk.fire('pointerdown');
    walk.fire('pointerdown');
    expect(walk.classes.has('down')).toBe(true);
    walk.fire('pointerleave');
    walk.fire('pointerup');
    expect(sent).toEqual([true, false]);
    expect(walk.classes.has('down')).toBe(false);
  });

  it('releaseAll lets go of every held button once, and of none that is up', () => {
    const holds = createHoldButtons();
    const walk = fakeTarget();
    const run = fakeTarget();
    const sent = [];
    holds.hold(walk, (on) => sent.push(['walk', on]));
    holds.hold(run, (on) => sent.push(['run', on]));
    walk.fire('pointerdown');
    holds.releaseAll();
    holds.releaseAll();
    expect(sent).toEqual([['walk', true], ['walk', false]]);
    expect(walk.classes.has('down')).toBe(false);
  });
});

describe('releaseWhenBackgrounded', () => {
  function setup() {
    const doc = fakeTarget({ hidden: false });
    const win = fakeTarget();
    let releases = 0;
    releaseWhenBackgrounded(doc, win, () => { releases += 1; });
    return { doc, win, count: () => releases };
  }

  it('lets go when the page is hidden (another app, the lock button), not when it comes back', () => {
    const { doc, count } = setup();
    doc.hidden = true;
    doc.fire('visibilitychange');
    expect(count()).toBe(1);
    doc.hidden = false;
    doc.fire('visibilitychange');
    expect(count()).toBe(1);
  });

  it('lets go when the page is unloaded or the window loses focus (a call, the notification shade)', () => {
    const { win, count } = setup();
    win.fire('pagehide');
    win.fire('blur');
    expect(count()).toBe(2);
  });

  it('a held WALK sends its release when the phone is backgrounded mid-walk', () => {
    const holds = createHoldButtons();
    const walk = fakeTarget();
    const sent = [];
    holds.hold(walk, (on) => sent.push(on));
    const doc = fakeTarget({ hidden: false });
    releaseWhenBackgrounded(doc, fakeTarget(), () => holds.releaseAll());
    walk.fire('pointerdown');
    doc.hidden = true;
    doc.fire('visibilitychange');
    expect(sent).toEqual([true, false]);
  });
});
