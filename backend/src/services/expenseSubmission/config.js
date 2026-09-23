// KONFIGURASI FORM PER WORKSPACE DIVISI — fondasi reusable untuk Pengajuan Biaya Lintas
// Divisi (lihat banner di schema.prisma#ExpenseSubmission). Divisi baru (Produksi/
// Warehouse/Marketing/Management/HR-GA) TIDAK butuh migrasi skema untuk menambah jenis
// biaya baru — cukup tambah entri di sini. UI (frontend) merender field SECARA DINAMIS
// dari config yang dikirim endpoint GET /expense-submissions/config, tidak ada field
// hardcode per divisi di kode React.
//
// SETIAP entri workspace WAJIB punya:
//   division            — FinDivision yang dipakai saat FinExpense dibuat
//   expenseTypes         — daftar jenis biaya valid untuk workspace ini (server MENOLAK
//                          expenseType di luar daftar ini — lihat service.js#validasiTipe)
//   relations             — relasi opsional yang BOLEH diisi (job/route/vehicle/driver/
//                          helper/order) — dipakai frontend untuk tahu picker mana yang
//                          ditampilkan, dan backend untuk menolak field yang tidak relevan
//   metadataFields(tipe) — fungsi: daftar field metadata terstruktur untuk SATU jenis
//                          biaya (dinamis per jenis, mis. BBM punya odometer+liter,
//                          SEWA tidak) — bentuk field: { key, label, type, required }
//   requiresLeaderReview — true kalau workspace ini mewajibkan review internal SEBELUM
//                          masuk ke Finance (status DIAJUKAN tertahan menunggu leader).
//                          Delivery: false (LEADER_DRIVER tidak punya izin approval
//                          finance — lihat audit; "diajukan" langsung jadi FinExpense).

export const WORKSPACES = {
  DELIVERY: {
    division: "DELIVERY",
    label: "Delivery",
    expenseTypes: [
      { code: "BBM", label: "BBM" },
      { code: "TOL", label: "Tol" },
      { code: "PARKIR", label: "Parkir" },
      { code: "SERVIS", label: "Servis" },
      { code: "BAN", label: "Ban" },
      { code: "CUCI", label: "Cuci kendaraan" },
      { code: "DENDA", label: "Denda/tilang" },
      { code: "SEWA", label: "Sewa kendaraan" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: ["job", "route", "vehicle", "driver", "helper"],
    requiresLeaderReview: false,
    metadataFields(tipe) {
      const umum = [
        { key: "vendorOrLocation", label: "Vendor / lokasi", type: "text", required: false },
      ];
      if (tipe === "BBM") {
        return [
          { key: "odometerKm", label: "Odometer (km)", type: "number", required: false },
          { key: "liters", label: "Jumlah liter", type: "decimal", required: true },
          { key: "pricePerLiter", label: "Harga per liter", type: "money", required: false },
          ...umum,
        ];
      }
      if (tipe === "SERVIS" || tipe === "BAN") {
        return [
          { key: "odometerKm", label: "Odometer (km)", type: "number", required: true },
          { key: "workshop", label: "Bengkel", type: "text", required: false },
          ...umum,
        ];
      }
      if (tipe === "TOL" || tipe === "PARKIR" || tipe === "CUCI") {
        return umum;
      }
      if (tipe === "DENDA") {
        return [{ key: "violationRef", label: "Nomor tilang/referensi", type: "text", required: false }, ...umum];
      }
      if (tipe === "SEWA") {
        return [
          { key: "rentalPeriodStart", label: "Mulai sewa", type: "date", required: false },
          { key: "rentalPeriodEnd", label: "Selesai sewa", type: "date", required: false },
          ...umum,
        ];
      }
      return umum;
    },
  },

  // ── Divisi berikutnya (rollout lanjutan, BELUM ada UI — lihat laporan implementasi) ──
  // Skema field di bawah SENGAJA minimal/indikatif: memastikan pola config ini reusable
  // sebelum UI masing-masing dibangun, BUKAN daftar final. Detail field sesungguhnya
  // ditentukan bersama tiap divisi saat gilirannya tiba.
  PRODUKSI: {
    division: "PRODUKSI",
    label: "Produksi",
    expenseTypes: [
      { code: "BAHAN_TAMBAHAN", label: "Bahan tambahan" },
      { code: "SEWA_ALAT", label: "Sewa alat/mesin" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: ["order"],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "machine", label: "Mesin", type: "text", required: false },
        { key: "stage", label: "Tahapan produksi", type: "text", required: false },
        { key: "pic", label: "PIC lapangan", type: "text", required: false },
      ];
    },
  },
  WAREHOUSE: {
    division: "GUDANG",
    label: "Warehouse",
    expenseTypes: [
      { code: "MATERIAL", label: "Pembelian material" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "warehouseDocument", label: "Nomor dokumen gudang", type: "text", required: false },
      ];
    },
  },
  MARKETING: {
    division: "MARKETING",
    label: "Marketing",
    expenseTypes: [
      { code: "IKLAN", label: "Belanja iklan" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "platform", label: "Platform", type: "text", required: false },
        { key: "adAccount", label: "Akun iklan", type: "text", required: false },
        { key: "periodStart", label: "Periode mulai", type: "date", required: false },
        { key: "periodEnd", label: "Periode selesai", type: "date", required: false },
      ];
    },
  },
  MANAGEMENT: {
    division: "MANAGEMENT",
    label: "Management",
    expenseTypes: [
      { code: "MEETING", label: "Meeting/survey" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "activity", label: "Kegiatan", type: "text", required: false },
        { key: "budgetRef", label: "Referensi anggaran", type: "text", required: false },
      ];
    },
  },
  HR_GA: {
    division: "HR_GA",
    label: "HR & GA",
    expenseTypes: [
      { code: "REIMBURSEMENT_KARYAWAN", label: "Reimbursement karyawan" },
      { code: "ASET", label: "Aset kantor" },
      { code: "LAINNYA", label: "Lainnya" },
    ],
    relations: [],
    requiresLeaderReview: false,
    metadataFields() {
      return [
        { key: "employeeName", label: "Nama karyawan", type: "text", required: false },
        { key: "assetLocation", label: "Lokasi aset", type: "text", required: false },
      ];
    },
  },
};

export function getWorkspaceConfig(workspace) {
  return WORKSPACES[workspace] || null;
}

export function daftarWorkspaceAktif() {
  // Hanya Delivery yang punya UI nyata di rilis ini — lihat laporan rollout.
  return ["DELIVERY"];
}
