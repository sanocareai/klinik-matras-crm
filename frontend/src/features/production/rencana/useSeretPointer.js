import { useCallback, useEffect, useRef, useState } from "react";

// SERET-LEPAS berbasis Pointer Events: SATU mekanisme untuk mouse, layar sentuh, dan pena (HTML5 drag-and-drop tidak jalan di HP).
// Kartu "diangkat" (salinan melayang mengikuti jari/kursor), sasaran di bawah pointer dicari lewat atribut data-drop="hari:<tanggal>" / "meja:<kode>".
// Mouse: seret mulai sesudah bergeser 4 px (klik biasa tetap klik). Sentuh/pena: dari pegangan (touch-action: none) seret mulai langsung.
// Esc / pointercancel membatalkan. Dekat tepi layar halaman bergulir otomatis. Posisi salinan ditulis langsung ke DOM (tanpa render ulang per gerakan).
const AMBANG = 4; const TEPI = 72; const LAJU = 14;

export const bacaSasaran = (el) => {
  const t = el?.closest?.("[data-drop]")?.getAttribute("data-drop"); if (!t) return null;
  const i = t.indexOf(":"); return { jenis: t.slice(0, i), nilai: t.slice(i + 1), kunci: t };
};

export default function useSeretPointer({ onLepas }) {
  const [seret, setSeret] = useState(null); // { items, lebar, tinggi, html } — salinan dirender oleh <SalinanSeret>
  const [sasaran, setSasaran] = useState(null);
  const st = useRef(null); const salinanRef = useRef(null); const lepasRef = useRef(onLepas);
  useEffect(() => { lepasRef.current = onLepas; }, [onLepas]);

  const akhiri = useCallback((jatuhkan) => {
    const s = st.current; st.current = null; cancelAnimationFrame(s?.raf || 0);
    document.body.classList.remove("rc-sedang-seret");
    if (!s?.aktif) return;
    const t = jatuhkan ? s.sasaran : null;
    setSeret(null); setSasaran(null);
    if (t) lepasRef.current?.(t, s.items);
  }, []);

  const gerak = useCallback((e) => {
    const s = st.current; if (!s || e.pointerId !== s.id) return;
    s.x = e.clientX; s.y = e.clientY;
    if (!s.aktif) {
      if (s.tipe === "mouse" && Math.hypot(s.x - s.x0, s.y - s.y0) < AMBANG) return;
      s.aktif = true; document.body.classList.add("rc-sedang-seret");
      const r = s.el.getBoundingClientRect(); s.dx = s.x0 - r.left; s.dy = s.y0 - r.top;
      setSeret({ items: s.items, lebar: r.width, html: s.el.outerHTML, x: r.left, y: r.top });
    }
    e.preventDefault();
    if (salinanRef.current) salinanRef.current.style.transform = `translate3d(${s.x - s.dx}px, ${s.y - s.dy}px, 0)`;
    const bawah = document.elementsFromPoint(s.x, s.y).find((n) => !salinanRef.current?.contains(n));
    const t = bacaSasaran(bawah);
    if ((t?.kunci || null) !== (s.sasaran?.kunci || null)) { s.sasaran = t; setSasaran(t); }
    // gulir otomatis dekat tepi atas/bawah
    cancelAnimationFrame(s.raf);
    const v = s.y < TEPI ? -LAJU : s.y > window.innerHeight - TEPI ? LAJU : 0;
    if (v) { const putar = () => { if (!st.current) return; window.scrollBy(0, v); s.raf = requestAnimationFrame(putar); }; s.raf = requestAnimationFrame(putar); }
  }, []);

  useEffect(() => {
    const naik = (e) => { if (st.current && e.pointerId === st.current.id) akhiri(true); };
    const batal = (e) => { if (st.current && (e.type !== "pointercancel" || e.pointerId === st.current.id)) akhiri(false); };
    const esc = (e) => { if (e.key === "Escape" && st.current?.aktif) { e.preventDefault(); akhiri(false); } };
    window.addEventListener("pointermove", gerak, { passive: false }); window.addEventListener("pointerup", naik); window.addEventListener("pointercancel", batal); window.addEventListener("keydown", esc);
    return () => { window.removeEventListener("pointermove", gerak); window.removeEventListener("pointerup", naik); window.removeEventListener("pointercancel", batal); window.removeEventListener("keydown", esc); };
  }, [gerak, akhiri]);

  /** Dipasang di onPointerDown pegangan kartu. `el` = elemen kartu yang disalin; `items` = unit yang ikut diseret. */
  const mulai = useCallback((e, el, items) => {
    if (e.button !== undefined && e.button !== 0) return;
    st.current = { id: e.pointerId, tipe: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, el, items, aktif: false, sasaran: null, raf: 0 };
    if (e.pointerType !== "mouse") { e.preventDefault(); gerak(e); }
  }, [gerak]);

  return { seret, sasaran, mulai, salinanRef, batal: () => akhiri(false) };
}
