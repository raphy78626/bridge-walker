# Roadmap

What's next for Bridge Walker, in order. Each step is reviewed and play-tested on a real LG TV before the next.

## 1. Visible wind, harder levels, real scoring *(done)*
- Gusts are announced about 1.8 s ahead: a WIND arrow on the TV and the phone, streaks blowing across the
  scene, swaying ropes, and a whoosh from that side.
- Each level gets a little harder: more frequent and slightly stronger gusts, a bit more wobble, more and wider gaps.
- A par time per level, 1-3 stars, points, a run total and personal bests saved on the TV.

## 2. Split `src/tv/scene.js` *(done)*
Walker, camera rig, lighting, wind view and adaptive quality are now their own modules, and a second soldier is a
clone of the first.

## 3. Two-player mode *(done)*
Both phones scan the same QR code; the TV shows player colours and lets you pick a mode.
- **Race:** two soldiers on side-by-side bridges with the same gaps, one shared camera. Each round opens with
  3, 2, 1, GO; the leader waits 6 m ahead for the other (WAIT FOR P2), with a free sprint over the last 10 m. First
  across wins; falls cost time; first to 3 rounds.
- **Wind master:** one player walks; the other sends gusts from two GUST buttons (with the same visible warning) to
  knock them off. Roles swap every round, 4 rounds. Great for parent vs kid.
- A phone that reconnects takes its own slot back; a TV reload keeps both phones paired for 30 s.

(Split screen was considered and rejected: the TV's GPU would drop to about half the frame rate.)

## 4. Pause and volume *(done)*
A pause button on the phone, and a small settings sheet with music and sound-effect volume.

## 5. Polish
- Frame rate: the TV now renders at a fixed 70% and holds about 40 fps in the chase view (measured on the LG TV,
  the same before and after the random canyons). The cinematic view is the slowest, at about 36. A steady 50 on a
  50 Hz panel would need a cheaper scene, not just a lower resolution.
- Level changes don't freeze any more *(done)*: split over two frames, and the lighting is prefiltered from a tiny
  copy of the sky (that alone was a ~550 ms frame on the TV).
- Less repetitive rock walls *(done)*: ledges, cracks, layered bands and colour, a new canyon shape every level, and a
  green valley with pines.
- Fixed-step physics *(done)*: the game plays the same at any frame rate.
- Faster levels *(done)*: walking and running 5% faster each level, up to +30%.
- A closer, tighter cinematic camera *(done)*; zooming out near gaps is still to do.

## 6. Testing
- Android phones: test on the Android emulator's simulated motion sensors, then a real phone.
- A listening pass on the sounds with real ears (they were mixed by measurement).

## Later
- Play without a computer: a cloud relay (also removes the phone's certificate warning).
- Remember pairing across a TV app restart (a reload already keeps the phones paired for 30 s).
- A pre-rendered video background for an even more photoreal canyon.
- LG Content Store submission.
