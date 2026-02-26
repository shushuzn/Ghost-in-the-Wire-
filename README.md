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
- Structured wire network with nearest-wire highlighting
- Dash traversal along wire segments at 3x speed with endpoint chain-linking
- Chromatic aberration trail and speed-based glitch rendering
- Enemy kill possession effect (particle dissolve + reconstruction)
- Depleting Sync meter with low-sync instability (shake/input jitter) and 2x damage
- Enemy FSM behaviors: patrol, chase, and evade for clearer combat rhythm

## Roadmap

Development now follows an explicit optimization roadmap in `ROADMAP.md`.

- Phase 1: Vertical-slice foundations ✅
- Phase 2: Reliability/readability optimization 🟡
- Phase 3: Combat depth + roguelike loop 🔜
- Phase 4: Performance + productionization 🔜
