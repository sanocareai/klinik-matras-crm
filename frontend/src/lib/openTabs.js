// Persistensi tab dalam-app (D-144, 9 September 2026) — pola SAMA PERSIS
// dengan sidebarOrder.js: baca/tulis localStorage dibungkus try/catch,
// gagal diam-diam (mode privat/localStorage penuh) daripada menjatuhkan
// seluruh sidebar/tab-strip. Isi tab (path & judul) murni preferensi
// tampilan PER PERANGKAT/BROWSER, bukan data bisnis — tidak butuh sinkron
// server, sama seperti alasan sidebarOrder.js.
const KEY = "open-tabs:v1";

// P12A: Mode Demo TIDAK boleh bertahan lintas sesi/logout — parameter ?demo=1 dibuang dari path tab saat disimpan DAN saat dipulihkan.
export function stripDemoParam(path) {
  if (typeof path !== "string" || !path.includes("demo=")) return path;
  const [base, query = ""] = path.split("?");
  const kept = query.split("&").filter((kv) => kv && !kv.startsWith("demo="));
  return kept.length ? `${base}?${kept.join("&")}` : base;
}
const cleanTabs = (tabs) => (Array.isArray(tabs) ? tabs.map((t) => (t && typeof t.path === "string" ? { ...t, path: stripDemoParam(t.path) } : t)) : tabs);

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

export function saveTabs({ tabs, activeId }) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs: cleanTabs(tabs), activeId }));
  } catch {
    // localStorage penuh/diblokir — tab tetap berfungsi untuk sesi ini,
    // cuma tidak akan dipulihkan setelah reload. Bukan error fatal.
  }
}
