// Buttons that are "on" while a finger is on them (WALK, RUN). Each sends on every change, never twice in a row.
// releaseAll() lets go of every one, as if the finger lifted: a backgrounded page (another app, the lock button, a call)
// never sees its pointerup, so the button would come back still held. Pure apart from the elements it is given.
export function createHoldButtons() {
  const releases = [];
  return {
    hold(el, send) {
      let held = false;
      const set = (on) => {
        if (held === on) return;
        held = on;
        el.classList.toggle('down', on);
        send(on);
      };
      releases.push(() => set(false));
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        set(true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(ev, () => set(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    },
    releaseAll() {
      for (const release of releases) release();
    },
  };
}

// Lets go of every held button whenever the page stops being the one in front: hidden (backgrounded, screen locked),
// unloaded, or the window losing focus (a notification pulled down, a call). The TV stops a walker whose phone goes quiet
// within half a second anyway (link.js TILT_TIMEOUT_MS); this makes the phone say so at once, and come back with nothing held.
export function releaseWhenBackgrounded(doc, win, releaseAll) {
  doc.addEventListener('visibilitychange', () => {
    if (doc.hidden) releaseAll();
  });
  win.addEventListener('pagehide', releaseAll);
  win.addEventListener('blur', releaseAll);
}
