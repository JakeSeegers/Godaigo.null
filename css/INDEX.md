# css/ — Stylesheet Index

> See parent: [CLAUDE.md](../CLAUDE.md)

---

## FILE MAP

| File | Responsibility |
|------|---------------|
| `variables.css` | **Design tokens** — all CSS custom properties. Edit here to retheme. |
| `base.css` | Global reset, body/html defaults, font-face declarations |
| `styles.css` | **Main stylesheet**: game layout, HUD, panels, modals, tutorial system, auth screen, gamification UI, scroll deck, stone cards, CRT overlay, emoji system, Bot Mind viewer (#bot-mind-panel, .bot-mind-layer), responsive rules |
| `layout.css` | Lobby wrapper layout, game layout grid (3-col), panel collapse transitions |
| `board.css` | SVG board elements: hex tile fills/strokes, stone circles, player pawn markers, shrine markers, snap indicators |
| `components.css` | Buttons, inputs, modals, dropdowns, cards, status text, common UI primitives |
| `responsive.css` | Media queries for tablet (≤1024px) and mobile (≤768px) |

> **Note:** `styles.css` has grown to absorb most rules. When adding new features, default to `styles.css` unless the rule is clearly board-SVG (`board.css`) or a layout grid change (`layout.css`).

---

## variables.css — Token Reference

```css
/* Colors */
--bg-dark: #0d0d0d
--bg-panel: #181818
--bg-card: #222
--bg-elevated: #2a2a2a
--accent-gold: #e6c79c        ← primary accent; used for borders, highlights
--accent-orange: #c05500
--pc: the viewer's seat colour, set on <html> in a game by js/scroll-panels.js _initPlayerTint (with html.pc-on);
      used only by the PLAYER TINT block at the end of styles.css (panels, card buttons, HUD / dock bars)
--text-muted: (implicit ~#666)
--border-subtle: (implicit)

/* Spacing */
--hud-height, --action-bar-height, --panel-width (used in grid template)

/* Typography */
--font-terminal: (VT323 or monospace fallback)
--font-pixel: (Press Start 2P)

/* Radius */
--radius-lg: 4px
```

---

## Z-Index Stack (styles.css)

From lowest to highest. Anything not listed here is `auto` (stacking context order).

| z-index | Element |
|---------|---------|
| 2000 | `.scroll-browse-content` overlay |
| 3000 | `.stone-info-overlay` (stone ability popup) |
| 8500 | Gamification toast / notification |
| 8600 | `.tutorial-blocking-overlay` (spotlight dim layer) |
| 8610 | `.tutorial-modal` (center modals) |
| 8620 | `.tutorial-spotlight` (highlighted element) |
| 8640 | `.tutorial-modal.tutorial-corner` (corner modals) |
| 9000 | `.gami-overlay` (gamification panel) |
| 9999 | Various top-level overlays (emoji shop, badge panel) |
| 10000 | `.retro-dlg-overlay` (confirm dialogs) |

> Tutorial z-indices were raised from ~2500 to ~8600 to clear the stone info overlay at 3000.

---

## Tutorial CSS Classes

All prefixed `tmode-` (new interactive tutorial) or `tutorial-` (shared/legacy):

| Class | Purpose |
|-------|---------|
| `.tutorial-modal` | Full-screen overlay wrapper (center or corner) |
| `.tutorial-modal.tutorial-corner` | Corner-positioned modal variant (no dim bg) |
| `.tutorial-modal.tutorial-visible` | opacity:1 (added via rAF after append) |
| `.tutorial-modal.tutorial-fade-out` | opacity:0 for exit animation |
| `.tutorial-content` | The card box inside the modal |
| `.tutorial-blocking-overlay` | Full-screen click-eater for spotlight steps |
| `.tutorial-spotlight` | Applied to target element — gold pulse glow, z-index:8620 |
| `.tutorial-highlight-ring` | SVG circle on board with pulse animation |
| `.tmode-next` | "Continue" / "Got it" button inside tutorial modal |
| `.tmode-exit` | ✕ exit button — top-right of every modal |
| `.tmode-skip` | Muted "Skip Preamble" button (steps with a `skipTo` id — currently the 5 designer's-note pages) — jumps straight to that step, inline-styled in tutorial-mode.js's showModal() |
| `.auth-btn-tutorial` | Tutorial entry button on auth screen |
| `.auth-tutorial-divider` | "or" divider above tutorial button |
