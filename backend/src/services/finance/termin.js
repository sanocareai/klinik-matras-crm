// TERMIN PEMBAYARAN SUPPLIER — satu tempat untuk aturan: jenis termin, hitung jatuh tempo, siapa boleh mengganti, dan snapshot pada dokumen.
//
// Jenis:  TUNAI (COD, jatuh tempo = tanggal faktur) | HARI (7/14/30/45/60 hari setelah tanggal faktur) | TANGGAL_KHUSUS (tanggal diisi per dokumen).
// Dasar:  TANGGAL_FAKTUR (tanggal faktur supplier) untuk faktur biasa. FAKTUR ATAS PO (Okt 2026): TANGGAL_TIBA — tanggal barang tiba yang dicatat pada penerimaan, per penerimaan
//         (services/finance/jadwalJatuhTempo.js). Tidak pernah tanggal PO dan bukan tanggal disimpan ke stok. Faktur lama tetap TANGGAL_FAKTUR (tidak diubah).
// Sumber: MASTER_SUPPLIER (default dari master) | PO (Finance mengganti pada PO) | OVERRIDE_FAKTUR (Finance mengganti pada faktur; alasan wajib).
//
// Aturan penting:
//   • Master supplier hanya DEFAULT. Dokumen menyimpan SNAPSHOT (jenis, hari, sumber, alasan, aktor, waktu) — mengubah master tidak mengubah dokumen lama.
//   • Mengganti termin/tanggal dari default (bila default berupa TUNAI/HARI) = override: wajib `finance:admin` + alasan. Bila supplier tidak punya termin baku,
//     atau terminnya TANGGAL_KHUSUS, mengisi tanggal adalah cara normal (bukan override) — tanpa alasan.
//   • Dokumen lama tanpa termin: jatuh tempo TIDAK ditebak (null tetap null; ditandai "Tanggal jatuh tempo belum diisi" di aging).

export const JENIS_TERMIN = Object.freeze({ TUNAI: "TUNAI", HARI: "HARI", TANGGAL_KHUSUS: "TANGGAL_KHUSUS" });
export const HARI_TERMIN = Object.freeze([7, 14, 30, 45, 60]);
export const DASAR_TERMIN = "TANGGAL_FAKTUR";
export const SUMBER_TERMIN = Object.freeze({ MASTER_SUPPLIER: "MASTER_SUPPLIER", PO: "PO", OVERRIDE_FAKTUR: "OVERRIDE_FAKTUR" });

export class TerminError extends Error {
  constructor(message, statusCode = 400, code = "TERMIN_TIDAK_VALID") { super(message); this.name = "TerminError"; this.statusCode = statusCode; this.code = code; }
}

const MS_HARI = 86_400_000;
const kunciHari = (d) => new Date(d).toISOString().slice(0, 10);

/** Label tampilan: "Tunai/COD", "30 hari", "Tanggal khusus". */
export function labelTermin(jenis, hari) {
  if (jenis === "TUNAI") return "Tunai/COD";
  if (jenis === "HARI") return `${hari} hari`;
  if (jenis === "TANGGAL_KHUSUS") return "Tanggal khusus";
  return null;
}

/** Termin master supplier → { jenis, hari } atau null. Data lama (hanya paymentTermDays) dibaca sebagai HARI. */
export function terminMaster(supplier) {
  if (!supplier) return null;
  if (supplier.paymentTermType === "TUNAI") return { jenis: "TUNAI", hari: 0 };
  if (supplier.paymentTermType === "TANGGAL_KHUSUS") return { jenis: "TANGGAL_KHUSUS", hari: null };
  if (supplier.paymentTermType === "HARI" || (!supplier.paymentTermType && supplier.paymentTermDays > 0)) {
    return supplier.paymentTermDays > 0 ? { jenis: "HARI", hari: supplier.paymentTermDays } : null;
  }
  return null;
}

/** Snapshot termin pada PO/faktur → { jenis, hari } atau null (dokumen lama tanpa termin). */
export function terminDokumen(dok) {
  return dok?.termType ? { jenis: dok.termType, hari: dok.termType === "HARI" ? dok.termDays : dok.termType === "TUNAI" ? 0 : null } : null;
}

/** Validasi termin untuk TULISAN BARU (harian terbatas pada pilihan resmi). Mengembalikan { jenis, hari } bersih. */
export function validasiTermin(jenis, hari) {
  if (!Object.hasOwn(JENIS_TERMIN, jenis)) throw new TerminError("Jenis termin tidak dikenal (Tunai/COD, hari, atau tanggal khusus)");
  if (jenis === "TUNAI") return { jenis, hari: 0 };
  if (jenis === "TANGGAL_KHUSUS") return { jenis, hari: null };
  const n = Number(hari);
  if (!HARI_TERMIN.includes(n)) throw new TerminError(`Termin hari harus salah satu dari ${HARI_TERMIN.join(", ")} hari`);
  return { jenis, hari: n };
}

/** Jatuh tempo (Date, tanggal buku UTC tengah malam). TANGGAL_KHUSUS memakai `tanggalKhusus`; tanpa itu → null. */
export function hitungJatuhTempo(termin, tanggalFaktur, tanggalKhusus = null) {
  if (!termin || !tanggalFaktur) return null;
  const awal = new Date(`${kunciHari(tanggalFaktur)}T00:00:00.000Z`);
  if (termin.jenis === "TUNAI") return awal;
  if (termin.jenis === "HARI") return new Date(awal.getTime() + Number(termin.hari) * MS_HARI);
  return tanggalKhusus ? new Date(`${kunciHari(tanggalKhusus)}T00:00:00.000Z`) : null;
}

const samaTermin = (a, b) => !!a && !!b && a.jenis === b.jenis && (a.hari ?? null) === (b.hari ?? null);

/**
 * Tentukan termin + jatuh tempo + snapshot untuk SATU dokumen (faktur) — dipakai faktur manual, faktur atas PO, dan perubahan jatuh tempo.
 *   supplier   : { paymentTermType, paymentTermDays }          (master)
 *   po         : { termType, termDays } | null                 (snapshot PO bila faktur atas PO)
 *   tanggalFaktur
 *   masukan    : { terminJenis?, terminHari?, dueDate?, alasan? }   (apa yang diketik Finance; semuanya opsional)
 *   boleh      : { override: boolean }                          (punya finance:admin)
 *   sekarang, userId
 * Mengembalikan { dueDate, snapshot } — snapshot siap ditulis ke kolom term*.
 */
export function tentukanTerminDokumen({ supplier, po = null, tanggalFaktur, tanggalDasar = undefined, dasar = DASAR_TERMIN, masukan = {}, boleh = {}, userId = null, sekarang = new Date() }) {
  // tanggalDasar (opsional): tanggal acuan hitung jatuh tempo bila BUKAN tanggal faktur (mis. tanggal tiba paling awal). null = belum ada tanggalnya → jatuh tempo tidak ditebak.
  const acuan = tanggalDasar !== undefined ? tanggalDasar : tanggalFaktur;
  const dariPO = terminDokumen(po);
  const bawaan = dariPO ?? terminMaster(supplier);
  const sumberBawaan = dariPO ? SUMBER_TERMIN.PO : SUMBER_TERMIN.MASTER_SUPPLIER;
  const alasan = String(masukan.alasan ?? "").trim();
  const adaTerminBaru = masukan.terminJenis !== undefined && masukan.terminJenis !== null && masukan.terminJenis !== "";
  const tanggalDiketik = masukan.dueDate ? kunciHari(masukan.dueDate) : null;

  // 1. Tentukan termin efektif.
  let termin = bawaan;
  let sumber = bawaan ? sumberBawaan : null;
  let override = false;
  if (adaTerminBaru) {
    const baru = validasiTermin(masukan.terminJenis, masukan.terminHari);
    const beda = !bawaan || !samaTermin(bawaan, baru);
    if (beda) override = !!bawaan && bawaan.jenis !== "TANGGAL_KHUSUS";
    termin = baru; if (beda) sumber = SUMBER_TERMIN.OVERRIDE_FAKTUR;
  }
  // Tanpa termin sama sekali tetapi ada tanggal diketik → tanggal khusus oleh Finance.
  if (!termin && tanggalDiketik) { termin = { jenis: "TANGGAL_KHUSUS", hari: null }; sumber = SUMBER_TERMIN.OVERRIDE_FAKTUR; }

  // 2. Hitung jatuh tempo; tanggal yang diketik di luar hasil termin = override tanggal (hanya bermakna untuk TUNAI/HARI).
  let dueDate = null;
  if (termin) {
    if (termin.jenis === "TANGGAL_KHUSUS") dueDate = hitungJatuhTempo(termin, tanggalFaktur ?? acuan, tanggalDiketik);
    else {
      const hasil = hitungJatuhTempo(termin, acuan);
      if (tanggalDiketik && tanggalDiketik !== (hasil ? kunciHari(hasil) : null)) { override = true; sumber = SUMBER_TERMIN.OVERRIDE_FAKTUR; termin = { jenis: "TANGGAL_KHUSUS", hari: null }; dueDate = hitungJatuhTempo(termin, tanggalFaktur ?? acuan ?? tanggalDiketik, tanggalDiketik); }
      else dueDate = hasil;
    }
  }

  // 3. Override (mengganti default TUNAI/HARI) → izin + alasan.
  if (override) {
    if (!boleh.override) throw new TerminError("Mengganti termin atau tanggal jatuh tempo dari default supplier hanya boleh oleh admin keuangan (finance:admin).", 403, "TERMIN_OVERRIDE_TIDAK_BERHAK");
    if (!alasan) throw new TerminError("Alasan wajib diisi saat mengganti termin atau tanggal jatuh tempo.", 400, "TERMIN_ALASAN_WAJIB");
  }
  if (!termin) return { dueDate: null, snapshot: { termType: null, termDays: null, termBasis: null, termSource: null, termOverrideReason: null, termSetById: null, termSetAt: null } };
  return {
    dueDate,
    snapshot: {
      termType: termin.jenis, termDays: termin.jenis === "HARI" ? termin.hari : termin.jenis === "TUNAI" ? 0 : null, termBasis: ["TUNAI", "HARI"].includes(termin.jenis) ? dasar : DASAR_TERMIN,
      termSource: sumber, termOverrideReason: override ? alasan : (alasan || null), termSetById: userId, termSetAt: sekarang,
    },
  };
}

/** Snapshot termin PO: warisi master supplier, atau ganti (admin + alasan). */
export function tentukanTerminPO({ supplier, masukan = {}, boleh = {}, userId = null, sekarang = new Date() }) {
  const bawaan = terminMaster(supplier);
  const adaBaru = masukan.terminJenis !== undefined && masukan.terminJenis !== null && masukan.terminJenis !== "";
  let termin = bawaan; let sumber = bawaan ? SUMBER_TERMIN.MASTER_SUPPLIER : null; let alasan = null;
  if (adaBaru) {
    const baru = validasiTermin(masukan.terminJenis, masukan.terminHari);
    if (!samaTermin(bawaan, baru)) {
      const ganti = !!bawaan;
      if (ganti && !boleh.override) throw new TerminError("Mengganti termin dari default supplier hanya boleh oleh admin keuangan (finance:admin).", 403, "TERMIN_OVERRIDE_TIDAK_BERHAK");
      alasan = String(masukan.alasan ?? "").trim();
      if (ganti && !alasan) throw new TerminError("Alasan wajib diisi saat mengganti termin dari default supplier.", 400, "TERMIN_ALASAN_WAJIB");
      termin = baru; sumber = SUMBER_TERMIN.PO;
    }
  }
  if (!termin) return { termType: null, termDays: null, termSource: null, termOverrideReason: null, termSetById: null, termSetAt: null };
  return { termType: termin.jenis, termDays: termin.jenis === "HARI" ? termin.hari : termin.jenis === "TUNAI" ? 0 : null, termSource: sumber, termOverrideReason: alasan, termSetById: userId, termSetAt: sekarang };
}

/** Pratinjau termin untuk formulir (klien tidak menghitung sendiri). */
export function pratinjauTermin({ supplier, po = null, tanggalFaktur, dasar = DASAR_TERMIN }) {
  const dariPO = terminDokumen(po);
  const termin = dariPO ?? terminMaster(supplier);
  const sumber = termin ? (dariPO ? SUMBER_TERMIN.PO : SUMBER_TERMIN.MASTER_SUPPLIER) : null;
  // Dasar TANGGAL_TIBA (PO dan faktur atas PO): termin TUNAI/HARI TIDAK berjalan saat PO dibuat dan bukan dari tanggal faktur — jatuh tempo baru ada per penerimaan setelah barang tiba dicatat.
  const tiba = dasar === "TANGGAL_TIBA" && !!termin && ["TUNAI", "HARI"].includes(termin.jenis);
  const dueDate = !tiba && termin && termin.jenis !== "TANGGAL_KHUSUS" ? hitungJatuhTempo(termin, tanggalFaktur) : null;
  return {
    ada: !!termin, jenis: termin?.jenis ?? null, hari: termin?.hari ?? null, label: termin ? labelTermin(termin.jenis, termin.hari) : null, sumber,
    dasar: tiba ? "TANGGAL_TIBA" : DASAR_TERMIN, tanggalFaktur: tanggalFaktur ? kunciHari(tanggalFaktur) : null, dueDate: dueDate ? kunciHari(dueDate) : null,
    perluTanggal: tiba ? false : termin?.jenis === "TANGGAL_KHUSUS" || !termin,
  };
}
