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
// TIDAK ADA fallback "ambigu = kasur": bila jenis kanonis belum jelas, alurnya UNCONFIRMED — pengujian/racikan khusus kasur DITAHAN dan kebutuhan konfirmasi
// jenis produk ditampilkan. Order Sales TIDAK diubah diam-diam; perbaikan dilakukan Sales pada order, lalu klasifikasi dibaca ulang.
// productLine BERNILAI BAWAAN KASUR di skema, sehingga lini KASUR TANPA jenis tidak dianggap bukti kasur (bisa saja belum diisi).
// ---------------------------------------------------------------------------
export const PRODUCT_CLASS = Object.freeze({ KASUR: "KASUR", NON_KASUR: "NON_KASUR", BELUM_JELAS: "BELUM_JELAS" });
export const PRODUCT_FLOW = Object.freeze({ KASUR: "KASUR", NON_KASUR: "NON_KASUR", UNCONFIRMED: "UNCONFIRMED" });
const FAMILY_OF_TYPE = Object.freeze({
  KASUR_SPRING: "KASUR", KASUR_BUSA: "KASUR", MULTIBED: "KASUR", KASUR_2IN1_ATAS: "KASUR", KASUR_2IN1_BAWAH: "KASUR", KASUR_SEHAT: "KASUR", KASUR_2IN1: "KASUR", KASUR_LAINNYA: "KASUR",
  SOFABED: "SOFA", SOFA_L: "SOFA", SOFA_1_SEATER: "SOFA", SOFA_2_SEATER: "SOFA", SOFA_3_SEATER: "SOFA",
  DIVAN_UTAMA: "DIVAN", DIVAN_SANDARAN: "DIVAN",
});
const UNCONFIRMED = (problem) => ({ productClass: PRODUCT_CLASS.BELUM_JELAS, flow: PRODUCT_FLOW.UNCONFIRMED, family: null, basis: null, problem });

/**
 * @returns {{productClass: "KASUR"|"NON_KASUR"|"BELUM_JELAS", flow: "KASUR"|"NON_KASUR"|"UNCONFIRMED", family: string|null, basis: "JENIS"|"LINI"|null, problem: string|null}}
 * flow = alur yang boleh dijalankan. UNCONFIRMED = jenis kanonis belum jelas (konflik/kosong/tak dikenal): `problem` menjelaskan apa yang perlu dikonfirmasi.
 */
export function classifyProduct({ productLine = null, productType = null } = {}) {
  const typeFamily = productType ? FAMILY_OF_TYPE[productType] ?? null : null;
  const line = productLine || null;
  if (productType && !typeFamily) return UNCONFIRMED(`Jenis produk "${productType}" belum dikenali sistem — perlu konfirmasi jenis produk`);
  if (typeFamily && line && typeFamily !== line) return UNCONFIRMED(`Lini produk (${line}) tidak sesuai jenis produk (${productType}) — Sales perlu memperbaiki jenis produk pada order`);
  let family = null; let basis = null;
  if (typeFamily) { family = typeFamily; basis = "JENIS"; }
  else if (line === "SOFA" || line === "DIVAN") { family = line; basis = "LINI"; }
  else if (line === "KASUR") return UNCONFIRMED("Jenis kasur belum diisi pada order (lini KASUR adalah nilai bawaan, bukan bukti) — Sales perlu mengonfirmasi jenis produk");
  if (!family) return UNCONFIRMED("Lini/jenis produk pesanan belum tercatat — Sales perlu mengonfirmasi jenis produk");
  const productClass = family === "KASUR" ? PRODUCT_CLASS.KASUR : PRODUCT_CLASS.NON_KASUR;
  return { productClass, flow: productClass === PRODUCT_CLASS.NON_KASUR ? PRODUCT_FLOW.NON_KASUR : PRODUCT_FLOW.KASUR, family, basis, problem: null };
}
export const isNonKasurFlow = (flow) => flow === PRODUCT_FLOW.NON_KASUR;
export const isUnconfirmedFlow = (flow) => flow === PRODUCT_FLOW.UNCONFIRMED;
export const PRODUCT_UNCONFIRMED_WAIT = "PRODUCT_TYPE_UNCONFIRMED";

/**
 * Nomor tahap yang berlaku pada jalur pengerjaan menurut alur produk + kebutuhan Corner.
 * Corner TIDAK diturunkan dari jenis produk: ia mengikuti kebutuhan pengerjaan/kain yang DIKONFIRMASI pada rencana (cornerRequired true|false|null=belum).
 * corner === false -> tahap 9 (Kirim ke Corner), 10, 11 TIDAK BERLAKU (alasan tercatat), bukan "selesai".
 * Tahap 8 (uji tekstur kasur): berlaku untuk KASUR dan UNCONFIRMED (ditahan sampai jenis jelas), tidak berlaku untuk NON_KASUR.
 */
export function buildApplicableSteps(flow, { corner = true } = {}) {
  const steps = [6];
  if (!isNonKasurFlow(flow)) steps.push(8);
  if (corner !== false) steps.push(9, 10, 11);
  steps.push(12);
  return steps;
}
export const BUILD_CORNER_NA_STEPS = Object.freeze([9, 10, 11]);
export const CORNER_UNCONFIRMED_WAIT = "CORNER_NOT_CONFIRMED";
