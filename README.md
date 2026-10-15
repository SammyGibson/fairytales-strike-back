# The Fairytales Strike Back

A blocky first-person adventure for kids (ages 6–10) that runs in the browser.
Level 1, **Moonlit Hollow**: follow the lantern path through a night forest,
beat the Purple Zombies and defeat the Rotten Potato in her arena.

## Play locally

Requires Node.js 20 or newer.

```sh
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Controls (keyboard only)

| Action          | Keys          |
| --------------- | ------------- |
| Swing sword     | J             |
| Hold shield     | K             |
| Walk            | W A S D       |
| Turn            | ← →           |
| Look up / down  | ↑ ↓           |
| Jump            | Space         |
| Pause           | Esc or P      |

The mouse is optional: click the game to look around with it (left click
swings, right click blocks).

## Rules

- 6 hearts. Floating hearts heal you; zombies sometimes drop them.
- Purple Zombies take 2 hits. They only attack when they can see you and are
  in front of you: watch for their arms going up and eyes flashing, then block.
- The Rotten Potato wakes when you enter her arena. She lifts big stones over
  her head and throws them; hold your shield to stop them. She takes 10 hits.
- Checkpoints save your progress; Continue on the menu resumes.

## Build and host

```sh
npm run build
```

This writes a static site to `dist/` that can be hosted anywhere (GitHub Pages,
Netlify, Vercel).

## Code map

- `src/level1.ts` — builds Moonlit Hollow (terrain, path, forest, castle, arena) and lists enemy spawns and checkpoints
- `src/game.ts` — combat, zombie and boss behaviour, pickups, checkpoints, first-person sword and shield
- `src/models.ts` — blocky character models
- `src/world.ts` — block storage and glow lighting
- `src/mesher.ts` — turns blocks into 3D meshes
- `src/scene.ts` — night sky, moon, stars, bloom glow, particles
- `src/player.ts` — movement and collisions
- `src/textures.ts` — all block art, drawn in code
- `src/main.ts` — menus, input, saving, main loop
- `public/` — menu and screen artwork
