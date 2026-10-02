// Seret-lepas berbasis POINTER (mouse + sentuh + pena) untuk Rencana Produksi. HTML5 drag-and-drop TIDAK dipakai karena tidak berfungsi
// di layar sentuh. Kartu hanya bisa diseret lewat HANDLE (touch-action:none hanya di handle), jadi menggulir halaman dengan jari di
// bagian kartu mana pun tetap normal; ketukan biasa pada handle/kartu tidak memindahkan apa pun (ambang gerak DRAG_THRESHOLD_PX).
// Hook ini tidak menyimpan apa pun ke server: ia hanya melaporkan (view, target, decision) saat lepas — penyimpanan dilakukan halaman
// lewat command yang sama dengan tombol, dan posisi final hanya setelah respons server.
import { useCallback, useEffect, useRef, useState } from "react";
import { dragMoved } from "@/features/production/planDnd.js";

const EDGE_PX = 90; // jarak dari tepi area gulir yang memicu gulir otomatis
const SCROLL_STEP = 16;

// Area gulir halaman = kontainer terluar yang benar-benar bisa digulir (di aplikasi ini .page-body, BUKAN window). Tanpa ini gulir otomatis
// tidak bergerak sama sekali di layar yang lebih pendek dari halaman (tablet/HP) — ditemukan lewat QA sentuh.
export function outerScrollParent(el) {
  let found = null;
  for (let n = el?.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) found = n;
  }
  return found;
}

export function usePlanDrag({ enabled = true, resolve, onDrop }) {
  const [drag, setDrag] = useState(null); // null | { view, x, y, width, offX, offY, resolved }
  const live = useRef({ resolve, onDrop, enabled });
  live.current = { resolve, onDrop, enabled };
  const session = useRef(null); // { view, start, moving, pointerId, width, offX, offY, last, raf, resolved }

  const finish = useCallback(() => {
    const s = session.current; session.current = null;
    if (s?.raf) cancelAnimationFrame(s.raf);
    window.removeEventListener("pointermove", onMove); // eslint-disable-line no-use-before-define
    window.removeEventListener("pointerup", onUp); // eslint-disable-line no-use-before-define
    window.removeEventListener("pointercancel", onCancel); // eslint-disable-line no-use-before-define
    window.removeEventListener("keydown", onKey); // eslint-disable-line no-use-before-define
    document.body.classList.remove("plan-dragging");
    setDrag(null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback((x, y) => {
    const s = session.current; if (!s) return;
    s.last = { x, y };
    const resolved = live.current.resolve?.(x, y, s.view) || null;
    s.resolved = resolved;
    setDrag({ view: s.view, x, y, width: s.width, offX: s.offX, offY: s.offY, resolved });
  }, []);

  // Gulir otomatis saat pointer dekat tepi atas/bawah layar (daftar meja & backlog panjang).
  const tick = useCallback(() => {
    const s = session.current; if (!s?.moving) return;
    const y = s.last?.y ?? 0;
    const r = s.scroller ? s.scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const top = Math.max(r.top, 0); const bottom = Math.min(r.bottom, window.innerHeight);
    const by = (dy) => (s.scroller ? s.scroller.scrollBy(0, dy) : window.scrollBy(0, dy));
    if (y < top + EDGE_PX) by(-SCROLL_STEP);
    else if (y > bottom - EDGE_PX) by(SCROLL_STEP);
    else { s.raf = requestAnimationFrame(tick); return; }
    update(s.last.x, s.last.y); // posisi sasaran berubah karena gulir
    s.raf = requestAnimationFrame(tick);
  }, [update]);

  function onMove(e) {
    const s = session.current; if (!s || (s.pointerId != null && e.pointerId !== s.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    if (!s.moving) {
      if (!dragMoved(s.start, p)) return;
      s.moving = true; document.body.classList.add("plan-dragging");
      s.raf = requestAnimationFrame(tick);
    }
    if (e.cancelable) e.preventDefault();
    update(p.x, p.y);
  }
  function onUp(e) {
    const s = session.current; if (!s || (s.pointerId != null && e.pointerId !== s.pointerId)) return;
    const moved = s.moving; const { view, resolved } = s;
    finish();
    if (moved && resolved) live.current.onDrop?.(view, resolved);
  }
  function onCancel(e) { const s = session.current; if (s && (s.pointerId == null || e.pointerId === s.pointerId)) finish(); }
  function onKey(e) { if (e.key === "Escape") finish(); }

  const start = useCallback((e, view) => {
    if (!live.current.enabled || session.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const card = e.currentTarget.closest?.("[data-drag-card]");
    const rect = (card || e.currentTarget).getBoundingClientRect();
    session.current = { view, start: { x: e.clientX, y: e.clientY }, moving: false, pointerId: e.pointerId, width: rect.width, offX: e.clientX - rect.left, offY: e.clientY - rect.top, last: { x: e.clientX, y: e.clientY }, raf: 0, resolved: null, scroller: outerScrollParent(e.currentTarget) };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (session.current) finish(); }, [finish]);
  useEffect(() => { if (!enabled && session.current) finish(); }, [enabled, finish]);

  return { drag, start, active: !!drag };
}
