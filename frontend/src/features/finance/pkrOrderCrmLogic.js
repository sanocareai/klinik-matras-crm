// Logika murni sinkronisasi Penjualan Karyawan -> Order CRM -> Produksi -> Delivery (Finance/CRM). Angka dan status resmi SELALU dari server (`sinkron` pada PKR, `penjualanKaryawan` pada order);
// di sini hanya bentuk isian form, validasi ringan, dan pemetaan label/warna — supaya bisa dites tanpa DOM.

export const KATEGORI_PKR_OPSI = [
  { key: "BARU", label: "Kasur baru" },
  { key: "LAYANAN", label: "Service / upgrade kasur lama" },
];
export const KIRIM_OPSI = [
  { key: "", label: "— belum ditentukan —" },
  { key: "ya", label: "Dikirim ke alamat pembeli" },
  { key: "tidak", label: "Diambil sendiri (tanpa pengiriman)" },
];

export const orderCrmKosong = () => ({ kategori: "BARU", jumlahUnit: "1", merk: "", ukuran: "", kirim: "", alamat: "", kota: "", tanggalKirim: "" });

/** Isian form dari spesifikasi server (untuk "Lengkapi spesifikasi"). */
export function orderCrmDariSinkron(sinkron) {
  const s = sinkron?.order?.spesifikasi;
  return {
    ...orderCrmKosong(),
    kategori: sinkron?.order?.kategori === "LAYANAN" ? "LAYANAN" : "BARU",
    merk: s?.merk ?? "", ukuran: s?.ukuran ?? "",
    kirim: s?.perluDikirim === true ? "ya" : s?.perluDikirim === false ? "tidak" : "",
    alamat: s?.alamat ?? "", kota: s?.kota ?? "",
  };
}

/** Galat isian (null = boleh dikirim). Isian BOLEH belum lengkap — order tetap dibuat dan berstatus "Perlu dilengkapi". */
export function galatOrderCrm(f, { baru = true } = {}) {
  if (baru) {
    const n = Number(f.jumlahUnit);
    if (!Number.isInteger(n) || n < 1 || n > 20) return "Jumlah unit harus bilangan bulat 1–20";
  }
  if (f.tanggalKirim && !/^\d{4}-\d{2}-\d{2}$/.test(f.tanggalKirim)) return "Tanggal kirim tidak valid";
  return null;
}

/** Body API. `baru` = pembuatan (kategori & jumlah unit ikut); selain itu hanya field yang boleh diubah setelah order ada. */
export function bodyOrderCrm(f, { baru = true } = {}) {
  const t = (v) => String(v ?? "").trim();
  const o = {};
  if (baru) { o.kategori = f.kategori || "BARU"; o.jumlahUnit = Number(f.jumlahUnit) || 1; }
  if (t(f.merk)) o.merk = t(f.merk);
  if (t(f.ukuran)) o.ukuran = t(f.ukuran);
  if (f.kirim === "ya") o.perluDikirim = true; else if (f.kirim === "tidak") o.perluDikirim = false;
  if (f.kirim === "ya") {
    if (t(f.alamat)) o.alamat = t(f.alamat);
    if (t(f.kota)) o.kota = t(f.kota);
    if (t(f.tanggalKirim)) o.tanggalKirim = t(f.tanggalKirim);
  }
  return o;
}

export const VARIAN_PRODUKSI = { PERLU_DILENGKAPI: "orange", MENUNGGU: "neutral", BERJALAN: "accent", SELESAI: "green", DIBATALKAN: "neutral", BELUM_ADA_UNIT: "neutral" };
export function varianDelivery(kode) {
  if (["COMPLETED"].includes(kode)) return "green";
  if (["EN_ROUTE", "ARRIVED", "SCHEDULED", "ASSIGNED"].includes(kode)) return "accent";
  if (["FAILED", "RESCHEDULED", "BELUM_DITENTUKAN", "BELUM_ADA_JOB"].includes(kode)) return "orange";
  return "neutral";
}
export const VARIAN_BAYAR_PKR = { BELUM_BAYAR: "red", SEBAGIAN: "orange", LUNAS: "green", DIBATALKAN: "neutral" };

/** Ada order CRM aktif/terbuat untuk PKR ini? */
export const adaOrderCrm = (sinkron) => !!sinkron?.order;
/** Teks "kurang" spesifikasi untuk tooltip/pesan. */
export const teksKurang = (sinkron) => (sinkron?.order?.spesifikasi?.kurang || []).join(", ");

/** Aksi yang masuk akal per PKR (server tetap menegakkan izin dan aturan). */
export function aksiOrderCrm(p) {
  const batal = p?.statusTampil === "DIBATALKAN" || p?.status === "DIBATALKAN";
  const s = p?.sinkron;
  return {
    buat: !batal && !adaOrderCrm(s),
    lengkapi: !batal && adaOrderCrm(s) && s.order.status !== "CANCELLED",
  };
}
