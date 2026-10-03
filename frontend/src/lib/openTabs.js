// Persistensi tab dalam-app (D-144, 9 September 2026) — pola SAMA PERSIS
// dengan sidebarOrder.js: baca/tulis localStorage dibungkus try/catch,
// gagal diam-diam (mode privat/localStorage penuh) daripada menjatuhkan
// seluruh sidebar/tab-strip. Isi tab (path & judul) murni preferensi
// tampilan PER PERANGKAT/BROWSER, bukan data bisnis — tidak butuh sinkron
// server, sama seperti alasan sidebarOrder.js.
import { tabPathFor } from "./legacyProductionRoutes.js";
import { titleFromPath } from "./tabTitles.js";

const KEY = "open-tabs:v1";

// P12A: Mode Demo TIDAK boleh bertahan lintas sesi/logout — parameter ?demo=1 dibuang dari path tab saat disimpan DAN saat dipulihkan.
export function stripDemoParam(path) {
  if (typeof path !== "string" || !path.includes("demo=")) return path;
  const [base, query = ""] = path.split("?");
  const kept = query.split("&").filter((kv) => kv && !kv.startsWith("demo="));
  return kept.length ? `${base}?${kept.join("&")}` : base;
}
// P12B.2: tab tersimpan yang menunjuk rute Production LAMA diterjemahkan ke halaman kanonis baru (tujuan mandiri → Ringkasan).
// Judul ikut diperbarui bila path berpindah ke halaman baru (mis. tab "Unit" → "Order Produksi"), supaya tidak tersisa tab berlabel halaman yang sudah dihapus.
const cleanTab = (t) => {
  if (!t || typeof t.path !== "string") return t;
  const before = stripDemoParam(t.path); const after = tabPathFor(before);
  return after === before ? { ...t, path: before } : { ...t, path: after, title: titleFromPath(after) };
};
const cleanTabs = (tabs) => (Array.isArray(tabs) ? tabs.map(cleanTab) : tabs);

export function loadTabs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs) || parsed.tabs.length === 0) return null;
    return { ...parsed, tabs: cleanTabs(parsed.tabs) };
  } catch {
    return null;
  }
}

// Path tab AKTIF yang tersimpan — tujuan "kembali" dari halaman mandiri (aplikasi Meja/Corner/Dokumentasi), yang dibuka lewat
// window.location.assign sehingga TabsProvider tidak hidup di sana. `exclude` = path halaman mandiri itu sendiri (jangan balik ke dirinya).
// Mengembalikan null bila tak ada tab tersimpan → pemanggil jatuh ke /portal.
export function lastActiveTabPath(exclude) {
  const saved = loadTabs();
  const tab = saved?.tabs.find((t) => t.id === saved.activeId);
  const path = typeof tab?.path === "string" ? tab.path : null;
  if (!path || !path.startsWith("/")) return null;
  if (exclude && path.split("?")[0] === exclude) return null;
  return path;
}

export function saveTabs({ tabs, activeId }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: cleanTabs(tabs), activeId }));
  } catch {
    // localStorage penuh/diblokir — tab tetap berfungsi untuk sesi ini,
    // cuma tidak akan dipulihkan setelah reload. Bukan error fatal.
  }
}
