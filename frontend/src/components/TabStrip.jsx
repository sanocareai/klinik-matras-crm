import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, XCircle } from "lucide-react";
import { useTabs } from "@/lib/TabsContext.jsx";

// D-144 — bar tab dalam-app, duduk di antara Topbar (60px, tidak disentuh)
// dan .page-body. Cuma tampil kalau lebih dari 1 tab ATAU tombol "+" perlu
// terlihat — untuk pengguna yang tidak pernah buka tab kedua, ini SENGAJA
// dibuat sekecil mungkin dampaknya (satu baris tipis), bukan chrome besar
// yang mengambil ruang vertikal berharga di layar kerja sehari-hari.
//
// DISEMBUNYIKAN di mobile (CSS `.tab-strip { @media max-width:768px }`,
// lihat index.css) — layar sempit, belum ada preseden pola tab mobile di
// app ini; navigasi mobile tetap seperti sebelumnya (halaman tunggal).
//
// D-145 (9 September 2026) — drag-reorder (HTML5 native drag API, pola
// sama dengan Pipeline Kanban) + klik-kanan "Tutup Lainnya", reuse
// `.conv-context-menu`/`.conv-context-backdrop` (pola sama seperti
// SidebarLink.jsx) bukan menulis resep menu baru.
export default function TabStrip() {
  const { tabs, activeTabId, switchTab, closeTab, closeOthers, openNewTab, reorderTabs } = useTabs();
  const [dragIndex, setDragIndex] = useState(null);
  const [overIndex, setOverIndex] = useState(null);
  const [menu, setMenu] = useState(null); // { x, y, tabId }

  function handleDrop(targetIndex) {
    if (dragIndex != null && dragIndex !== targetIndex) reorderTabs(dragIndex, targetIndex);
    setDragIndex(null);
    setOverIndex(null);
  }

  function handleContextMenu(e, tabId) {
    e.preventDefault();
    const safeX = Math.min(e.clientX, window.innerWidth - 180);
    const safeY = Math.min(e.clientY, window.innerHeight - 100);
    setMenu({ x: safeX, y: safeY, tabId });
  }

  return (
    <div className="tab-strip" role="tablist" aria-label="Tab yang terbuka">
      <div className="tab-strip-scroll">
        {tabs.map((tab, index) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => { e.preventDefault(); setOverIndex(index); }}
              onDragLeave={() => setOverIndex((v) => (v === index ? null : v))}
              onDrop={(e) => { e.preventDefault(); handleDrop(index); }}
              onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
              className={
                "tab-chip" +
                (active ? " active" : "") +
                (overIndex === index && dragIndex !== null && dragIndex !== index ? " drag-over" : "")
              }
              onClick={() => switchTab(tab.id)}
              onContextMenu={(e) => handleContextMenu(e, tab.id)}
              title={tab.title}
            >
              <span className="tab-chip-label">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  className="tab-chip-close"
                  aria-label={`Tutup tab ${tab.title}`}
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
        {/* D-146 (9 September 2026, laporan owner: "tanda + nya di bagian
            mana sih?") — tombol ini SEBELUMNYA sibling dari div scroll ini
            (di luar), dan `.tab-strip-scroll{flex:1}` bikin dia terdorong
            ke UJUNG KANAN LAYAR, jauh terpisah dari tab-tab yang justru ada
            di kiri — bukan cuma sulit ditemukan, tapi tidak terlihat sebagai
            bagian dari tab-strip sama sekali. Sekarang jadi child TERAKHIR
            di dalam baris scroll yang sama, jadi selalu nempel tepat di
            sebelah tab terakhir (pola standar tab browser), ikut sisi kiri
            walau tab sedikit, dan tetap ikut ter-scroll bersama kalau tab
            banyak. */}
        <button
          type="button"
          className="tab-strip-add"
          title="Tab baru"
          aria-label="Buka tab baru"
          onClick={() => openNewTab("/portal")}
        >
          <Plus size={14} />
        </button>
      </div>

      {menu && createPortal(
        <>
          <div
            className="conv-context-backdrop"
            onClick={(e) => { e.stopPropagation(); setMenu(null); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu(null); }}
          />
          <div className="conv-context-menu" style={{ left: menu.x, top: menu.y }}>
            <button type="button" onClick={(e) => { e.stopPropagation(); closeTab(menu.tabId); setMenu(null); }}>
              <X size={14} style={{ color: "#6b7280" }} />
              Tutup Tab Ini
            </button>
            {tabs.length > 1 && (
              <button type="button" onClick={(e) => { e.stopPropagation(); closeOthers(menu.tabId); setMenu(null); }}>
                <XCircle size={14} style={{ color: "#dc2626" }} />
                Tutup Tab Lainnya
              </button>
            )}
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
