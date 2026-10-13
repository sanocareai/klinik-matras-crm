// REPRESENTASI MULTI-UNIT ORDER CRM PENJUALAN KARYAWAN (Okt 2026) — fungsi MURNI (tanpa Prisma) yang menyusun sub-baris per unit + ringkasan induk.
//
// Aturan (jangan dilanggar):
//   1. Satu PKR = SATU Order CRM induk. Unit produksi (U1, U2, …) hanyalah sub-baris DARI order itu — bukan Order baru, bukan Payment/invoice/jurnal baru.
//      Fungsi ini hanya MEMBACA; nominal PKR tetap dibaca Finance satu kali dari fin_penjualan_karyawan.
//   2. Status Produksi per unit = status unit sendiri (bukan agregat order). Status Delivery per unit = job pengiriman yang MENAUNGI unit itu (JobUnit);
//      satu job boleh menaungi banyak unit — tidak ada job ganda hanya karena ada banyak unit.
//   3. Rencana (tanggal/target/PIC) dibaca dari rencana produksi V2 unit itu bila ada. Belum ada rencana = "Belum dijadwalkan" (jujur, bukan ditebak).

export const LABEL_UNIT = {
  AWAITING_PICKUP: "Menunggu pengambilan", IN_TRANSIT_IN: "Dalam perjalanan ke workshop", RECEIVED: "Menunggu produksi", IN_PRODUCTION: "Sedang diproduksi",
  READY_FOR_DELIVERY: "Produksi selesai", READY_ON_CUSTOMER_HOLD: "Produksi selesai (ditahan)", IN_TRANSIT_OUT: "Dalam pengiriman", DELIVERED: "Selesai", CANCELLED: "Dibatalkan",
};
export const LABEL_JOB = {
  UNSCHEDULED: "Job dibuat, belum dijadwalkan", SCHEDULED: "Terjadwal", ASSIGNED: "Terjadwal (driver ditetapkan)", EN_ROUTE: "Dalam perjalanan", ARRIVED: "Tiba di lokasi",
  COMPLETED: "Terkirim", FAILED: "Gagal — perlu dijadwalkan ulang", RESCHEDULED: "Dijadwalkan ulang",
};

const STATUS_SIAP = ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"];
const STATUS_PRODUKSI_SELESAI = [...STATUS_SIAP, "IN_TRANSIT_OUT", "DELIVERED"];

const tgl = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Rencana produksi satu unit dari run V2 aktif terbaru. null = belum ada rencana yang bisa dibaca. */
export function rencanaUnit(u) {
  const run = (u.productionRunsV2 || []).find((r) => r.status !== "CANCELLED") ?? null;
  const p = run?.plan;
  if (!p || p.status === "CANCELLED") {
    // Cadangan: target internal lama di Unit. Tetap jujur — hanya tanggal, tanpa PIC.
    return u.productionDueAt ? { tanggalProduksi: null, target: tgl(u.productionDueAt), stasiun: null, pic: null, picCorner: null, status: null } : null;
  }
  const tanggalProduksi = tgl(p.productionDate);
  const target = tgl(p.targetDate) || tanggalProduksi || tgl(u.productionDueAt);
  const pic = p.operator?.user?.name ?? null;
  const picCorner = p.cornerOperator?.user?.name ?? null;
  if (!tanggalProduksi && !target && !pic && !p.stationCode) return null;
  return { tanggalProduksi, target, stasiun: p.stationCode ?? null, pic, picCorner, status: p.status };
}

/** Delivery per unit: job pengiriman yang menaungi unit; cadangan = job pengiriman order yang belum terhubung ke unit mana pun (data lama). */
export function deliveryUnit({ order, unit, perluDikirim, jobsOrder }) {
  if (order.status === "CANCELLED" || unit.status === "CANCELLED") return { kode: "DIBATALKAN", label: "Dibatalkan", jobId: null, tanggal: null };
  if (unit.status === "DELIVERED") return { kode: "COMPLETED", label: LABEL_JOB.COMPLETED, jobId: null, tanggal: null };
  if (perluDikirim === false) return { kode: "AMBIL_SENDIRI", label: "Diambil sendiri (tanpa pengiriman)", jobId: null, tanggal: null };
  if (perluDikirim == null) return { kode: "BELUM_DITENTUKAN", label: "Belum ditentukan (dikirim atau diambil sendiri)", jobId: null, tanggal: null };
  const milikUnit = (unit.jobUnits || []).map((x) => x.job).filter((j) => j && j.type === "DELIVERY");
  const terkait = milikUnit.length > 0
    ? milikUnit
    : jobsOrder.filter((j) => j.type === "DELIVERY" && !(j.unitIds || []).length); // job lama tanpa JobUnit → berlaku untuk semua unit order
  if (terkait.length === 0) {
    // Belum siap = wajar menunggu (bukan peringatan); sudah siap tetapi job belum ada = perlu perhatian Delivery.
    return STATUS_SIAP.includes(unit.status)
      ? { kode: "BELUM_ADA_JOB", label: "Siap kirim — job belum terbentuk", jobId: null, tanggal: null }
      : { kode: "MENUNGGU_PRODUKSI", label: "Menunggu produksi selesai", jobId: null, tanggal: null };
  }
  const urut = [...terkait].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const j = urut[urut.length - 1];
  return { kode: j.status, label: LABEL_JOB[j.status] || j.status, jobId: j.id, tanggal: tgl(j.scheduledDate) };
}

/**
 * Susun sub-baris unit + ringkasan induk.
 * @param order  { status, pkrPerluDikirim }
 * @param units  unit order (urut seq): { id, unitCode, seq, status, merk, ukuran, currentStage?, productionDueAt?, productionRunsV2?, jobUnits? }
 * @param items  item hasil ringkasOrderPkr ({ unit:[{kode}], produk, kategoriNama, spesifikasi, perluDikirim, ... })
 * @param jobsOrder  job order [{ id, type, status, scheduledDate, createdAt, unitIds }]
 */
export function susunBarisUnitPkr({ order, units, items, jobsOrder = [] }) {
  const aktif = units.filter((u) => u.status !== "CANCELLED");
  const dibatalkan = units.length - aktif.length;
  const total = aktif.length;
  const itemPerKode = new Map();
  for (const it of items || []) for (const x of it.unit || []) itemPerKode.set(x.kode, it);
  const baris = aktif.map((u, idx) => {
    const it = itemPerKode.get(u.unitCode) ?? (items || [])[0] ?? null;
    const perluDikirim = it?.perluDikirim ?? order.pkrPerluDikirim ?? null;
    const rencana = rencanaUnit(u);
    const delivery = deliveryUnit({ order, unit: u, perluDikirim, jobsOrder });
    return {
      id: u.id, kode: u.unitCode, urutan: idx + 1, dari: total, urutanLabel: `${idx + 1} dari ${total}`,
      item: { no: it?.no ?? null, nama: it?.produk || u.merk || it?.kategoriNama || "Item produksi", kategoriNama: it?.kategoriNama ?? null, jenisKerja: it?.jenisKerja ?? null },
      merk: u.merk ?? null, ukuran: u.ukuran || it?.ukuran || null, spesifikasi: it?.spesifikasi ?? null,
      produksi: { kode: u.status, label: LABEL_UNIT[u.status] || u.status, tahap: u.currentStage?.labelId ?? null },
      rencana,
      delivery,
      kirim: { perluDikirim, label: perluDikirim === true ? "Dikirim" : perluDikirim === false ? "Diambil sendiri" : "Belum ditentukan" },
    };
  });
  const ringkas = {
    total, dibatalkan,
    dijadwalkan: baris.filter((b) => b.rencana && (b.rencana.tanggalProduksi || b.rencana.target)).length,
    sedangDiproduksi: aktif.filter((u) => u.status === "IN_PRODUCTION" || (u.currentStageId != null && !STATUS_PRODUKSI_SELESAI.includes(u.status))).length,
    siap: aktif.filter((u) => STATUS_SIAP.includes(u.status)).length,
    dalamPengiriman: aktif.filter((u) => u.status === "IN_TRANSIT_OUT").length,
    terkirim: aktif.filter((u) => u.status === "DELIVERED").length,
  };
  return { baris, ringkas };
}
