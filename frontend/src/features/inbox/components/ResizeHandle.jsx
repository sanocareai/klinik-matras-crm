import React, { useCallback, useRef } from "react";

// Drag handle tipis di antara 2 kolom Inbox (30 Agustus 2026, FASE G).
// Pointer Events (bukan mouse/touch terpisah) supaya SATU implementasi
// jalan untuk mouse maupun trackpad/stylus tanpa cabang kode tambahan.
// `onResize(deltaX)` dipanggil tiap gerak — pemanggil (Inbox.jsx) yang
// menentukan arah & clamp lebar akhirnya, komponen ini murni penangkap
// gesture, tidak tahu apa-apa soal lebar kolom yang digesernya.
export default function ResizeHandle({ onResize, onResizeStart, onResizeEnd, ariaLabel, style }) {
  const draggingRef = useRef(false);

  const handleMove = useCallback((e) => {
    if (!draggingRef.current) return;
    onResize(e.movementX);
  }, [onResize]);

  const handleUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    onResizeEnd?.();
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
  }, [handleMove, onResizeEnd]);

  const handleDown = useCallback((e) => {
    // Klik kiri saja — abaikan klik kanan/tengah.
    if (e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none"; // cegah teks ikut ke-select saat menyeret
    onResizeStart?.();
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }, [handleMove, handleUp, onResizeStart]);

  // Dukung keyboard (aksesibilitas) — panah kiri/kanan menggeser 16px per tekan.
  function handleKeyDown(e) {
    if (e.key === "ArrowLeft") { e.preventDefault(); onResize(-16); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onResize(16); }
  }

  return (
    <div
      className="inbox-resize-handle"
      style={style}
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={handleDown}
      onKeyDown={handleKeyDown}
    >
      <span className="inbox-resize-handle-grip" />
    </div>
  );
}
