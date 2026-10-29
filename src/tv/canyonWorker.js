// Builds a level's canyon off the page's thread (canyonBuild.js): { seed } in, the canyon's arrays out, handed over
// without copying. A failure is reported back, and the page then builds on its own.
import { buildCanyon, canyonTransfers } from './canyonBuild.js';

self.onmessage = ({ data }) => {
  try {
    const canyon = buildCanyon(data.seed);
    self.postMessage(canyon, canyonTransfers(canyon));
  } catch (err) {
    self.postMessage({ seed: data.seed, error: String(err?.message ?? err) });
  }
};
