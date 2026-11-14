// MODEL MURNI tab ORDER PRODUKSI (diuji tanpa React). Cermin halaman "Order Produksi" web: daftar SELURUH unit + profil unit.
// Semua status, kelengkapan, dan hitungan berasal dari server (GET /production/work-orders) — di sini hanya dipilih & diberi warna.
import type { ToneKey } from "@/design/tokens";

export type FilterOrder = "semua" | "aktif" | "terkirim" | "bahan";
/** "semua" = seluruh waktu; "0" = bulan ini; "-1" = bulan lalu (kalender WIB, menurut tanggal order masuk). */
/** "semua" = seluruh waktu; "0" = bulan ini; "-1" = bulan lalu; "rentang" = tanggal pilihan sendiri (kalender WIB, menurut tanggal order masuk). */
export type PeriodeOrder = "semua" | "0" | "-1" | "rentang";

type Chip3 = { key: string; label: string; tone?: string | null; detail?: string | null };
export type BarisOrder = {
  id: string; unitCode: string; merk: string | null; ukuran: string | null; status: string; createdAt: string;
  order: { orderNumber: string | null; customer: { name: string | null } | null } | null;
  adopsi?: {
    statusOrder?: Chip3 | null; posisi?: Chip3 | null;
    kerja?: (Chip3 & { sourceLabel?: string | null }) | null;
    pic?: { nama: string } | null; meja?: string | null;
    kelengkapan?: { keys: string[] } | null;
  } | null;
};
export type HalamanOrder = {
  units: BarisOrder[]; total: number; page: number; pageSize: number; hasMore: boolean;
  displayStatusCounts?: Record<string, number>;
};

export const UKURAN_HALAMAN_ORDER = 30;
const AKTIF = "PENGAMBILAN,DIPROSES,SIAP_KIRIM"; // semua yang belum Terkirim

/** Parameter GET /production/work-orders untuk satu halaman. `bulan` = batas bulan WIB (dari bulanWib) bila periode bukan "semua". */
export function paramDaftarOrder(p: { q: string; filter: FilterOrder; bulan: { dari: string; sampai: string } | null }, page: number) {
  return {
    q: p.q.trim() || undefined,
    displayStatus: p.filter === "aktif" ? AKTIF : p.filter === "terkirim" ? "TERKIRIM" : undefined,
    kelengkapan: p.filter === "bahan" ? "BAHAN_BELUM_DICATAT" : undefined,
    // "Bahan belum dicatat" = daftar kerja → yang paling lama menunggu di atas; selain itu order terbaru di atas.
    urut: p.filter === "bahan" ? "terlama" : undefined,
    dari: p.bulan?.dari, sampai: p.bulan?.sampai,
    page, pageSize: UKURAN_HALAMAN_ORDER,
  };
}

/** Hitungan chip filter dari respons server (status order). `null` = belum dimuat. */
export function hitungFilter(c: Record<string, number> | undefined) {
  if (!c) return null;
  const n = (k: string) => c[k] ?? 0;
  const aktif = n("PENGAMBILAN") + n("DIPROSES") + n("SIAP_KIRIM");
  return { aktif, terkirim: n("TERKIRIM"), semua: aktif + n("TERKIRIM") };
}

const NADA: Record<string, ToneKey> = { green: "green", accent: "blue", orange: "orange", red: "red", neutral: "gray" };
export const nadaServer = (t: string | null | undefined): ToneKey => NADA[String(t ?? "")] ?? "gray";
const NADA_STATUS_ORDER: Record<string, ToneKey> = { TERKIRIM: "green", SIAP_KIRIM: "blue", DIPROSES: "blue", PENGAMBILAN: "gray" };

export type ChipOrder = { label: string; tone: ToneKey };
/** Ringkasan satu baris daftar: kode, pelanggan · kasur, dan chip status (status order, status kerja, bahan). */
export function ringkasBaris(u: BarisOrder, sudahDiajukan = false): { kode: string; sub: string; chips: ChipOrder[]; bahanBelum: boolean } {
  const a = u.adopsi ?? {};
  const kasur = [u.merk, u.ukuran].filter(Boolean).join(" ");
  const chips: ChipOrder[] = [];
  if (a.statusOrder?.label) chips.push({ label: a.statusOrder.label, tone: NADA_STATUS_ORDER[a.statusOrder.key] ?? "gray" });
  // Status kerja hanya ditampilkan selama masih berguna: unit yang sudah Terkirim & Selesai tidak perlu chip kedua.
  // (dan tidak diulang bila labelnya sama dengan status order, mis. "Dibatalkan").
  if (a.kerja?.label && !(a.statusOrder?.key === "TERKIRIM" && a.kerja.key === "SELESAI") && a.kerja.label !== a.statusOrder?.label) chips.push({ label: a.kerja.label, tone: nadaServer(a.kerja.tone) });
  const bahanBelum = !!a.kelengkapan?.keys?.includes("BAHAN_BELUM_DICATAT");
  if (bahanBelum) chips.push(sudahDiajukan ? { label: "Bahan diajukan", tone: "green" } : { label: "Bahan belum dicatat", tone: "orange" });
  return { kode: u.unitCode, sub: [u.order?.customer?.name, kasur].filter(Boolean).join(" · ") || "—", chips, bahanBelum };
}

// ── Tanggal ──
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-09-27" atau ISO → "27 Sep 2026" (kalender WIB untuk ISO berjam). Kosong/tidak sah → null. */
export function tanggalPendek(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}`;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return null;
  const w = new Date(t + 7 * 3600_000);
  return `${w.getUTCDate()} ${BULAN[w.getUTCMonth()]} ${w.getUTCFullYear()}`;
}

// ── Dokumentasi (modul Dokumentasi Produksi: /production-v2/documentation/*) ──
export type ItemDok = { url: string; kind?: string; source?: string | null; caption?: string | null; createdAt?: string | null };
export type KategoriDok = { key: string; label: string; group: "BEFORE" | "PROCESS" | "AFTER"; applicable: boolean; count: number; min: number; status: string; missing: number; items?: ItemDok[] };
const LABEL_GRUP = { BEFORE: "Sebelum", PROCESS: "Proses", AFTER: "Sesudah" } as const;

/** Kategori yang BERLAKU untuk unit ini, dikelompokkan Sebelum · Proses · Sesudah (urutan server dipertahankan). */
export function kelompokDokumentasi(categories: KategoriDok[] | undefined) {
  const berlaku = (categories ?? []).filter((c) => c.applicable);
  return (["BEFORE", "PROCESS", "AFTER"] as const)
    .map((g) => ({ key: g, label: LABEL_GRUP[g], kategori: berlaku.filter((c) => c.group === g) }))
    .filter((g) => g.kategori.length > 0);
}
/** Chip status satu kategori: jumlah foto / minimal, warna dari status server (tidak dinilai ulang di HP). */
export function chipKategori(c: Pick<KategoriDok, "count" | "min" | "status" | "missing">): ChipOrder {
  // Dokumentasi tambahan tidak punya jumlah minimal: cukup tampilkan jumlah foto.
  if (!(c.min > 0)) return c.count > 0 ? { label: `${c.count} foto`, tone: "blue" } : { label: "Belum ada", tone: "gray" };
  const angka = `${c.count}/${c.min}`;
  if (c.status === "LENGKAP") return { label: `${angka} · lengkap`, tone: "green" };
  if (c.status === "KURANG") return { label: `${angka} · kurang ${c.missing}`, tone: "orange" };
  return { label: angka, tone: c.count > 0 ? "blue" : "gray" };
}
export const MAKS_FOTO_SEKALI = 6; // batas server per unggahan
/** Kategori dokumentasi tambahan → bentuk kategori matriks (berlaku semua, tanpa minimal) supaya tampil dengan komponen yang sama. */
export const kategoriTambahan = (cs: Omit<KategoriDok, "applicable" | "min" | "status" | "missing">[] | undefined): KategoriDok[] =>
  (cs ?? []).map((c) => ({ ...c, applicable: true, min: 0, status: "TAMBAHAN", missing: 0 }));
