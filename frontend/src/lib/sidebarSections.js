// P12B.2 — status buka/tutup SECTION sidebar (akordeon "Mode Kerja") per perangkat. HANYA preferensi tampilan: tidak pernah memengaruhi
// izin/akses menu (itu ditentukan peran di lib/menuVisibility.js + server). Gagal baca/tulis localStorage diam-diam (mode privat).
const KEY_PREFIX = "sidebar-sections:";
export function loadToggledSections(divisionKey) {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY_PREFIX + divisionKey) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : []);
  } catch { return new Set(); }
}
export function saveToggledSections(divisionKey, set) {
  try { localStorage.setItem(KEY_PREFIX + divisionKey, JSON.stringify([...set])); } catch { /* preferensi tampilan saja */ }
}
export function resetSidebarPreferences(divisionKey) {
  try { localStorage.removeItem(KEY_PREFIX + divisionKey); localStorage.removeItem(`sidebar-order:${divisionKey}`); } catch { /* idem */ }
}
