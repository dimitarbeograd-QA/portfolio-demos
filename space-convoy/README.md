# Space Convoy (Космически конвой)

Cooperative landscape space shoot-'em-up for 1–4 players, built as a single-file HTML5 canvas game and installable as a PWA. Content is in Bulgarian.

You escort a colony convoy ("Нова Лома") through 5 sectors with story intros, enemy waves and bosses with three phases each.

## Features

- Detailed pre-rendered sprites, parallax backgrounds, particle effects
- Fully synthesized sound effects and procedural music (WebAudio, no audio files)
- Touch controls (floating joystick, BOMB and SHIELD buttons, auto-fire) and keyboard controls
- Works offline after the first visit (service worker)
- **Serverless LAN multiplayer**: WebRTC data channels, paired by scanning QR codes (or pasting text) between phones on the same Wi-Fi or hotspot. No internet and no server needed.
  - Host-authoritative simulation at 60 Hz, snapshots at 20 Hz, client-side interpolation and prediction

## How to play

Open the live demo on a phone, choose "Add to Home screen", then play solo or create a room ("Създай стая") and let friends join ("Присъедини се").

## Known limits

- Tested in Node (simulation stress test, bot balance runs, WebRTC and jsdom end-to-end). Not yet tested on real phones.
- Some routers isolate Wi-Fi clients from each other (AP isolation); use one phone's hotspot in that case.
- The camera needs HTTPS, so QR scanning works on the hosted demo, not from a local file.
