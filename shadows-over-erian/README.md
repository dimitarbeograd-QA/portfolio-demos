# Shadows over Erian (Сенки над Ериан)

Top-down action-adventure in the spirit of classic dungeon-crawling adventures, built as a single-file HTML5 canvas game and installable as a PWA (PC and phone). Content is in Bulgarian. Original world and characters.

**Chapter 1 (playable now):** village Rosna, an overworld of 36 screens, a secret cave, a shop, the Root Temple dungeon (keys, push-block puzzle, crystal switch, bow, boss "Korneгрив") and the first Moon Crystal shard.

## Features
- Hand-drawn-in-code tiles and sprites, animated water/torches, depth-sorted trees, dynamic dungeon lighting
- Sword, bow, bombs; hearts and heart pieces; keys, locked doors, shutters, pits, spikes, push blocks
- Procedural WebAudio sound effects and music (no audio files)
- Keyboard (WASD/arrows, Z sword, X item, C switch, Esc menu), gamepad, and touch controls
- Autosave in localStorage, works offline after the first visit

## Tests
Headless Node tests check map connectivity, run a scripted bot through the whole chapter (including the boss), render all overworld screens and a random-input soak test. A real Chromium smoke test checks for console errors.
