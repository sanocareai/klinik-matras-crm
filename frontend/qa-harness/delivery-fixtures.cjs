// Data uji tab Delivery untuk QA tampilan (bundel build + backend QA sandbox). Backend QA tidak memiliki data armada, jadi daftar utama diisi lewat intersepsi permintaan GET.
// BUKAN data nyata. Dipakai: const { pasang } = require("./delivery-fixtures.cjs"); await pasang(page);
const hari = (n) => new Date(Date.now() + n * 86400000).toISOString();
const NAMA = ["Ibu Sari Wulandari", "Pak Budi Santoso", "Bu Dewi Lestari", "Hotel Mawar Indah", "Pak Hendra Wijaya", "Ibu Maya Putri", "CV Sinar Abadi"];
const KOTA = ["Jakarta Selatan", "Tangerang", "Bekasi", "Depok", "Bogor", "Jakarta Barat", "Tangerang Selatan"];
const STATUS = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "COMPLETED", "FAILED", "ASSIGNED"];
const ORDER_STATUS = ["PENDING", "PICKUP", "PROCESSING", "READY_TO_SHIP", "SHIPPING", "COMPLETED", "PROCESSING"];
const order = (i) => ({
  id: `o${i}`, orderNumber: `ORD-26110${i + 1}`, status: ORDER_STATUS[i % 7], deliveryCity: KOTA[i % 7], category: i % 3 === 0 ? "LAYANAN" : "PRODUK", productLine: "KASUR", productType: "KASUR_BIASA",
  customer: { id: `c${i}`, name: NAMA[i % 7], phone: "6281200000" + i, conversations: [{ id: `cv${i}` }] }, assignedSales: { name: ["Rika", "Gilang", "Juri"][i % 3] }, paymentStatus: ["BELUM_BAYAR", "DP", "LUNAS"][i % 3], value: 3500000 + i * 450000,
});
const job = (i) => ({
  id: `j${i}`, type: i % 2 ? "DELIVERY" : "PICKUP", status: STATUS[i % 7], scheduledDate: hari(i % 4 === 0 ? -2 : i % 5), timeWindow: i % 2 ? "09:00–12:00" : "13:00–16:00",
  addressText: `Jl. Melati No. ${10 + i}, ${KOTA[i % 7]}`, lat: null, lng: null, driverId: i % 7 === 0 ? null : "d1", driver: i % 7 === 0 ? null : { id: "d1", name: ["Andi Pratama", "Joko Susilo"][i % 2] },
  vehicle: i % 7 === 0 ? null : { id: "v1", plateNumber: `B 12${i} KMT` }, route: i % 3 === 0 ? { id: "r1", code: `RT-0${i}` } : null, order: order(i), units: [{ id: `u${i}`, unit: { order: order(i) } }], manifest: { unit: 1 + (i % 3), items: [] },
});
const JOBS = Array.from({ length: 9 }, (_, i) => job(i));
const POD = JOBS.slice(0, 8).map((j, i) => ({ ...j, status: i % 3 === 2 ? "FAILED" : "COMPLETED", completedAt: hari(-i), derivedPodStatus: ["VERIFIED", "INCOMPLETE", "PENDING_REVIEW", "REJECTED"][i % 4], proofPhotoUrls: i % 4 === 1 ? [] : ["/x.jpg", "/y.jpg"], signatureUrl: i % 4 === 1 ? null : "/s.png", failureReason: i % 3 === 2 ? "Pelanggan tidak di tempat" : null }));
const ISSUES = JOBS.slice(0, 5).map((j, i) => ({ ...j, status: "FAILED", issueStatus: ["NEEDS_RESCHEDULE", "RESCHEDULED", "NEEDS_RESCHEDULE"][i % 3], failureReason: ["Alamat tidak ditemukan", "Pelanggan minta ganti hari", "Akses jalan ditutup"][i % 3] }));
const ORDERS = Array.from({ length: 8 }, (_, i) => ({ ...order(i), customerName: NAMA[i % 7], createdAt: hari(-i), milestone: null, productionStage: ["Potong", "Rakit", "QC", "Packing"][i % 4], pickupJob: JOBS[i], deliveryJob: i % 2 ? JOBS[i + 1] : null, pickupConfirmedDate: hari(-1), deliveryConfirmedDate: null, hasComplaint: i === 2, activeRevision: null }));
const REVISI = Array.from({ length: 5 }, (_, i) => ({ id: `rv${i}`, status: ["DIAJUKAN", "DIREVISI", "DIANTAR_ULANG", "SELESAI", "DIAJUKAN"][i], trigger: ["TRIAL", "KLAIM_GARANSI", "KELUHAN"][i % 3], createdAt: hari(-i), unit: { unitCode: `U-${70 + i}` }, complaint: null }));

const VEH = [{ id: "v1", plateNumber: "B 1234 KMT", brand: "Daihatsu", model: "Gran Max", type: "VAN", status: "AVAILABLE", active: true }, { id: "v2", plateNumber: "B 9876 KMT", brand: "Mitsubishi", model: "L300", type: "PICKUP", status: "AVAILABLE", active: true }];
const EXPENSES = Array.from({ length: 6 }, (_, i) => ({ id: "e" + i, date: hari(-i), vehicle: VEH[i % 2], category: ["BBM", "TOL", "PARKIR", "BBM", "SERVIS", "LAINNYA"][i], amount: 150000 + i * 35000, odometerKm: 41200 + i * 80, liters: i % 3 === 0 ? 32 : null, driverId: "d1", driver: { name: "Andi Pratama" }, receiptUrl: null, notes: i === 1 ? "Tol Jagorawi" : "" }));
const PENGAJUAN = Array.from({ length: 6 }, (_, i) => ({ id: "s" + i, submissionNumber: "PB-2611-00" + (i + 1), date: hari(-i), expenseType: ["BBM", "TOL", "PARKIR", "SERVIS", "BBM", "LAINNYA"][i], vehiclePlateSnapshot: "B 1234 KMT", driverNameSnapshot: "Andi Pratama", picNameSnapshot: null, amount: 175000 + i * 60000, status: ["DRAFT", "DIAJUKAN", "DISETUJUI", "DIBAYAR", "PERLU_REVISI", "DITOLAK"][i], needsReview: i === 1, revisionReason: i === 4 ? "Foto struk buram" : null }));

// ── Tambahan: Route Planner / Kendali Rute / Laporan / Insentif / Pembayaran Insentif ──
const RUTE_STATUS = ["DRAFT", "PUBLISHED", "IN_PROGRESS", "IN_PROGRESS", "COMPLETED", "PUBLISHED", "DRAFT"];
const RUTE = Array.from({ length: 7 }, (_, i) => {
  const jobsR = JOBS.slice(i % 4, (i % 4) + 3).map((j, k) => ({ ...j, id: "rj" + i + k, routeId: "r" + i, routeSeq: k + 1, status: i === 4 ? "COMPLETED" : (k === 0 && i % 3 === 2 ? "COMPLETED" : j.status === "FAILED" ? "ASSIGNED" : j.status) }));
  return {
    id: "r" + i, code: "RT-0" + (i + 1), date: hari(i % 3 - 1), status: RUTE_STATUS[i], driverId: "d" + (i % 2 + 1), driver: { id: "d" + (i % 2 + 1), name: ["Andi Pratama", "Joko Susilo"][i % 2], isOnline: i % 3 !== 1, lastAppSyncAt: hari(i % 3 === 1 ? -1 : 0) },
    helperId: i % 2 ? "h1" : null, helper: i % 2 ? { id: "h1", name: "Rudi" } : null, vehicleId: "v" + (i % 2 + 1), vehicle: { id: "v" + (i % 2 + 1), plateNumber: ["B 1234 KMT", "B 9876 KMT"][i % 2], capacitySlots: 6 },
    jobs: jobsR, plannedDistanceKm: 18 + i * 3, plannedDurationMin: 95 + i * 12, notes: i === 1 ? "Muat kasur king dulu" : "", publishedAt: RUTE_STATUS[i] === "DRAFT" ? null : hari(-1), updatedAt: hari(0), lastEditedAt: null, lastEditReason: null, lastEditedBy: null, manualMapsUrl: null,
  };
});
const LAPORAN = {
  byStatus: [{ status: "COMPLETED", count: 41 }, { status: "FAILED", count: 3 }, { status: "ASSIGNED", count: 9 }, { status: "EN_ROUTE", count: 4 }, { status: "UNSCHEDULED", count: 6 }],
  byType: [{ type: "DELIVERY", count: 38 }, { type: "PICKUP", count: 25 }], byRouteStatus: [{ status: "PUBLISHED", count: 5 }, { status: "COMPLETED", count: 18 }, { status: "DRAFT", count: 2 }],
  byVehicleStatus: [{ status: "AVAILABLE", count: 2 }], pod: { VERIFIED: 30, PENDING_REVIEW: 6, INCOMPLETE: 3, REJECTED: 1 },
  externalCourier: { jobCount: 4, missingCost: 1, totalCost: 360000 },
  driverProductivity: [{ driverId: "d1", name: "Andi Pratama", completed: 24 }, { driverId: "d2", name: "Joko Susilo", completed: 17 }],
};
const FLEET = {
  perKendaraan: [{ id: "v1", plateNumber: "B 1234 KMT", picDriver: { name: "Andi Pratama" }, efisiensi: { kmPerLiter: 9.4, rupiahPerKm: 1450 }, totalBiaya: 2450000, biayaServis: 600000, jumlahInsiden: 0, biayaPerbaikanInsiden: 0, perKategori: { BBM: 1500000, TOL: 350000, PARKIR: 0, SERVIS: 600000 } },
    { id: "v2", plateNumber: "B 9876 KMT", picDriver: null, efisiensi: { alasanKosong: "Odometer belum lengkap" }, totalBiaya: 1320000, biayaServis: 0, jumlahInsiden: 2, biayaPerbaikanInsiden: 450000, perKategori: { BBM: 1100000, TOL: 220000 } }],
  perSupir: [{ driverId: "d1", name: "Andi Pratama", efisiensi: { kmPerLiter: 9.4, rupiahPerKm: 1450 }, totalBiaya: 2450000, jumlahInsiden: 0, insidenSalahSendiri: 0 }, { driverId: "d2", name: "Joko Susilo", efisiensi: { alasanKosong: "Belum cukup data" }, totalBiaya: 1320000, jumlahInsiden: 2, insidenSalahSendiri: 1 }],
};
const INSENTIF_RINGKAS = { ratePerAlamat: { withSim: 7000, withoutSim: 3000 }, orang: [{ id: "u1", name: "Andi Pratama", hasSim: true, asDriver: 24, asHelper: 2, totalAlamat: 22, totalInsentif: 154000, totalRupiah: 154000, details: [] }, { id: "u2", name: "Rudi Hartono", hasSim: false, asDriver: 0, asHelper: 17, totalAlamat: 15, totalInsentif: 45000, totalRupiah: 45000, details: [] }] };
const SNAP = [["SELESAI", "green", "Disetujui", 2650000], ["DRAFT", "neutral", "Draf", 1450000], ["DIPERIKSA", "orange", "Diperiksa", 980000], ["DIAJUKAN", "blue", "Menunggu setuju", 1200000]].map(([st, tone, label, tot], i) => ({ id: "sn" + i, status: st, tone, label, periodFrom: hari(-30 - i * 30).slice(0, 10), periodTo: hari(-1 - i * 30).slice(0, 10), totalAlamat: 310 - i * 20, totalRupiah: tot, computedBy: { name: "Gilang" }, approvedBy: i === 0 ? { name: "Owner" } : null }));
const ANTRIAN = [0, 1].map((i) => ({ id: "sq" + i, status: "DISETUJUI", tone: "green", label: ["Okt 2026 — periode 1", "Okt 2026 — periode 2"][i], periodFrom: hari(-30 - i * 15).slice(0, 10), periodTo: hari(-16 - i * 15).slice(0, 10), totalRupiah: 2650000, totalDibayar: 900000 * (i + 1), totalSisa: 2650000 - 900000 * (i + 1), progress: 30 + i * 30,
  lines: [{ id: "ln" + i + "a", userName: "Andi Pratama", totalRupiah: 1650000, dibayar: 900000, sisa: 750000, status: "SEBAGIAN", ratePerAlamat: 7000 }, { id: "ln" + i + "b", userName: "Rudi Hartono", totalRupiah: 1000000, dibayar: 0, sisa: 1000000, status: "BELUM", ratePerAlamat: 3000 }] }));
async function pasang(page) {
  await page.setBypassServiceWorker(true).catch(() => {}); await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = new URL(r.url()); const j = (o) => r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
    if (r.method() !== "GET") return r.continue();
    switch (u.pathname) {
      case "/api/armada/jobs": return j({ jobs: JOBS });
      case "/api/armada/pod": return j({ jobs: POD });
      case "/api/armada/issues": return j({ jobs: ISSUES });
      case "/api/orders": return j({ items: ORDERS, summary: { totalOrderAktif: 8, nilaiOrderAktif: 36800000, belumLunas: 12400000, siapKirim: 2, total: 8 } });
      case "/api/revisions": case "/api/armada/revisions": return j({ revisions: REVISI, items: REVISI, total: 5 });
      case "/api/armada/drivers": return j([{ id: "d1", name: "Andi Pratama", isExternalCourier: false }, { id: "d2", name: "Joko Susilo", isExternalCourier: false }]);
      case "/api/armada/helpers": return j([{ id: "h1", name: "Rudi" }]);
      case "/api/armada/vehicles": return j({ vehicles: VEH });
      case "/api/armada/expenses": return j(EXPENSES);
      case "/api/armada/services": return j([]);
      case "/api/finance/expense-submissions": return j({ submissions: PENGAJUAN });
      case "/api/armada/routes": return j({ routes: RUTE });
      case "/api/armada/reports/summary": return j(LAPORAN);
      case "/api/armada/fleet-summary": return j(FLEET);
      case "/api/armada/incentive-summary": return j(INSENTIF_RINGKAS);
      case "/api/armada/incentive-snapshots": return j({ snapshots: SNAP });
      case "/api/armada/incentive-payouts/queue": return j({ snapshots: ANTRIAN });
      case "/api/armada/incentive-payouts/cash-accounts": return j({ accounts: [] });
      default: return r.continue();
    }
  });
}
module.exports = { pasang, JOBS };
