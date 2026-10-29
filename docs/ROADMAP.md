# Roadmap

What's next for Bridge Walker, in order. Each step is reviewed and play-tested on a real LG TV before the next.

## 1. Visible wind, harder levels, real scoring *(done)*
- Gusts are announced about 1.8 s ahead: a WIND arrow on the TV and the phone, streaks blowing across the
  scene, swaying ropes, and a whoosh from that side.
- Each level gets a little harder: more frequent and slightly stronger gusts, a bit more wobble, more and wider gaps.
- A par time per level, 1-3 stars, points, a run total and personal bests saved on the TV.

## 2. Split `src/tv/scene.js`
Rendering, cameras, themes, animation and quality logic all live in one file. Split it into walker, cameras,
themes and quality modules, so a second soldier (two-player mode) is easy to add.

## 3. Two-player mode
Both phones scan the same QR code; the TV shows player colours and lets you pick a mode.
- **Race:** two soldiers on side-by-side bridges with the same gaps, one shared camera. First across wins; falls
  cost time.
- **Wind master:** player 1 walks; player 2 tilts their phone to send gusts (with the same visible warning) to
  knock them off. Roles swap each level. Great for parent vs kid.

(Split screen was considered and rejected: the TV's GPU would drop to about half the frame rate.)

## 4. Pause and volume *(done)*
A pause button on the phone, and a small settings sheet with music and sound-effect volume.

## 5. Polish
- A steady 50 fps on 50 Hz TVs (today it's 39-45: shadow hitches are gone, but the resolution still steps
  between 60% and 70%).
- Less repetitive rock walls: ledges, cracks, layered bands and colour variation, still baked so it stays cheap.
- A closer, tighter cinematic camera *(done)*; zooming out near gaps is still to do.

## 6. Testing
- Android phones: test on the Android emulator's simulated motion sensors, then a real phone.
- A listening pass on the sounds with real ears (they were mixed by measurement).

## Later
- Play without a computer: a cloud relay (also removes the phone's certificate warning).
- Remember pairing, so the phone reconnects without rescanning.
- A pre-rendered video background for an even more photoreal canyon.
- LG Content Store submission.
