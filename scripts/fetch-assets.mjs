// Downloads the Soldier model on first run. It is a Mixamo character ("Vanguard" by T. Choonyung) from the
// three.js examples; Mixamo's terms allow using it in a game but not redistributing the file on its own,
// so this repository doesn't contain it. Runs before `npm run dev`, `tv` and `build`; a no-op once present.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

const MODEL = new URL('../public/models/Soldier.glb', import.meta.url);
const SOURCE = 'https://raw.githubusercontent.com/mrdoob/three.js/r176/examples/models/gltf/Soldier.glb';

if (existsSync(MODEL)) process.exit(0);
console.log(`Downloading the Soldier model from the three.js examples:\n  ${SOURCE}`);
const res = await fetch(SOURCE);
if (!res.ok) {
  console.error(`Download failed (${res.status}). Fetch it by hand into public/models/Soldier.glb.`);
  process.exit(1);
}
mkdirSync(new URL('.', MODEL), { recursive: true });
writeFileSync(MODEL, Buffer.from(await res.arrayBuffer()));
console.log('Saved public/models/Soldier.glb');
