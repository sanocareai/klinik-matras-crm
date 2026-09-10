import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { loadTabs, saveTabs } from "./openTabs.js";
import { resolveEntryPath } from "../routes/pageRegistry.jsx";

// D-144 (9 September 2026) — permintaan owner: "workspace SANSS seperti
// Notion, bisa buka tab banyak sekaligus DALAM 1 app". Dua keputusan
// dikunci owner sebelum implementasi (lihat riwayat percakapan):
//   1. Tab yang sudah dibuka TETAP HIDUP di background (keep-alive) —
//      pindah tab instan, scroll & input yang belum disimpan tidak hilang.
//      Konsekuensinya dikerjakan di TabbedContent.jsx (render SEMUA tab
//      sekaligus, sembunyikan lewat `hidden`, bukan unmount).
//   2. Ctrl/Cmd/klik-tengah di sidebar membuka TAB DALAM-APP baru (bukan
//      tab browser sungguhan lagi — itu sekarang cuma lewat menu klik-kanan
//      SidebarLink, lihat D-142).
const TabsCtx = createContext(null);
const TabIdCtx = createContext(null);

// D-151 (10 September 2026, laporan owner — ditemukan lewat screenshot audit
// Gudang) — BUG NYATA: fallback judul tab ini dipakai untuk SEMUA navigasi
// yang tidak lewat SidebarLink (mis. tombol "Buka Work Order" di
// Bengkel.jsx yang `navigate()` langsung ke `/bengkel/units/<uuid>`).
// Sebelumnya cuma ambil potongan URL TERAKHIR mentah-mentah — untuk rute
// berisi ID (UUID), hasilnya judul tab jadi UUID yang di-title-case
// ("D8654bcf 20ec 4b84 972…"), bukan nama halaman. Fix: kalau potongan
// terakhir "terlihat seperti ID" (UUID atau angka/hex panjang), pakai
// NAMA RESOURCE-nya (potongan SEBELUM id itu) — mis. "units" dari
// "/bengkel/units/<uuid>" — bukan ID mentahnya. Kamus kecil di bawah
// menerjemahkan nama resource yang sudah diketahui ke Bahasa Indonesia;
// resource baru yang belum terdaftar tetap dapat fallback title-case biasa
// (lebih baik dari UUID mentah, walau bahasa Inggris) sampai didaftarkan.
const RESOURCE_LABELS = {
  units: "Unit",
};

function looksLikeId(seg) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) || // UUID
    /^[0-9a-f]{16,}$/i.test(seg) || // hash/hex panjang
    /^\d{4,}$/.test(seg) // ID numerik panjang
  );
}

function titleFromPath(path) {
  const parts = path.split("/").filter(Boolean);
  let seg = parts.pop() || "portal";
  if (looksLikeId(seg) && parts.length > 0) {
    const resource = parts.pop();
    seg = RESOURCE_LABELS[resource] || resource;
  }
  return seg
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function newId() {
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function TabsProvider({ pages, ctx, children }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [tabs, setTabs] = useState(() => {
    const saved = loadTabs();
    if (saved) return saved.tabs;
    const path = resolveEntryPath(location.pathname);
    return [{ id: newId(), path, title: titleFromPath(path) }];
  });
  const [activeTabId, setActiveTabId] = useState(() => {
    const saved = loadTabs();
    if (saved && saved.tabs.some((t) => t.id === saved.activeId)) return saved.activeId;
    return tabs[0].id;
  });

  // Simpan tiap kali berubah — pola sama dengan sidebarOrder.js.
  useEffect(() => {
    saveTabs({ tabs, activeId: activeTabId });
  }, [tabs, activeTabId]);

  // Sinkron URL asli browser SUPAYA MENGIKUTI tab aktif, tanpa balik
  // menimpa tab lain — dipakai bersama `skipNextSync` di bawah supaya
  // navigate() yang KITA panggil sendiri (lihat gotoPath) tidak memicu efek
  // ini lagi (yang akan jadi loop tak berguna).
  const skipNextSync = useRef(false);
  useEffect(() => {
    if (skipNextSync.current) {
      skipNextSync.current = false;
      return;
    }
    // Path berubah TANPA lewat gotoPath (mis. sebuah halaman memanggil
    // useNavigate() miliknya sendiri, seperti redirect setelah simpan
    // form). useNavigate() SELALU mengarah ke router sungguhan (SATU-
    // SATUNYA BrowserRouter di app ini) — tidak bisa "di-scope" ke tab
    // tertentu. Asumsi yang diambil di sini: perubahan seperti ini SELALU
    // berasal dari tab yang SEDANG AKTIF/terlihat (kasus jauh lebih umum),
    // jadi cukup perbarui path tab aktif. Batasan yang disadari: kalau ada
    // efek di tab BACKGROUND yang memanggil navigate() sendiri (jarang),
    // tab aktif akan ikut berubah tanpa diklik user — belum ditangani di
    // v1 ini.
    const path = resolveEntryPath(location.pathname);
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, path, title: titleFromPath(path) } : t)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function gotoPath(path, { push = false } = {}) {
    skipNextSync.current = true;
    navigate(path, { replace: !push });
  }

  function openInActiveTab(path, meta = {}) {
    const resolved = resolveEntryPath(path);
    setTabs((prev) => prev.map((t) => (t.id === activeTabId ? { ...t, path: resolved, title: meta.title || titleFromPath(resolved) } : t)));
    gotoPath(resolved, { push: true });
  }

  function openNewTab(path, meta = {}) {
    const resolved = resolveEntryPath(path);
    const id = newId();
    setTabs((prev) => [...prev, { id, path: resolved, title: meta.title || titleFromPath(resolved) }]);
    setActiveTabId(id);
    gotoPath(resolved, { push: true });
  }

  function switchTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    setActiveTabId(id);
    gotoPath(tab.path, { push: false });
  }

  // Tab terakhir TIDAK BOLEH ditutup — sama seperti browser (selalu
  // menyisakan minimal 1 tab).
  function closeTab(id) {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((t) => t.id === id);
      if (idx === -1) return prev;
      const next = prev.filter((t) => t.id !== id);
      if (id === activeTabId) {
        const newActive = next[Math.max(0, idx - 1)];
        setActiveTabId(newActive.id);
        gotoPath(newActive.path, { push: false });
      }
      return next;
    });
  }

  function closeOthers(id) {
    setTabs((prev) => {
      const keep = prev.find((t) => t.id === id);
      if (!keep) return prev;
      if (keep.id !== activeTabId) {
        setActiveTabId(keep.id);
        gotoPath(keep.path, { push: false });
      }
      return [keep];
    });
  }

  function reorderTabs(fromIndex, toIndex) {
    setTabs((prev) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }

  const value = useMemo(
    () => ({ tabs, activeTabId, pages, ctx, openInActiveTab, openNewTab, switchTab, closeTab, closeOthers, reorderTabs }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tabs, activeTabId, pages, ctx]
  );

  return <TabsCtx.Provider value={value}>{children}</TabsCtx.Provider>;
}

export function useTabs() {
  const v = useContext(TabsCtx);
  if (!v) throw new Error("useTabs harus dipakai di dalam <TabsProvider>");
  return v;
}

export function TabIdProvider({ id, children }) {
  return <TabIdCtx.Provider value={id}>{children}</TabIdCtx.Provider>;
}

// Dipakai halaman yang polling/refresh berkala (mis. Inbox tiap 5 detik)
// supaya bisa PAUSE saat tab-nya sedang di background — tanpa ini, makin
// banyak tab dibuka, makin banyak juga polling paralel yang berjalan sia-
// sia karena tidak terlihat. Dipanggil di LUAR sistem tab (belum sempat
// dibungkus TabIdProvider) sengaja mengembalikan `true` (anggap selalu
// aktif) — aman, cuma berarti tidak ada penghematan, bukan salah fungsi.
export function useTabVisibility() {
  const myId = useContext(TabIdCtx);
  const { activeTabId } = useTabs();
  if (myId == null) return true;
  return myId === activeTabId;
}
