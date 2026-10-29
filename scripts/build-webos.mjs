// Builds the hosted webOS app into dist-webos/: an icon on the TV that opens the game served by `npm run tv`.
// The app finds the game computer itself (last server, then a Wi-Fi scan, then an address typed with the remote);
// this machine's address is only baked in as a first guess. GAME_URL= (empty) builds a package with no guess.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { lanIp } from '../server/lanIp.js';

const TV_PORT = 5184; // `vite preview` on 5174 + the relay's plain-HTTP TV port offset of 10
const url = process.env.GAME_URL ?? `http://${lanIp()}:${TV_PORT}/tv.html`;
const src = new URL('../webos/', import.meta.url);
const out = new URL('../dist-webos/', import.meta.url);

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const file of ['appinfo.json', 'icon.png', 'largeIcon.png']) cpSync(new URL(file, src), new URL(file, out));
// replaceAll, and a check: a single replace() once hit only a mention in a comment, so the app polled
// '__GAME_URL__/api/info' forever.
const html = readFileSync(new URL('index.html', src), 'utf8').replaceAll('__GAME_URL__', url);
if (html.includes('__GAME_URL__')) throw new Error('webos/index.html still contains __GAME_URL__');
writeFileSync(new URL('index.html', out), html);
console.log(`dist-webos/ ready: the TV app tries ${url || '(no guess)'} first, then finds the game computer itself`);
