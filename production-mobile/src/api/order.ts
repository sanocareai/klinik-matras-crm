import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "@/auth/session";
import { mimeBerkas, type BerkasLokal } from "./aksi";
import { paramDaftarOrder, type FilterOrder, type HalamanOrder, type ItemDok, type KategoriDok } from "@/features/order";

// ORDER PRODUKSI di HP — endpoint yang SAMA dengan halaman Order Produksi & Ruang Kerja Unit di web. Semuanya sudah ada di server:
//   GET  /production/work-orders                    daftar SELURUH unit (cari, status order, kelengkapan, periode, halaman) — baca-saja
//   GET  /production/units/:id/ruang-kerja          header unit: order Sales, kondisi pelanggan, alur Meja, ketersediaan Dokumentasi + alasannya
//   GET  /production/units/:id/adopsi               status kerja, pemakaian bahan, izin                       (lihat api/bahanQc.ts)
//   GET  /production-v2/documentation/runs/:runId   matriks dokumentasi per kategori + foto
//   POST /production-v2/documentation/upload        unggah foto (multipart runId + files, ≤ 6 foto, JPG/PNG/WEBP ≤ 15 MB)
//   POST /production-v2/documentation/runs/:runId/submit   catat foto ke satu kategori (Idempotency-Key)
//   GET/POST /production/units/:id/dokumentasi-tambahan     dokumentasi untuk unit TANPA Dokumentasi V2 (mis. order lama terkirim) — 14 Nov 2026
// Dokumentasi per kategori hanya tersedia untuk unit yang punya pekerjaan Produksi V2 dan sudah dinyalakan; server yang memutuskan
// (ruang-kerja.dokumentasi) dan memberi alasan jujur bila tidak tersedia — aplikasi tidak menebak.

export function useDaftarOrder(p: { q: string; filter: FilterOrder; bulan: { dari: string; sampai: string } | null }) {
  return useInfiniteQuery({
    queryKey: ["order-daftar", p.q.trim(), p.filter, p.bulan?.dari ?? "semua"],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<HalamanOrder>("/production/work-orders", { query: paramDaftarOrder(p, pageParam) }),
    getNextPageParam: (akhir) => (akhir.hasMore ? akhir.page + 1 : undefined),
    staleTime: 30_000,
  });
}

type Ket = { key: string | null; label: string };
export type RuangKerja = {
  unit: { id: string; unitCode: string; merk: string | null; ukuran: string | null; status: string; statusUnit: string | null };
  order: {
    id: string; orderNumber: string | null; pelanggan: { id: string; name: string | null } | null; layanan: string[];
    statusOrder: Ket & { terkunci: boolean }; jumlahUnit: number; unitLain: { id: string; unitCode: string }[];
    detail: {
      kondisiPelanggan: { sakit: boolean | null; label: string; keluhan: string[] };
      catatanProduksi: string | null;
      komplain: { tanggal: string | null; rincian: string | null; selesai: boolean } | null;
      janjiPelanggan: string | null; pengirimanDikonfirmasi: string | null;
    };
  };
  alurMeja: { runId: string; status: string; statusLabel: string; tahap: string | null } | null;
  tindakan: { aksi: string; label: string; aktor: string; detail: string | null } | null;
  perhatian: { kode: string; level: number; teks: string } | null;
  dokumentasi: { tersedia: boolean; runId: string | null; bolehUnggah: boolean; alasan: string | null };
  /** Aktif hanya bila Dokumentasi V2 tidak bisa menerima foto untuk unit ini (server yang memutuskan). Server lama: tidak ada. */
  dokumentasiTambahan?: { aktif: boolean; bolehUnggah: boolean; alasan: string | null };
};
export function useRuangKerja(unitId: string | undefined) {
  return useQuery({ queryKey: ["ruang-kerja", unitId], queryFn: () => api.get<RuangKerja>(`/production/units/${unitId}/ruang-kerja`), enabled: !!unitId });
}

export type DetailDok = { runId: string; canWrite: boolean; categories: KategoriDok[]; totals?: { photos: number; required: number; satisfied: number } };
export function useDokumentasi(runId: string | null | undefined, aktif = true) {
  return useQuery({
    queryKey: ["dokumentasi", runId],
    queryFn: () => api.get<DetailDok>(`/production-v2/documentation/runs/${runId}`),
    enabled: !!runId && aktif,
    // URL foto bertanda tangan kedaluwarsa; ambil ulang berkala supaya tetap sah.
    refetchInterval: 5 * 60_000,
  });
}

/** Unggah foto dokumentasi (maks 6 per panggilan). Server menamai berkas dari hash isinya → aman diulang. */
export async function unggahFotoDokumentasi(runId: string, berkas: BerkasLokal[]): Promise<ItemDok[]> {
  const fd = new FormData();
  fd.append("runId", runId);
  berkas.forEach((b, i) => {
    const type = mimeBerkas({ ...b, type: "image" });
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    // React Native FormData menerima objek berkas { uri, name, type }.
    fd.append("files", { uri: b.uri, name: `dok-${i + 1}.${ext}`, type } as unknown as Blob);
  });
  const r = await api.upload<{ items: ItemDok[] }>("/production-v2/documentation/upload", fd);
  if (!r?.items?.length) throw new Error("Server tidak mengembalikan foto");
  return r.items;
}

/** Catat foto yang sudah terunggah ke satu kategori dokumentasi. */
export function kirimDokumentasi(runId: string, kategori: string, items: ItemDok[], kunci: string) {
  return api.command<unknown>("POST", `/production-v2/documentation/runs/${runId}/submit`, kunci, {
    body: { category: kategori, items: items.map((it, i) => ({ url: it.url, caption: null, order: i })) },
  });
}

// ── Dokumentasi tambahan (unit tanpa Dokumentasi V2) ──
export type DetailDokTambahan = { aktif: boolean; bolehUnggah: boolean; alasan: string | null; total: number; categories: (Omit<KategoriDok, "applicable" | "min" | "status" | "missing"> & { items: ItemDok[] })[] };
export function useDokumentasiTambahan(unitId: string | undefined, aktif = true) {
  return useQuery({ queryKey: ["dokumentasi-tambahan", unitId], queryFn: () => api.get<DetailDokTambahan>(`/production/units/${unitId}/dokumentasi-tambahan`), enabled: !!unitId && aktif });
}
/** Unggah + catat sekaligus (≤ 6 foto) ke satu kategori. Berkas identik di kategori yang sama dilewati server (aman diulang). */
export async function unggahDokumentasiTambahan(unitId: string, kategori: string, berkas: BerkasLokal[]) {
  const fd = new FormData();
  fd.append("category", kategori);
  berkas.forEach((b, i) => {
    const type = mimeBerkas({ ...b, type: "image" });
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    fd.append("files", { uri: b.uri, name: `dok-${i + 1}.${ext}`, type } as unknown as Blob);
  });
  return api.upload<{ ditambah: number; dilewati: number }>(`/production/units/${unitId}/dokumentasi-tambahan`, fd);
}
