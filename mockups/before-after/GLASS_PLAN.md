# Frosted glass: implementation plan

Target: `mockups/before-after/glass.html` (the ".after" layers and the style board).
All rules from `IMPLEMENTATION_PLAN.md › Rules for every agent` still apply.

## Rules specific to glass

- Glass goes only on the functional layer: sidebar, page toolbar, menus, dialogs, toasts.
  Never on cards, tables, form fields, receipts (stub), results, or alerts.
- One shared class `zv-glass` plus `--zv-glass-*` tokens. Pages never write their own
  `backdrop-filter`.
- Spec: `backdrop-filter: blur(28px) saturate(1.45)` (with `-webkit-` prefix); fill white 78%
  (light) and slate rgb(24 36 58 / .80) (dark); thinner 66% for fields on glass; 1px light rim
  plus inset top highlight; radii sidebar 16, toolbar 14, menu 12, dialog 18.
- Text on glass uses `--zv-glass-ink` and `--zv-glass-muted` (#46536A light, #C3CCD8 dark).
- Fallback: under `prefers-reduced-transparency: reduce` and `prefers-contrast: more`, every
  `zv-glass` becomes the solid card fill with a normal border. No blur.
- Content-layer wash (`--zv-wash`): soft sky and slate radial gradients on the page background,
  static, behind everything. Dimmed under the fallback.
- No animated blur. At most five glass surfaces visible at once.

## Phase G1: foundation (one agent, blocking)

Owns: `theme.css`, `App.css` (shared rules), `index.css`, `App.tsx`, `components/**`,
`scripts/zv_contrast.py`, new `components/common/PageToolbar.tsx`, new
`components/common/Toast.tsx`.

1. Tokens and `.zv-glass` utility with fallbacks; `--zv-wash` on the app background.
2. Sidebar floats: inset 12px from the window edges, radius 16, glass. Selected item is a
   `--zv-glass-sel` pill with the 3px sky bar. Main column offsets to clear it.
3. `PageToolbar`: sticky glass bar (top 12px, radius 14, height 56) with `title` and an
   `actions` slot (search fields, buttons). A scroll edge band (6px blur, masked fade) under it
   so content blurs as it scrolls beneath. Props: `title: ReactNode`, `children?` (actions),
   `crumb?: ReactNode`.
4. Toast: `ToastProvider` in App, `useToast()` returning `show(message, tone?)`. Glass pill,
   bottom centre of the main column, `role="status"` `aria-live="polite"`, auto-hide after 2s,
   one at a time. `CopyButton` calls it ("Copied"), replacing its inline label swap.
5. Add glass text pairs to `zv_contrast.py` (glass ink and muted on the composite of glass fill
   over sky #3BA7E0, light and dark) and keep the gate passing.

## Phase G2: adopt (two agents in parallel, after G1)

| Agent | Work | Owns |
| --- | --- | --- |
| Voter | Replace page headings with `PageToolbar` on Your ballots, Join, Cast vote, Receipt, Results, Verify | `pages/Voter/*`, `pages/Verify/*`, `styles/voter.css`, `styles/verify.css` |
| Admin | `PageToolbar` on Elections (search + New election inside it), Finish election, Create election, Activity record; `ManageMenu` gets `zv-glass` (radius 12); BlockList dialog gets `zv-glass` (radius 18) with a lighter 28% scrim, fields inside stay solid | `pages/Admin/*`, `styles/admin.css` |

Sign-in and register keep their current layout (no toolbar); they still get the floating sidebar
and wash from G1.

## Phase G3: review (orchestrator)

Build, lint, contrast gate, grep that `backdrop-filter` appears only in the shared rule, browser
pass in light, dark and with the fallback forced.
