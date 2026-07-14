# Migration Log — Wave 1: App Shell Redesign

**Date:** 2026-07-14
**Checkpoint before:** `0ab5f16 feat: wave-0-design-foundation-complete`
**Scope:** Visual redesign of the application shell only (sidebar, topbar, login,
session modal) + supporting primitives. **No changes to WAHA, realtime, auth, or state.**
**Build:** `npm run build` → passes clean (`built in ~8.7s`).

---

## 1. Files changed

### Added (primitives)
| File | Purpose |
|---|---|
| `frontend/src/components/ui/modal.jsx` | `Modal` on Radix Dialog (focus-trap, Esc, aria) |
| `frontend/src/components/ui/menu.jsx` | `Menu`/`MenuItem`/`MenuLabel`/`MenuSeparator` on Radix DropdownMenu |
| `frontend/src/components/ui/page.jsx` | `PageContainer` + `PageHeader` + `PageBody` (standard scaffolding) |
| `frontend/src/components/ui/command-palette.jsx` | `CommandPalette` — ⌘K entry, **prepared UI only** (no commands yet) |

### Modified (shell — reskin/minimal)
| File | Change | Logic touched |
|---|---|---|
| `frontend/src/pages/Login.jsx` | Full Tailwind reskin | **No** — `handleSubmit`/`api.login`/`refreshSocketAuth()`/`onLogin` verbatim |
| `frontend/src/components/Topbar.jsx` | Tailwind reskin + ⌘K entry + palette | **No** — `unreadCount` prop + bell→`/inbox` + `onToggleMobileMenu` preserved |
| `frontend/src/components/Layout.jsx` | +4 additive lines: AI affordance for "Tanya Sano" | **No** — diff is purely additive; all hooks/effects/unread/SSE untouched |
| `frontend/src/App.jsx` | Session-expired inline modal → `Modal` primitive | **No** — `handleForceRelogin` + `auth-error`/`app-visible` listeners + `disconnectSocket()` preserved |
| `frontend/src/index.css` | Refined `§SIDEBAR` (active accent bar + AI styles); deleted `§LOGIN` + `.topbar*` rules | Structural `.app-content`/`.page-body` **kept** |
| `frontend/package.json` + lock | Added `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu` | n/a |

### NOT committed
- `frontend/dist/**` — build artifacts (VPS rebuilds on deploy).

---

## 2. Visual changes
- **Sidebar:** active item now has a left accent bar + `brand-50` fill + bold `brand-600` text (Linear/Attio feel); "Tanya Sano" gets a violet-tinted ✨ icon + a small gradient glow dot (subtle, not a full-gradient item).
- **Topbar:** added ⌘K search entry (pill on desktop, icon on mobile) opening a prepared command palette; refined breadcrumb, bell, and date; sticky with a light blur.
- **Login:** restyled card with explicit field labels, soft shadow, 44px inputs, brand-50 gradient ground, `brand-600` button.
- **Session modal:** same content, now via the accessible `Modal` primitive.

Before/after preview artifact: see conversation (rendered from the real Sano v1 tokens).

---

## 3. WAHA / realtime preservation — verification
Grep after implementation (counts unchanged vs pre-Wave-1):
- `Layout.jsx`: `useSSE("new_message")`, `playNotifSound`, `getLatestUnread`, `unreadCount={unreadCount}` → all present (18 protected refs).
- `App.jsx`: `disconnectSocket()`, `auth-error` listener, `app-visible` dispatch, `handleForceRelogin` → present.
- `Login.jsx`: `api.login`, `refreshSocketAuth()`, `onLogin(user)`, token storage → present.
- `Layout.jsx` git diff vs checkpoint = **only** the additive AI affordance (const `isAI` + icon class + dot span).

---

## 4. CSS deletion safety
Before deleting, grep confirmed `.login-*` and `.topbar*` classes were referenced only by
`Login.jsx`/`Topbar.jsx`, both migrated off them. `.app-content` and `.page-body`
(structural, used by `Layout.jsx`) were explicitly preserved. `§APP SHELL`/`§SIDEBAR`
mechanics (100dvh, collapse, mobile drawer) were **refined, not deleted** — full section
removal deferred to a later cleanup wave to protect the battle-tested drawer/collapse logic.

---

## 5. Remaining risks
| Risk | Level | Note |
|---|---|---|
| Global `input[type=…]` CSS in `§FORM INPUTS` out-specifies utility classes on bare inputs | Low | Cosmetic only; Login inputs still render correctly. Resolve when forms migrate (Wave 6). |
| Orphaned mobile rules for `.topbar-hamburger`/`.topbar-left` in `§MOBILE RESPONSIVE` | Very low | Dead selectors (classes no longer in DOM); harmless; remove in cleanup wave. |
| ⌘K global keydown listener | Low | Additive `window` listener, scoped to open/close only; does not touch app state. |
| Full in-app runtime click-through not performed | Low | Needs backend + WAHA + Postgres; mitigated by clean build + grep-verified logic preservation + additive-only diffs. |
| Topbar no longer shows a user menu | n/a | By design — user/logout remains in the sidebar footer; a topbar profile menu can come later. |
