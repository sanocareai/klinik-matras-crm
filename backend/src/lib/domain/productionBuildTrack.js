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
/** Produk NON-kasur (divan/sofa) tidak diuji tekstur/berat badan kasur: tahap 8 (uji tekstur PIC) juga tidak berlaku. */
export const BUILD_NA_STEPS_NON_KASUR = Object.freeze([1, 2, 3, 4, 5, 7, 8]);
export const NON_KASUR_NA_REASON = "Produk non-kasur (divan/sofa): tanpa uji tekstur/berat badan kasur";
export const BUILD_NA_REASON = "Pesanan BARU/custom dibuat langsung di workshop — tanpa pickup, bongkar, atau diagnosa kerusakan";

/** Label tahap menurut jalur: pada jalur pengerjaan tahap 6 bernama "Pengerjaan Pesanan" (bukan "Fondasi Baru"). */
export function stepLabelFor(stepNo, baseLabel, buildTrack = false) {
  return buildTrack && stepNo === 6 ? BUILD_STAGE_LABEL : baseLabel;
}

export const isBuildTrack = ({ origin = null, category = null } = {}) => origin === "WORKSHOP_BORN" && BUILD_CATEGORIES.includes(category);
export const pathHasBuildStage = (stages) => (stages || []).some((s) => s.code === BUILD_STAGE_CODE);

// ---------------------------------------------------------------------------
// Klasifikasi produk KANONIS (bukan nama layanan, bukan awalan resi): Order.productLine (KASUR|SOFA|DIVAN) + Order.productType (enum ProductType).
// Menentukan apakah unit menjalani uji khas KASUR (uji tekstur PIC, uji berat badan QC, racikan fondasi/lapisan) atau tidak (divan/sofa).
// productLine BERNILAI BAWAAN KASUR di skema, jadi jenis yang eksplisit (productType) didahulukan dan konflik lini<->jenis dilaporkan, tidak ditebak.
// ---------------------------------------------------------------------------
export const PRODUCT_CLASS = Object.freeze({ KASUR: "KASUR", NON_KASUR: "NON_KASUR", BELUM_JELAS: "BELUM_JELAS" });
const FAMILY_OF_TYPE = Object.freeze({
  KASUR_SPRING: "KASUR", KASUR_BUSA: "KASUR", MULTIBED: "KASUR", KASUR_2IN1_ATAS: "KASUR", KASUR_2IN1_BAWAH: "KASUR", KASUR_SEHAT: "KASUR", KASUR_2IN1: "KASUR", KASUR_LAINNYA: "KASUR",
  SOFABED: "SOFA", SOFA_L: "SOFA", SOFA_1_SEATER: "SOFA", SOFA_2_SEATER: "SOFA", SOFA_3_SEATER: "SOFA",
  DIVAN_UTAMA: "DIVAN", DIVAN_SANDARAN: "DIVAN",
});

/**
 * @returns {{productClass: "KASUR"|"NON_KASUR"|"BELUM_JELAS", flow: "KASUR"|"NON_KASUR", family: string|null, basis: "JENIS"|"LINI"|null, problem: string|null}}
 * flow = alur yang DIJALANKAN. BELUM_JELAS memakai alur KASUR (gerbang mutu tidak dilonggarkan karena data kurang) dan wajib dilaporkan lewat `problem`.
 */
export function classifyProduct({ productLine = null, productType = null } = {}) {
  const typeFamily = productType ? FAMILY_OF_TYPE[productType] ?? null : null;
  const line = productLine || null;
  if (productType && !typeFamily) return { productClass: PRODUCT_CLASS.BELUM_JELAS, flow: "KASUR", family: null, basis: null, problem: `Jenis produk "${productType}" belum dikenali sistem` };
  if (typeFamily && line && typeFamily !== line) {
    return { productClass: PRODUCT_CLASS.BELUM_JELAS, flow: "KASUR", family: null, basis: null, problem: `Lini produk (${line}) tidak sesuai jenis produk (${productType}) — Sales perlu memperbaiki pesanan` };
  }
  let family = null; let basis = null; let problem = null;
  if (typeFamily) { family = typeFamily; basis = "JENIS"; }
  else if (line === "SOFA" || line === "DIVAN") { family = line; basis = "LINI"; }
  else if (line === "KASUR") { family = "KASUR"; basis = "LINI"; problem = "Jenis kasur belum diisi Sales (klasifikasi hanya dari lini produk bawaan)"; }
  if (!family) return { productClass: PRODUCT_CLASS.BELUM_JELAS, flow: "KASUR", family: null, basis: null, problem: "Lini/jenis produk pesanan belum tercatat" };
  const productClass = family === "KASUR" ? PRODUCT_CLASS.KASUR : PRODUCT_CLASS.NON_KASUR;
  return { productClass, flow: productClass === PRODUCT_CLASS.NON_KASUR ? "NON_KASUR" : "KASUR", family, basis, problem };
}
export const isNonKasurFlow = (flow) => flow === PRODUCT_CLASS.NON_KASUR;
/** Nomor tahap yang berlaku pada jalur pengerjaan menurut alur produk. */
export const buildApplicableSteps = (flow) => (isNonKasurFlow(flow) ? [6, 9, 10, 11, 12] : [6, 8, 9, 10, 11, 12]);
