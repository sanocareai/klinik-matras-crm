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
      default: return r.continue();
    }
  });
}
module.exports = { pasang, JOBS };
