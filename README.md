# Ghost in the Wire — Prototype

A browser-based action-roguelike prototype built with HTML5 Canvas.

## Run

From the repository root:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

## Controls

- Move: `WASD` or arrow keys
- Snap Dash to nearest wire: `Space`

## Implemented Systems

- Neon high-contrast visual palette (`#000000`, `#00FFFF`, `#FF0033`)
- Static wire grid and nearest-wire snapping
- Dash traversal along wire segments at 3x speed
- Chromatic aberration trail and speed-based glitch rendering
- Enemy kill possession effect (particle dissolve + reconstruction)
- Depleting Sync meter with low-sync instability (shake/input jitter) and 2x damage
