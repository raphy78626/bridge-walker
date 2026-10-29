// The phone's stable identity, sent in its join so a reconnect takes its old slot back (server/rooms.js). It is made up
// once, kept in sessionStorage (which lives as long as the tab, through reloads and network drops), and is 1-64 characters
// of [A-Za-z0-9_-] (protocol.js's rule). Storage can be missing or throw (private mode): see phoneId.
import { isValidPhoneId } from '../shared/protocol.js';

export const PHONE_ID_KEY = 'bridge.phoneId';
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const ID_LENGTH = 24; // 24 chars of 6 bits each: 144 bits, nobody guesses another phone's

// `random(n)` returns n random bytes; by default the browser's crypto, and Math.random where there is none.
const defaultRandom = (n) => {
  const bytes = new Uint8Array(n);
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
};

export function newPhoneId(random = defaultRandom) {
  let bytes;
  try {
    bytes = random ? random(ID_LENGTH) : defaultRandom(ID_LENGTH);
  } catch {
    bytes = defaultRandom(ID_LENGTH);
  }
  let id = '';
  for (let i = 0; i < ID_LENGTH; i++) id += ALPHABET[bytes[i] & 63];
  return id;
}

// The id kept in `storage` (sessionStorage), made up and stored on the first call. The caller keeps the result for the page's
// life (the phone's main.js reads it once at start-up), so storage that cannot keep an id still gives one id per page load.
export function phoneId(storage, random) {
  try {
    const kept = storage && storage.getItem(PHONE_ID_KEY);
    if (isValidPhoneId(kept)) return kept;
  } catch {}
  const id = newPhoneId(random);
  try {
    if (storage) storage.setItem(PHONE_ID_KEY, id);
  } catch {}
  return id;
}
