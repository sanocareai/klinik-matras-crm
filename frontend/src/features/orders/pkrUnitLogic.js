// REPRESENTASI MULTI-UNIT ORDER CRM PENJUALAN KARYAWAN — logika murni (tanpa React/alias) supaya bisa dites langsung.
// Server menyusun `penjualanKaryawan.unitBaris` + `ringkasUnit` (lib/domain/pkrUnitBaris.js); file ini hanya merangkai teks & varian tampilan.
// Satu PKR = SATU order induk; unit hanya sub-baris. Tidak ada nominal di sini (nominal PKR dibaca Finance satu kali).

export const UNIT_STATUS_OPSI = [
  { value: "RECEIVED", label: "Menunggu produksi" },
  { value: "IN_PRODUCTION", label: "Sedang diproduksi" },
  { value: "READY_FOR_DELIVERY", label: "Produksi selesai (siap kirim)" },
  { value: "IN_TRANSIT_OUT", label: "Dalam pengiriman" },
  { value: "DELIVERED", label: "Terkirim / selesai" },
];

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

/** "2026-10-14" → "14 Okt". Nilai kosong/tak valid → null. */
export function tanggalPendekIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return null;
  const bln = Number(m[2]);
  if (bln < 1 || bln > 12) return null;
  return `${Number(m[3])} ${BULAN[bln - 1]}`;
}

/** Baris unit dari order di daftar CRM ([] untuk order biasa / belum ada unit). */
export const unitBarisOrder = (order) => (Array.isArray(order?.penjualanKaryawan?.unitBaris) ? order.penjualanKaryawan.unitBaris : []);

/** Order induk Penjualan Karyawan yang punya unit produksi → boleh diperluas / tampil daftar unit. */
export const punyaUnitPkr = (order) => unitBarisOrder(order).length > 0;

/** Potongan ringkasan induk: ["3 Unit Produksi", "Dijadwalkan 0/3", "Sedang diproduksi 0/3", "Siap 3/3", "Terkirim 0/3"]. */
export function ringkasUnitTeks(ringkas) {
  if (!ringkas || !(ringkas.total > 0)) return [];
  const t = ringkas.total;
  const hasil = [
    `${t} Unit Produksi`,
    `Dijadwalkan ${ringkas.dijadwalkan ?? 0}/${t}`,
    `Sedang diproduksi ${ringkas.sedangDiproduksi ?? 0}/${t}`,
    `Siap ${ringkas.siap ?? 0}/${t}`,
  ];
  if ((ringkas.dalamPengiriman ?? 0) > 0) hasil.push(`Dalam pengiriman ${ringkas.dalamPengiriman}/${t}`);
  hasil.push(`Terkirim ${ringkas.terkirim ?? 0}/${t}`);
  return hasil;
}

const PRODUKSI_SELESAI = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"];

/** "100x200" / "100 x 200" / "100 × 200 cm" → "100 × 200 cm"; selain itu apa adanya. */
export function rapikanUkuran(v) {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const m = /^(\d+(?:[.,]\d+)?)\s*[xX×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[xX×*]\s*(\d+(?:[.,]\d+)?))?\s*(?:cm)?$/.exec(t);
  if (!m) return t;
  return `${[m[1], m[2], m[3]].filter(Boolean).join(" × ")} cm`;
}

/** Ringkasan induk SATU baris: "1 item • 3 unit • 3 siap • 0 terkirim" (dihitung dari unit nyata). */
export function ringkasIndukTeks(pkr) {
  const r = pkr?.ringkasUnit;
  if (!r || !(r.total > 0)) return null;
  const kunci = new Set((pkr.unitBaris || []).map((b) => b.item?.no ?? b.item?.nama));
  const item = Math.max(1, kunci.size);
  return `${item} item • ${r.total} unit • ${r.siap ?? 0} siap • ${r.terkirim ?? 0} terkirim`;
}

/** Kelompok produk dari unit: [{ nama, qty, ukuran }] (identik digabung; urutan kemunculan). */
export function kelompokProduk(pkr) {
  const peta = new Map();
  for (const b of pkr?.unitBaris || []) {
    const nama = b.item?.nama || b.merk || "Item produksi";
    const ukuran = rapikanUkuran(b.ukuran);
    const k = JSON.stringify([nama, ukuran]);
    const g = peta.get(k) ?? { nama, ukuran, qty: 0 };
    g.qty += 1;
    peta.set(k, g);
  }
  return [...peta.values()];
}

/** Produk utama: "3× Kasur Sorong 3in1 custom" (+ "; 1× Divan Laci"; lebih dari dua jenis → "+N jenis lain"). */
export function produkUtamaTeks(pkr) {
  const g = kelompokProduk(pkr);
  if (g.length === 0) return null;
  const tampil = g.slice(0, 2).map((x) => `${x.qty}× ${x.nama}`).join("; ");
  return g.length > 2 ? `${tampil} +${g.length - 2} jenis lain` : tampil;
}

/** Ukuran utama: satu ukuran seragam → "100 × 200 cm"; beragam → "Beragam (lihat unit)". */
export function ukuranUtamaTeks(pkr) {
  const u = [...new Set(kelompokProduk(pkr).map((x) => x.ukuran).filter(Boolean))];
  if (u.length === 0) return null;
  return u.length === 1 ? u[0] : "Beragam (lihat unit)";
}

/** Status dipisah: Produksi "3/3 selesai" TIDAK menyamarkan Delivery "0/3 terkirim". */
export function statusTerpisah(pkr) {
  const baris = (pkr?.unitBaris || []);
  const total = baris.length;
  if (total === 0) return null;
  const selesai = baris.filter((b) => PRODUKSI_SELESAI.includes(b.produksi?.kode)).length;
  const terkirim = baris.filter((b) => b.produksi?.kode === "DELIVERED").length;
  return { total, produksiSelesai: selesai, terkirim, produksi: `Produksi ${selesai}/${total} selesai`, delivery: `Delivery ${terkirim}/${total} terkirim` };
}

/** Teks rencana satu unit: "Target 14 Okt · PIC Budi" atau "Belum dijadwalkan". */
export function rencanaUnitTeks(rencana) {
  if (!rencana) return "Belum dijadwalkan";
  const tgl = tanggalPendekIso(rencana.target) || tanggalPendekIso(rencana.tanggalProduksi);
  const bagian = [];
  if (tgl) bagian.push(`Target ${tgl}`);
  if (rencana.pic) bagian.push(`PIC ${rencana.pic}`);
  if (rencana.stasiun && !rencana.pic) bagian.push(`Meja ${rencana.stasiun}`);
  return bagian.length ? bagian.join(" · ") : "Belum dijadwalkan";
}

/** Ukuran + spesifikasi satu unit dalam satu teks pendek. */
export function ukuranSpesifikasiTeks(u) {
  const bagian = [u?.ukuran, u?.spesifikasi].filter((x) => x != null && String(x).trim() !== "");
  return bagian.length ? bagian.join(" · ") : "Belum dilengkapi";
}

export const VARIAN_PRODUKSI_UNIT = {
  AWAITING_PICKUP: "neutral", IN_TRANSIT_IN: "neutral", RECEIVED: "neutral", IN_PRODUCTION: "accent",
  READY_FOR_DELIVERY: "green", READY_ON_CUSTOMER_HOLD: "green", IN_TRANSIT_OUT: "accent", DELIVERED: "green", CANCELLED: "neutral",
};
export function varianDeliveryUnit(kode) {
  if (kode === "COMPLETED") return "green";
  if (["EN_ROUTE", "ARRIVED", "SCHEDULED", "ASSIGNED"].includes(kode)) return "accent";
  if (["FAILED", "RESCHEDULED", "BELUM_DITENTUKAN", "BELUM_ADA_JOB"].includes(kode)) return "orange";
  return "neutral";
}

/** Teks aksesibel untuk satu baris unit (dipakai aria-label tombol). */
export const labelUnit = (u) => `Buka Unit 360 ${u.kode}, ${u.item?.nama || "item"}, ${u.urutanLabel}`;
