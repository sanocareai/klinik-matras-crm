// Susun ulang menu sidebar per-divisi (D-060, 4 September 2026) — laporan
// owner: mau bisa "geser-geser" urutan menu sendiri (mis. Route Planner ke
// atas, Semua Order ke bawah). Preferensi PER PERANGKAT/BROWSER
// (localStorage), BUKAN per akun tersimpan di server — ini murni tata
// letak, bukan data bisnis, dan tidak butuh round-trip API untuk sesuatu
// yang cuma dibaca ulang oleh pemiliknya sendiri di perangkat yang sama.
//
// Disimpan PER SECTION (bukan flat per-divisi) — menggeser dalam
// "OPERASIONAL" tidak bisa menyelipkan diri ke tengah section "LAPORAN".
// Pengelompokan section tetap tegas, cuma urutan item DI DALAM section yang
// bisa diubah pengguna.
const KEY_PREFIX = "sidebar-order:";

function readAll(divisionKey) {
  try {
    return JSON.parse(localStorage.getItem(KEY_PREFIX + divisionKey) || "{}");
  } catch {
    return {};
  }
}

function writeAll(divisionKey, data) {
  try {
    localStorage.setItem(KEY_PREFIX + divisionKey, JSON.stringify(data));
  } catch {
    // localStorage penuh/diblokir browser (mode privat dkk) — biarkan
    // urutan default, jangan sampai error ini menjatuhkan seluruh sidebar.
  }
}

// Terapkan urutan tersimpan ke daftar item SATU section.
// - Item yang path-nya SUDAH TIDAK ADA di `items` (menu dihapus/diganti
//   sejak urutan disimpan) otomatis diabaikan, bukan menyisakan slot kosong.
// - Item BARU yang belum pernah diurutkan (ditambah developer setelah user
//   menyimpan urutan) ditempel di AKHIR daftar, dalam urutan asli relatif
//   satu sama lain — supaya menu baru tetap terlihat, bukan hilang diam-diam.
export function applyCustomOrder(items, savedTos) {
  if (!savedTos || savedTos.length === 0) return items;
  const byTo = new Map(items.map((it) => [it.to, it]));
  const urut = savedTos.map((to) => byTo.get(to)).filter(Boolean);
  const sudahTerurut = new Set(urut.map((it) => it.to));
  const sisanya = items.filter((it) => !sudahTerurut.has(it.to));
  return [...urut, ...sisanya];
}

export function getSectionOrder(divisionKey, section) {
  return readAll(divisionKey)[section] || null;
}

export function saveSectionOrder(divisionKey, section, orderedTos) {
  const all = readAll(divisionKey);
  all[section] = orderedTos;
  writeAll(divisionKey, all);
}
