// Persistensi tab dalam-app (D-144, 9 September 2026) — pola SAMA PERSIS
// dengan sidebarOrder.js: baca/tulis localStorage dibungkus try/catch,
// gagal diam-diam (mode privat/localStorage penuh) daripada menjatuhkan
// seluruh sidebar/tab-strip. Isi tab (path & judul) murni preferensi
// tampilan PER PERANGKAT/BROWSER, bukan data bisnis — tidak butuh sinkron
// server, sama seperti alasan sidebarOrder.js.
const KEY = "open-tabs:v1";

export function loadTabs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.tabs) || parsed.tabs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveTabs({ tabs, activeId }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs, activeId }));
  } catch {
    // localStorage penuh/diblokir — tab tetap berfungsi untuk sesi ini,
    // cuma tidak akan dipulihkan setelah reload. Bukan error fatal.
  }
}
