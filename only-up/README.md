# ASCENT — an "Only Up"-style climbing game

Eight themed worlds stacked on one tower, climbed by a spiral route of platforms, ladders, launch pads,
moving bridges, spinners and phase-blink platforms. Everything (textures, sky, music, geometry) is procedural — no asset files.

| Band | Theme |
|---|---|
| 1 | Verdant Reach — nature is beautiful |
| 2 | The Foundry — industrial |
| 3 | No Man's Ladder — wartime |
| 4 | Ashfall — post-apocalyptic |
| 5 | Brass & Neon — Victorian cyberpunk |
| 6 | Frostworks — frozen industry |
| 7 | Xenith — future alien |
| 8 | The Garden Above — summit |

## Run
```bash
cd only-up
npm install        # once (installs `ws`)
npm start          # http://localhost:8787  (PORT=… to change)
```
Controls: WASD move · Space jump · Shift sprint · mouse look · wheel zoom · R last checkpoint · Enter chat · M mute.

## Multiplayer (relay + password)
`server.js` is both the static file server and a WebSocket relay. In the menu enter a **room** and **password**:
the first person creates the room (password stored only as a salted scrypt hash, in memory), everyone else must
supply the same password. The relay forwards state (15 Hz), chat and checkpoint events; the world is deterministic so
nothing else needs syncing, and moving platforms follow a shared server clock. Up to 16 players per room; wrong-password
attempts are rate-limited per IP.

To host publicly put it behind TLS (e.g. a reverse proxy) and players use `wss://your-host`; a separate relay URL can be
typed into the menu's *Relay* field. Passwords travel over the socket, so use `wss://` outside localhost.

## Dev
`?solo=1` skips the menu, `?lvl=N` starts at level N's gate, `?fresh=1` ignores saved progress.
`src/bot.js` drives the real controller along the generated route to check reachability:
`const {runBot}=await import('/src/bot.js'); await runBot(__game,1,9999,{independent:true})`.
