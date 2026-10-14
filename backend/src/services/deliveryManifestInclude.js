// Bentuk data Prisma yang dibutuhkan builder manifest (lib/domain/deliveryManifest.js) — SATU definisi untuk jalur yang tidak memakai jobInclude armada.js
// (snapshot Driver V2 / aplikasi RN). Tanpa harga/nilai/pembayaran. Jaga SAMA dengan jobInclude di routes/armada.js.
export const MANIFEST_UNIT_SELECT = {
  id: true, unitCode: true, seq: true, status: true, merk: true, ukuran: true,
  pkrItemUnit: {
    select: {
      item: {
        select: {
          seq: true, categoryName: true, shape: true, workKind: true, productName: true, qty: true, specNotes: true,
          lengthCm: true, widthCm: true, thicknessCm: true, heightCm: true, bundleNo: true, bundleName: true, componentSeq: true,
        },
      },
    },
  },
};

/** Tambahan field order: sumber PKR (+ PIC lead customer) dan unit order (sinyal tambahan pesanan belum masuk job). */
export const MANIFEST_ORDER_EXTRA = {
  penjualanKaryawan: { select: { id: true, nomor: true, seller: { select: { id: true, name: true } } } },
  units: { select: { id: true, unitCode: true, seq: true, status: true, jobUnits: { select: { job: { select: { id: true, type: true } } } } }, orderBy: { seq: "asc" } },
};

export const MANIFEST_UNIT_LOADS = { select: { unitId: true, confirmedAt: true, confirmedById: true } };
