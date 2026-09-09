import React from "react";
import { Plus, X } from "lucide-react";
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
export default function TabStrip() {
  const { tabs, activeTabId, switchTab, closeTab, openNewTab } = useTabs();

  return (
    <div className="tab-strip" role="tablist" aria-label="Tab yang terbuka">
      <div className="tab-strip-scroll">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={"tab-chip" + (active ? " active" : "")}
              onClick={() => switchTab(tab.id)}
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
      </div>
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
  );
}
