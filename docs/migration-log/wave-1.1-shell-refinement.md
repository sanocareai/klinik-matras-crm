# Migration Log — Wave 1.1: Shell Visual Refinement

**Date:** 2026-07-14
**Checkpoint before:** `9bde0fe feat: wave-1 app shell redesign`
**Scope:** Visual elevation of the shell (sidebar, topbar) from "clean admin" to
"premium product." Additive micro-interactions (150–200ms). **No logic changed.**
**Build:** `npm run build` → clean (`✓ built in ~10s`).

---

## 1. Files changed
### Added
- `frontend/src/lib/brand.js` — centralized brand (`name: "Sano"`, `subtitle: "AI Commerce CRM"`), easy to change later.
- `frontend/src/components/SidebarLink.jsx` — presentational nav item + sliding active pill (framer-motion `layoutId`, 180ms).

### Modified
| File | Change | Logic touched |
|---|---|---|
| `components/Layout.jsx` | Elevated brand lockup (gradient tile + `BRAND`); nav items → `SidebarLink` in `LayoutGroup`; footer → profile `Menu`; pass `user`+`onLogout` to Topbar; removed unused `NavLink` import | **No** — all hooks/effects/unread/SSE/notification logic byte-identical (grep-verified) |
| `components/Topbar.jsx` | Dominant ⌘K search, refined bell, profile chip (Radix `Menu`) | **No** — `unreadCount` + bell→`/inbox` + `onToggleMobileMenu` + palette preserved; `user`/`onLogout` additive |
| `pages/Login.jsx` | Brand strings from `BRAND` | **No** — auth chain untouched |
| `index.css` `§SIDEBAR` | Elevated-light restyle: tinted panel + depth, gradient brand tile, lifted active pill, profile footer | Mechanics classes (collapse/mobile) preserved |

### NOT committed
- `frontend/dist/**` — build artifacts.

---

## 2. Visual changes
- **Brand:** gradient-ringed tile + "Sano" wordmark (17px/800) + "AI Commerce CRM" subtitle.
- **Sidebar surface:** cool-tint gradient panel (`#FAFBFD→#F4F7FC`) + hairline + edge shadow.
- **Active state:** lifted white pill (soft shadow) with gradient left accent + brand icon/text; **slides** between items via `layoutId` (180ms).
- **Footer:** profile block (gradient ringed avatar + name + role) as a Radix `Menu` trigger (Keluar → existing `onLogout`).
- **Topbar:** ⌘K search grown to ~380px with focus-ring; refined ghost bell + badge (tap scale); profile chip (avatar + first name + chevron → Radix `Menu`).
- **Motion:** 150–200ms transitions, `prefers-reduced-motion` safe (global reset).

---

## 3. Realtime / WAHA preservation — verification
- Protected-ref grep counts unchanged: `Layout.jsx` 18, `App.jsx` 5, `Topbar.jsx` 5, `Login.jsx` 3.
- `Layout.jsx` realtime logic intact at source: `useSSE("new_message")` (L98), `getLatestUnread` (L134), `playNotifSound` (L148), `app-visible` listener (L103–104), 60s poll (L159).
- Only `unreadCount`-related diff = badge **display** moved into `SidebarLink` props (`showBadge`/`badgeCount`); the state, fetch, and listeners are unchanged.
- `user`/`onLogout` are additive props; `onLogout` is the pre-existing handler (no auth-state/flow modification).

---

## 4. Remaining risks
| Risk | Level | Note |
|---|---|---|
| framer-motion `layoutId` pill flash on first mount / rapid route switches | Low | 180ms tween, single active item; `prefers-reduced-motion` collapses it. Verify on device. |
| Two logout entry points (sidebar footer + topbar chip) | Very low | Both call the same `onLogout`; intentional, common pattern. |
| Global `input[type=…]` CSS specificity vs utilities | Low | Cosmetic; unchanged from Wave 1; resolved when forms migrate. |
| Full in-app click-through not run here | Low | Needs backend+WAHA+Postgres; mitigated by clean build + grep + additive diffs. |

**Rollback:** `git reset --hard 9bde0fe`, or per-file `git checkout 9bde0fe -- <file>`.
