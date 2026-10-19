// Navigasi sidebar Gudang (UX Gudang Tahap 3) — logika murni (tanpa JSX) agar bisa diuji `node --test`. Enam kelompok utama: Beranda, Penerimaan, Stok, Produksi, Kontrol, Laporan; menu rinci jadi anak yang bisa dibuka.
// HANYA satu kelompok terbuka pada satu waktu (sidebar tidak dipenuhi seluruh anak menu); kelompok yang berisi halaman aktif selalu terbuka; kelompok terakhir yang dibuka diingat per perangkat.
// Ini preferensi TAMPILAN: tidak pernah memengaruhi izin/akses (peran dan izin diputuskan di lib/menuVisibility.js + server) dan tidak mengubah rute apa pun.
const KEY = "sidebar-gudang-grup";

/** Peta kode antrean server (GET /inventory/beranda, tiap `kode` → `jumlah`) ke badge menu. Badge HANYA untuk pekerjaan yang butuh tindakan (bukan informasi). */
export const BADGE_ANTREAN = Object.freeze({
  "/warehouse/barang-akan-datang": ["PERLU_DICATAT_TIBA"], // jadwal lewat tanpa catatan tiba
  "/warehouse/goods-receipt": ["BELUM_MASUK_STOK"], // sudah tiba, belum masuk stok
  "/warehouse/material-issue": ["PERMINTAAN_BAHAN"],
  "/warehouse/stock-count": ["SELISIH_MENUNGGU"],
});

/** `antrean` = { KODE: jumlah } atau null. Mengembalikan jumlah (>0) atau null. */
export function badgeItem(to, antrean) {
  const kunci = BADGE_ANTREAN[to]; if (!kunci || !antrean) return null;
  const n = kunci.reduce((a, k) => a + (Number(antrean[k]) || 0), 0);
  return n > 0 ? n : null;
}
/** Dari respons berandaGudang → { KODE: jumlah }. */
export const antreanDariBeranda = (b) => (Array.isArray(b?.tugas) ? b.tugas.reduce((m, x) => { if (x?.kode) m[x.kode] = Number(x.jumlah) || 0; return m; }, {}) : null);

/** Dengan badge pada item + jumlah per kelompok. */
export function denganBadgeGudang(sections, antrean) {
  return sections.map((s) => {
    const items = s.items.map((i) => { const n = badgeItem(i.to, antrean); return n ? { ...i, badgeN: n } : i; });
    return { ...s, items, badgeKelompok: items.reduce((a, i) => a + (i.badgeN ?? 0), 0) };
  });
}

const cocokPath = (pathname, to) => { const p = String(to).split("?")[0]; return pathname === p || pathname.startsWith(p + "/"); };
/** Nama kelompok yang berisi halaman aktif (null bila tidak ada — mis. halaman di luar menu). */
export function kelompokAktif(sections, pathname) {
  const hit = sections.find((s) => s.items.some((i) => cocokPath(pathname, i.to)));
  return hit?.section ?? null;
}
export function bacaKelompokTerakhir() { try { return localStorage.getItem(KEY) || null; } catch { return null; } }
export function simpanKelompokTerakhir(nama) { try { if (nama) localStorage.setItem(KEY, nama); else localStorage.removeItem(KEY); } catch { /* preferensi tampilan saja */ } }

const KEY_TERBUKA = "sidebar-gudang-grup-terbuka";
const bisaBuka = (sections, nama) => !!nama && sections.some((s) => s.section === nama && !s.langsung);

/** Daftar kelompok yang diingat di perangkat ini (array nama) — null bila belum pernah disimpan. Migrasi: kunci lama (satu kelompok terakhir) dibaca sebagai satu kelompok terbuka. */
export function bacaKelompokTerbuka() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY_TERBUKA) ?? "null"); if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    const lama = bacaKelompokTerakhir(); return lama ? [lama] : null;
  } catch { return null; }
}
export function simpanKelompokTerbuka(daftar) { try { localStorage.setItem(KEY_TERBUKA, JSON.stringify([...daftar])); } catch { /* preferensi tampilan saja */ } }

/**
 * Kelompok yang terbuka — STATE TIAP KELOMPOK INDEPENDEN (beberapa boleh terbuka bersamaan). Keadaan awal = yang diingat di perangkat (hanya nama yang masih valid) ∪ kelompok halaman aktif
 * (halaman aktif selalu terlihat). Kelompok langsung (Beranda) tidak punya anak sehingga tidak pernah "terbuka". Urutan hasil mengikuti urutan sidebar.
 */
export function kelompokTerbukaAwal({ sections, pathname, tersimpan = null }) {
  const pilih = new Set((tersimpan ?? []).filter((n) => bisaBuka(sections, n)));
  const aktif = kelompokAktif(sections, pathname); if (bisaBuka(sections, aktif)) pilih.add(aktif);
  return sections.map((s) => s.section).filter((n) => pilih.has(n));
}
/** Berpindah halaman: kelompok halaman aktif DITAMBAHKAN (yang lain tidak ditutup). Mengembalikan array yang sama bila tidak ada perubahan. */
export function bukaKelompokAktif({ sections, pathname, terbuka }) {
  const aktif = kelompokAktif(sections, pathname);
  return bisaBuka(sections, aktif) && !terbuka.includes(aktif) ? [...terbuka, aktif] : terbuka;
}
/** Klik judul kelompok: hanya membalik kelompok itu. */
export const balikKelompok = (terbuka, nama) => (terbuka.includes(nama) ? terbuka.filter((n) => n !== nama) : [...terbuka, nama]);
