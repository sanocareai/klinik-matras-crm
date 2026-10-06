// Jalur PENGERJAAN PESANAN (build track) untuk pesanan BARU/custom — Production Run WORKSHOP_BORN. MURNI (tanpa DB).
//
// Mengapa ada: 12 tahap blueprint P8 dan jalur routing V1 dirancang untuk RESTORASI kasur lama (uji sebelum bongkar → bongkar → uji fondasi → diagnosa kerusakan → modul layanan).
// Pesanan BARU dibuat dari nol di workshop: tidak ada barang lama yang dibongkar/didiagnosa dan tidak ada layanan teknis yang dipilih — spesifikasi & layanan pesanan Sales
// (order items, jenis/merk/ukuran, catatan) LANGSUNG menjadi acuan pengerjaan. Jalur unit BARU = [Pengerjaan Pesanan] + gerbang/penutup yang sama dengan jalur lain
// (uji tekstur PIC → QC → Corner → Finish). Tahap 1–5 (bongkar, pencatatan komponen sebelum perbaikan, diagnosa) dan 7 TIDAK BERLAKU: dicatat "tidak berlaku", bukan dikerjakan.
//
// Jalur ditentukan dari jenis unit KANONIS (Order.category) + asal Run (origin WORKSHOP_BORN) — BUKAN dari awalan nomor resi ("NEW-"): di production ada order SEWA tanpa awalan
// NEW- dan semua BARU kebetulan berawalan NEW-, tetapi awalan tidak pernah dipakai sebagai penentu. Unit LAYANAN dan Run lama (origin kosong/CUSTODY_PICKUP) tidak tersentuh.

export const BUILD_STAGE_CODE = "custom_build";
export const BUILD_STAGE_LABEL = "Pengerjaan Pesanan";
/** Kategori kanonis yang memakai jalur pengerjaan. SEWA sengaja TIDAK ikut (belum ada keputusan alur sewa) — perilaku lamanya tidak berubah. */
export const BUILD_CATEGORIES = Object.freeze(["BARU"]);
/** Nomor tahap blueprint yang TIDAK BERLAKU pada jalur pengerjaan (1–5 restorasi; 7 lapisan layanan). Tahap 6 = Pengerjaan Pesanan. */
export const BUILD_NA_STEPS = Object.freeze([1, 2, 3, 4, 5, 7]);
export const BUILD_NA_REASON = "Pesanan BARU/custom dibuat langsung di workshop — tanpa pickup, bongkar, atau diagnosa kerusakan";

/** Label tahap menurut jalur: pada jalur pengerjaan tahap 6 bernama "Pengerjaan Pesanan" (bukan "Fondasi Baru"). */
export function stepLabelFor(stepNo, baseLabel, buildTrack = false) {
  return buildTrack && stepNo === 6 ? BUILD_STAGE_LABEL : baseLabel;
}

export const isBuildTrack = ({ origin = null, category = null } = {}) => origin === "WORKSHOP_BORN" && BUILD_CATEGORIES.includes(category);
export const pathHasBuildStage = (stages) => (stages || []).some((s) => s.code === BUILD_STAGE_CODE);
