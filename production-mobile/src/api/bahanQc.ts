import { useQuery } from "@tanstack/react-query";
import { api } from "@/auth/session";
import { wib } from "@/lib/waktu";

// PENDATAAN BAHAN — tim QC & Dokumentasi (keputusan Owner 14 Nov 2026). Endpoint SAMA dengan web Order Produksi & drawer Bahan:
//   GET  /production/work-orders?kelengkapan=BAHAN_BELUM_DICATAT&dari&sampai   unit yang sudah dikerjakan/selesai TANPA catatan pemakaian apa pun
//        (klasifikasi server: lib/domain/kelengkapanOrderProduksi.js; periode = tanggal order masuk/unit dibuat, kalender WIB)
//   GET  /production/units/:id/adopsi            panel unit: pemakaian aktual, izin (pemakaianAktual = unit:material:write), status unit
//   GET  /production/material-catalog?q=          katalog bahan Produksi + ketersediaan jujur + aturan satuan pakai
//   POST /production/units/:id/pembetulan-bahan/pratinjau   BACA-SAJA: dampak stok/HPP untuk unit TERKIRIM (wajib sebelum mencatat)
//   POST /units/:id/materials                     catat pemakaian (Idempotency-Key). ADMIN langsung; selain ADMIN → 202 PENGAJUAN diverifikasi ADMIN.

export type BarisOrderProduksi = {
  id: string; unitCode: string; merk: string | null; ukuran: string | null; status: string; createdAt: string;
  order: { orderNumber: string | null; customer: { name: string | null } | null } | null;
  adopsi?: { kerja?: { key: string; label: string } | null; meja?: string | null; pic?: { nama: string } | null; kelengkapan?: { keys: string[] } | null };
};
type DaftarOrder = { units: BarisOrderProduksi[]; total: number };

/** Batas bulan kalender WIB: geser 0 = bulan ini, -1 = bulan lalu. */
export function bulanWib(geser = 0, sekarang = new Date()) {
  const w = wib(sekarang);
  const m0 = new Date(Date.UTC(w.y, w.m + geser, 1));
  const y = m0.getUTCFullYear(); const m = m0.getUTCMonth();
  const akhir = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const p = (n: number) => String(n).padStart(2, "0");
  const NAMA = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return { dari: `${y}-${p(m + 1)}-01`, sampai: `${y}-${p(m + 1)}-${p(akhir)}`, label: `${NAMA[m]} ${y}` };
}

export function useBahanBelum(geser = 0, enabled = true) {
  const b = bulanWib(geser);
  return useQuery({
    queryKey: ["bahan-belum", b.dari],
    queryFn: () => api.get<DaftarOrder>("/production/work-orders", { query: { kelengkapan: "BAHAN_BELUM_DICATAT", dari: b.dari, sampai: b.sampai, urut: "terlama", pageSize: 200 } }),
    enabled,
    refetchInterval: 120_000,
  });
}
/** Pengajuan pemakaian yang masih menunggu verifikasi ADMIN (GET /production/pengajuan-pemakaian, default DIAJUKAN,DITAHAN).
 *  Server baru menganggap bahan "tercatat" SESUDAH diverifikasi — jadi unit yang sudah diajukan tetap muncul di daftar "belum dicatat";
 *  HP menandainya "Menunggu verifikasi" supaya tim tidak mencatat dua kali. */
export type PengajuanMenunggu = { id: string; unitId: string; status: string; diajukanPada: string; pengaju: string | null; ringkasan: { baris?: { bahan: string | null; qty: number; satuanInput?: string | null; satuanStok?: string | null }[] } | null };
export function usePengajuanMenunggu(enabled = true) {
  return useQuery({
    queryKey: ["pengajuan-pemakaian"],
    queryFn: () => api.get<{ pengajuan: PengajuanMenunggu[] }>("/production/pengajuan-pemakaian"),
    enabled,
    refetchInterval: 120_000,
  });
}
export function kelompokPengajuan(list: PengajuanMenunggu[] | undefined) {
  const m = new Map<string, PengajuanMenunggu[]>();
  for (const p of list ?? []) m.set(p.unitId, [...(m.get(p.unitId) ?? []), p]);
  return m;
}

/** Lencana tab Bahan: unit bulan ini yang belum ada bahannya DAN belum diajukan siapa pun. */
export function useBahanBelumBulanIni(enabled = true) {
  const belum = useBahanBelum(0, enabled);
  const aju = usePengajuanMenunggu(enabled);
  const sudahDiajukan = kelompokPengajuan(aju.data?.pengajuan);
  const perlu = (belum.data?.units ?? []).filter((u) => !sudahDiajukan.has(u.id)).length;
  return { perlu, total: belum.data?.total ?? 0, isLoading: belum.isLoading };
}

export type PemakaianBaris = { materialId: string; kode: string | null; nama: string | null; satuan: string | null; dipakai: number };
export type AdopsiUnit = {
  unit: { id: string; unitCode: string; status: string; merk: string | null; ukuran: string | null; order: { orderNumber: string | null; customer: { name: string | null } | null } };
  pemakaianAktual: { total: PemakaianBaris[] };
  izin: { pemakaianAktual: boolean };
};
export function useAdopsiUnit(unitId: string | undefined) {
  return useQuery({ queryKey: ["adopsi", unitId], queryFn: () => api.get<AdopsiUnit>(`/production/units/${unitId}/adopsi`), enabled: !!unitId });
}

export type AturanSatuan = { satuanStok: string; satuanPakai: string; faktor: number; teks: string } | null;
export type BahanKatalogQc = {
  materialId: string; kode: string; nama: string; satuan: string | null; kelompok: { label: string };
  tersedia: number | null; saldoDiketahui: boolean; keadaanLabel: string | null; satuanPakai: AturanSatuan;
};
export function cariKatalogBahan(q: string) {
  return api.get<{ rows: BahanKatalogQc[]; total: number }>("/production/material-catalog", { query: { q: q || undefined, limit: 40 } });
}

export type Pratinjau = {
  boleh: boolean; penghalang?: { kode: string; pesan: string }[];
  tindakan: { judul: string; teks: string }; waktu: { teks: string };
  stok: { saldoSebelum: number | null; saldoSesudah: number; saldoDilihat: unknown } | null;
  pemakaianBersih: { sebelum: number; sesudah: number }; bahan: { satuan: string };
  hppOperasional: { teks: string; sidik: unknown };
  peringatan?: { kode: string; pesan: string }[];
  sudahTercatat?: { perluKonfirmasi: boolean; tertaut: { kind: string; catatan?: string | null; dilaporkan?: string | null; qty?: number }[]; kemungkinan: { kind: string; catatan?: string | null; unit?: string }[] };
  pengecualianStok?: { perlu: boolean; sebabTidakBisa?: string | null };
};
export function pratinjauPembetulan(unitId: string, body: Record<string, unknown>, kunci: string) {
  return api.command<Pratinjau>("POST", `/production/units/${unitId}/pembetulan-bahan/pratinjau`, kunci, { body });
}

export type HasilCatat = { menungguVerifikasi?: boolean; ulang?: boolean; pesan?: string };
export function catatBahanUnit(unitId: string, body: Record<string, unknown>, kunci: string) {
  return api.command<HasilCatat>("POST", `/units/${unitId}/materials`, kunci, { body });
}
