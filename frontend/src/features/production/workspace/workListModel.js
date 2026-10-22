// Ruang Kerja Status Produksi — model MURNI (diuji node --test, tanpa React/DOM).
//
// Empat makna status yang TIDAK dicampur dan TIDAK diturunkan satu dari yang lain (kontrak server: productionWorkList.js):
//   Order Sales · Posisi fisik · Status kerja · Tahap Produksi (Meja). Tahap Meja hanya ada bila unit punya pekerjaan di alur Meja; selain itu "Belum di alur Meja" — tidak pernah ditebak.

export const LIST_PATH = "/bengkel/production-v2";
/** Jalur Ruang Kerja Unit (rute tersendiri: pindah rute = Back browser bekerja; bagian di query). */
export const jalurUnit = (unitId, bagian = "ringkasan") => `${LIST_PATH}/unit/${unitId}${bagian && bagian !== "ringkasan" ? `?bagian=${bagian}` : ""}`;

export const BAGIAN = Object.freeze([
  { key: "ringkasan", label: "Ringkasan" },
  { key: "pekerjaan", label: "Pekerjaan" },
  { key: "bahan", label: "Bahan" },
  { key: "dokumentasi", label: "Dokumentasi" },
  { key: "riwayat", label: "Riwayat" },
]);
export const BAGIAN_KEYS = Object.freeze(BAGIAN.map((b) => b.key));

export const FILTERS = Object.freeze([
  { key: "SEMUA", label: "Semua aktif" }, { key: "PERLU_TINDAKAN", label: "Perlu tindakan" }, { key: "BELUM_DITERIMA", label: "Belum diterima workshop" },
  { key: "BELUM_DIJADWALKAN", label: "Belum dijadwalkan" }, { key: "DIKERJAKAN", label: "Sudah dikerjakan" }, { key: "TERTAHAN", label: "Tertunda / menunggu" }, { key: "LEWAT_TARGET", label: "Lewat target" },
]);
export const SORTS = Object.freeze([
  { key: "PERHATIAN", label: "Paling perlu tindakan" }, { key: "TARGET", label: "Target terdekat" }, { key: "TERBARU", label: "Order terbaru" }, { key: "PELANGGAN", label: "Pelanggan A–Z" },
]);
const FILTER_KEYS = FILTERS.map((f) => f.key); const SORT_KEYS = SORTS.map((s) => s.key);

export const DEFAULT_STATE = Object.freeze({ tampilan: "daftar", scope: "aktif", q: "", filter: "SEMUA", sort: "PERHATIAN", buka: null, unit: null, bagian: "ringkasan" });

/** Keadaan layar dari query string (nilai tak dikenal jatuh ke bawaan). */
export function bacaKeadaan(params) {
  const g = (k) => (typeof params?.get === "function" ? params.get(k) : params?.[k]) ?? null;
  const bagian = g("bagian");
  return {
    tampilan: g("tampilan") === "pipeline" ? "pipeline" : "daftar",
    scope: g("scope") === "riwayat" ? "riwayat" : "aktif",
    q: String(g("q") ?? "").slice(0, 80),
    filter: FILTER_KEYS.includes(g("filter")) ? g("filter") : "SEMUA",
    sort: SORT_KEYS.includes(g("sort")) ? g("sort") : "PERHATIAN",
    buka: g("buka") || null,
    unit: g("unit") || null,
    bagian: BAGIAN_KEYS.includes(bagian) ? bagian : "ringkasan",
  };
}
/** Query string ringkas: hanya nilai yang BUKAN bawaan. */
export function tulisKeadaan(state) {
  const s = { ...DEFAULT_STATE, ...state }; const out = new URLSearchParams();
  if (s.tampilan !== DEFAULT_STATE.tampilan) out.set("tampilan", s.tampilan);
  if (s.scope !== DEFAULT_STATE.scope) out.set("scope", s.scope);
  if (s.q) out.set("q", s.q);
  if (s.filter !== DEFAULT_STATE.filter) out.set("filter", s.filter);
  if (s.sort !== DEFAULT_STATE.sort) out.set("sort", s.sort);
  if (s.buka) out.set("buka", s.buka);
  if (s.unit) { out.set("unit", s.unit); if (s.bagian !== DEFAULT_STATE.bagian) out.set("bagian", s.bagian); }
  return out;
}

/** Aksi "tindakan berikutnya" server → bagian ruang kerja unit yang menanganinya. */
export function bagianUntukAksi(aksi) {
  switch (aksi) {
    case "SET_TARGET": case "OPEN_PLAN": case "START_WORK": case "FINISH_WORK": case "MARK_READY": case "RESOLVE_DELAY": return "pekerjaan";
    case "PLAN_MATERIAL": case "RECORD_MATERIAL": return "bahan";
    default: return "ringkasan";
  }
}

export const NADA_PERHATIAN = Object.freeze({ 3: "red", 2: "orange", 1: "neutral", 0: "neutral" });
export const nadaPerhatian = (level) => NADA_PERHATIAN[level] ?? "neutral";

/** "2 di workshop · 1 sudah dijemput" — rincian posisi order; tidak pernah menggabung jadi satu label palsu. */
export function ringkasanPosisi(posisi = []) {
  if (!posisi.length) return "—";
  if (posisi.length === 1) return posisi[0].jumlah > 1 ? `${posisi[0].jumlah} unit · ${posisi[0].label}` : posisi[0].label;
  return posisi.map((p) => `${p.jumlah} ${p.label}`).join(" · ");
}
export const ringkasanKerja = (kerja = []) => ringkasanPosisi(kerja);

/** Teks tahap Produksi (Meja) — jujur: tidak ada pekerjaan di alur Meja = "Belum di alur Meja". */
export function teksTahapMeja(alurMeja) {
  if (!alurMeja) return { teks: "Belum di alur Meja", ada: false };
  if (alurMeja.status === "PENDING_ARRIVAL") return { teks: "Menunggu unit diterima di alur Meja", ada: true };
  const bagian = [alurMeja.tahap, alurMeja.meja ? String(alurMeja.meja).replace("TABLE_", "Meja ") : null].filter(Boolean);
  return { teks: bagian.length ? bagian.join(" · ") : (alurMeja.statusLabel || "Di alur Meja"), ada: true };
}

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "25 Okt" (WIB). Tahun disertakan bila bukan tahun berjalan. */
export function tanggalSingkat(iso, now = new Date()) {
  if (!iso) return null; const t = new Date(iso).getTime(); if (Number.isNaN(t)) return null;
  const d = new Date(t + 7 * 3600_000); const n = new Date(now.getTime() + 7 * 3600_000);
  return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}${d.getUTCFullYear() !== n.getUTCFullYear() ? ` ${d.getUTCFullYear()}` : ""}`;
}
/** Badge sisa hari ke target: Lewat N hari / Hari ini / Besok / tanggal. */
export function badgeTarget(iso, { now = new Date(), selesai = false } = {}) {
  if (!iso) return { teks: "Belum ada target", nada: "neutral", ada: false };
  const hari = (v) => Math.floor((new Date(v).getTime() + 7 * 3600_000) / 86_400_000);
  const selisih = hari(iso) - hari(now);
  if (selesai) return { teks: tanggalSingkat(iso, now), nada: "neutral", ada: true };
  if (selisih < 0) return { teks: `Lewat ${-selisih} hari`, nada: "red", ada: true };
  if (selisih === 0) return { teks: "Hari ini", nada: "orange", ada: true };
  if (selisih === 1) return { teks: "Besok", nada: "orange", ada: true };
  return { teks: tanggalSingkat(iso, now), nada: "neutral", ada: true };
}

/** Pipeline dikelompokkan: kolom tahap yang banyak dirangkum jadi lajur; kolom kosong tidak menjadi lajur. */
export const KELOMPOK_PIPELINE = Object.freeze([
  { key: "MENUJU", label: "Menuju workshop", kolom: ["AKAN_MASUK", "DALAM_PERJALANAN", "TIBA_BELUM_MULAI"] },
  { key: "PENGERJAAN", label: "Pengerjaan", kolom: ["PENGERJAAN", "UJI_HASIL", "BONGKAR", "UJI_FONDASI", "FONDASI", "LAPISAN", "UJI_TEKSTUR"] },
  { key: "FINISHING", label: "Finishing", kolom: ["CORNER"] },
  { key: "SIAP", label: "Siap kirim", kolom: ["SIAP_KIRIM"] },
]);
/**
 * @param columns kolom Command Center ({key,label,items[]}); unit yang SUDAH Terkirim/Dibatalkan tidak dimasukkan (dilaporkan terpisah sebagai `tertinggal`).
 * @param belumMeja unit aktif tanpa pekerjaan di alur Meja (dari daftar kerja) — lajur tersendiri "Belum di alur Meja".
 */
export function kelompokkanPipeline(columns = [], belumMeja = []) {
  const byKey = new Map((columns || []).map((c) => [c.key, c]));
  const tertinggal = [];
  const lajur = KELOMPOK_PIPELINE.map((g) => {
    const items = [];
    for (const k of g.kolom) {
      const col = byKey.get(k); if (!col) continue;
      for (const it of col.items || []) {
        const st = it.unit?.status ?? it.unitStatus;
        if (st === "DELIVERED" || st === "CANCELLED") { tertinggal.push(it); continue; }
        items.push({ ...it, __tahap: col.label });
      }
    }
    return { key: g.key, label: g.label, items };
  });
  const dikenal = new Set(KELOMPOK_PIPELINE.flatMap((g) => g.kolom));
  const lain = [];
  for (const c of columns || []) if (!dikenal.has(c.key)) for (const it of c.items || []) lain.push({ ...it, __tahap: c.label });
  if (lain.length) lajur.push({ key: "LAIN", label: "Lainnya", items: lain });
  lajur.push({ key: "BELUM_MEJA", label: "Belum di alur Meja", items: belumMeja, catatan: "Dikerjakan lewat pencatatan Admin" });
  return { lajur: lajur.filter((l) => l.items.length > 0), tertinggal, jumlah: lajur.reduce((n, l) => n + l.items.length, 0) };
}

// ── pemulihan posisi gulir & order terbuka (sessionStorage; aman bila tidak tersedia) ──
const KUNCI_GULIR = "sp-workspace-gulir";
export function simpanGulir(nilai, penyimpan = globalThis.sessionStorage) {
  try { penyimpan?.setItem(KUNCI_GULIR, JSON.stringify({ ...nilai, at: Date.now() })); } catch { /* tanpa penyimpanan: layar tetap berfungsi */ }
}
export function bacaGulir(penyimpan = globalThis.sessionStorage, { umurMaksMs = 30 * 60_000, now = Date.now() } = {}) {
  try {
    const v = JSON.parse(penyimpan?.getItem(KUNCI_GULIR) || "null");
    if (!v || typeof v.y !== "number" || now - (v.at ?? 0) > umurMaksMs) return null;
    return v;
  } catch { return null; }
}
export function hapusGulir(penyimpan = globalThis.sessionStorage) { try { penyimpan?.removeItem(KUNCI_GULIR); } catch { /* abaikan */ } }
