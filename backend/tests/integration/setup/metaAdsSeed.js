// Seed bersama tes integrasi laporan Meta Ads (MCP): customer/order/pembayaran/touch/spend fiktif dengan skenario tepi (multi-order, retry touch, reaktivasi, UNMAPPED,
// CANCELLED/PENDING, payment dibatalkan+pengganti, ledger parsial, spend parsial, batas hari WIB). Dipakai oleh mcpLaporanMeta.integration dan releaseMcpLaporanMeta.integration.
const M = (n) => n * 1_000_000;
const T = (s) => new Date(s);
export const AKUN = "1234567890123";
export const AD1 = "52694481763484", AD2 = "52689767293284", AD3 = "52696131903684", AD9 = "52699999999999";
export const CAMP1 = "52694481763084", CAMP2 = "52696131903884";
export const SET1 = "52694481763284", SET2 = "52689767293084", SET3 = "52696131903484";
export const DARI = "2026-10-01", SAMPAI = "2026-10-10";
let urutanTouch = 0;

// ── seed ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function benihMetaAds({ testPrisma, admin }) {
  for (const [ad, set, camp, nama] of [[AD1, SET1, CAMP1, "Jabo IG Oktober"], [AD2, SET2, CAMP1, "Jabo IG Oktober"], [AD3, SET3, CAMP2, "FB broad test"]]) {
    await testPrisma.metaAdReference.create({ data: { adId: ad, adSetId: set, campaignId: camp, campaignName: nama, adSetName: `Set ${set.slice(-2)}`, adName: `Ad ${ad.slice(-2)}`, source: "MANUAL", syncedAt: new Date() } });
  }
  const cust = (phone, createdAt, o = {}) => testPrisma.customer.create({ data: { name: "Pelanggan Uji", phone, createdAt: T(createdAt), leadSource: "META_ADS", ...o } });
  const order = (customerId, createdAt, value, o = {}) => testPrisma.order.create({ data: { customerId, createdAt: T(createdAt), value, status: "PROCESSING", ...o } });
  const bayar = (orderId, createdAt, amount, o = {}) => testPrisma.payment.create({ data: { orderId, amount, method: "TRANSFER", recordedById: admin.id, createdAt: T(createdAt), ...o } });
  const sentuh = (customerId, adId, touchAt, o = {}) => {
    const at = T(touchAt);
    return testPrisma.attributionTouch.create({ data: {
      customerId, adId, touchAt: at, touchDateWib: T(new Date(at.getTime() + 7 * 3600e3).toISOString().slice(0, 10) + "T00:00:00Z"),
      mappingStatusAtTouch: "UNMAPPED", evidenceSource: "CTWA_AD", sourceType: "ad", customerStatusAtTouch: "NEW", customerBasisAtTouch: "WEBHOOK_MEMBUAT", dedupeKey: `mcp:${++urutanTouch}`, ...o,
    } });
  };
  const LAMA = { customerStatusAtTouch: "EXISTING", customerBasisAtTouch: "RIWAYAT_PESAN" };

  // C0: touch paling awal (29 Sep) → atribusi sebanding untuk periode uji; di luar periode
  const c0 = await cust("6285301000000", "2026-09-29T03:00:00Z"); await sentuh(c0.id, AD1, "2026-09-29T03:01:00Z");
  // C1: DP 1jt (2 Okt) + pelunasan 3jt (5 Okt) → lunas ledger
  const c1 = await cust("6285301000001", "2026-10-01T03:00:00Z", { pipelineStage: "PROSPECT" });
  const o1 = await order(c1.id, "2026-10-02T03:00:00Z", M(4), { paymentStatus: "LUNAS", paidAt: T("2026-10-05T03:00:00Z") });
  await bayar(o1.id, "2026-10-02T04:00:00Z", M(1)); await bayar(o1.id, "2026-10-05T03:00:00Z", M(3));
  await sentuh(c1.id, AD1, "2026-10-01T03:01:00Z");
  // C2: DUA order (satu customer). O2 lunas 2jt; O3 DP: payment 500rb DIBATALKAN lalu diganti 750rb
  const c2 = await cust("6285301000002", "2026-10-01T04:00:00Z");
  const o2 = await order(c2.id, "2026-10-03T03:00:00Z", M(2), { paymentStatus: "LUNAS", paidAt: T("2026-10-03T05:00:00Z") });
  await bayar(o2.id, "2026-10-03T05:00:00Z", M(2));
  const o3 = await order(c2.id, "2026-10-04T03:00:00Z", 1_500_000, { paymentStatus: "DP" });
  const batal = await bayar(o3.id, "2026-10-04T04:00:00Z", 500_000, { cancelledAt: T("2026-10-04T06:00:00Z"), cancelledById: admin.id, cancelReason: "salah input" });
  await bayar(o3.id, "2026-10-04T06:30:00Z", 750_000, { replacesPaymentId: batal.id });
  await sentuh(c2.id, AD1, "2026-10-01T04:01:00Z");
  // C3: LUNAS di CRM tetapi TANPA ledger (ledger parsial) — bukan pernah membayar, bukan lunas ledger
  const c3 = await cust("6285301000003", "2026-10-02T03:00:00Z");
  await order(c3.id, "2026-10-04T03:00:00Z", M(3), { paymentStatus: "LUNAS", paidAt: T("2026-10-04T08:00:00Z") });
  await sentuh(c3.id, AD2, "2026-10-02T03:01:00Z");
  // C4: Ad ID belum terpetakan (UNMAPPED)
  const c4 = await cust("6285301000004", "2026-10-02T05:00:00Z"); await sentuh(c4.id, AD9, "2026-10-02T05:01:00Z");
  // C5: SPAM dengan order berbayar → keluar dari metrik
  const c5 = await cust("6285301000005", "2026-10-03T03:00:00Z", { pipelineStage: "SPAM" });
  const o5 = await order(c5.id, "2026-10-04T03:00:00Z", M(5), { paymentStatus: "LUNAS", paidAt: T("2026-10-04T05:00:00Z") });
  await bayar(o5.id, "2026-10-04T05:00:00Z", M(5)); await sentuh(c5.id, AD1, "2026-10-03T03:01:00Z");
  // C6: organik (tanpa touch)
  await cust("6285301000006", "2026-10-04T03:00:00Z");
  // C7: customer LAMA (Agustus) klik iklan lagi → reaktivasi, bukan lead
  const c7 = await cust("6285301000007", "2026-08-15T03:00:00Z"); await sentuh(c7.id, AD1, "2026-10-05T03:00:00Z", LAMA);
  // C8: campaign lain; status LUNAS tetapi ledger 2jt dari tagihan 2,2jt (value + ongkir) → DP menurut ledger
  const c8 = await cust("6285301000008", "2026-10-05T03:00:00Z");
  const o8 = await order(c8.id, "2026-10-06T03:00:00Z", M(2), { ongkir: 200_000, paymentStatus: "LUNAS", paidAt: T("2026-10-06T05:00:00Z") });
  await bayar(o8.id, "2026-10-06T05:00:00Z", M(2)); await sentuh(c8.id, AD3, "2026-10-05T03:01:00Z");
  // C9: retry/multi-touch — akuisisi AD2 lebih dulu; touch AD1 berikutnya (customer sudah ada) hanya reaktivasi/berikutnya
  const c9 = await cust("6285301000009", "2026-10-07T03:00:00Z");
  await sentuh(c9.id, AD2, "2026-10-07T03:01:00Z"); await sentuh(c9.id, AD1, "2026-10-08T03:00:00Z", LAMA);
  // C10: order DIBATALKAN; C11: order PENDING → bukan order eligible
  const c10 = await cust("6285301000010", "2026-10-08T03:00:00Z");
  await order(c10.id, "2026-10-08T05:00:00Z", M(1), { status: "CANCELLED" }); await sentuh(c10.id, AD1, "2026-10-08T03:01:00Z");
  const c11 = await cust("6285301000011", "2026-10-08T04:00:00Z");
  await order(c11.id, "2026-10-08T06:00:00Z", M(2), { status: "PENDING" }); await sentuh(c11.id, AD1, "2026-10-08T04:01:00Z");
  // BATAS HARI WIB: CB1 dibuat 8 Okt 23:59:59 WIB (lunas 1jt); CB2 dibuat 9 Okt 00:00:00 WIB
  const cb1 = await cust("6285301000012", "2026-10-08T16:59:59Z");
  const ob1 = await order(cb1.id, "2026-10-09T03:00:00Z", M(1), { paymentStatus: "LUNAS", paidAt: T("2026-10-09T04:00:00Z") });
  await bayar(ob1.id, "2026-10-09T04:00:00Z", M(1)); await sentuh(cb1.id, AD1, "2026-10-08T16:59:59Z");
  const cb2 = await cust("6285301000013", "2026-10-08T17:00:00Z"); await sentuh(cb2.id, AD2, "2026-10-08T17:00:00Z");

  // spend: lengkap 1–10 Okt untuk AD1 100rb, AD2 50rb, AD3 20rb per hari; AD9 (UNMAPPED) 5rb di 2 Okt. 11–12 Okt SENGAJA kosong (spend parsial).
  const imp = await testPrisma.metaSpendImport.create({ data: { source: "ADS_MANAGER_CSV", accountId: AKUN, contentSha256: "a".repeat(64), rowsTotal: 0, rowsAccepted: 0, rowsRejected: 0, rowsNew: 0, rowsUpdated: 0, rowsUnchanged: 0, spendTotal: 0, accountTimezone: "Asia/Jakarta" } });
  let n = 0;
  const hier = { [AD1]: [CAMP1, SET1, 100_000], [AD2]: [CAMP1, SET2, 50_000], [AD3]: [CAMP2, SET3, 20_000] };
  for (let t = Date.parse(`${DARI}T00:00:00Z`); t <= Date.parse(`${SAMPAI}T00:00:00Z`); t += 86_400_000) {
    for (const [ad, [camp, set, spend]] of Object.entries(hier)) {
      await testPrisma.metaAdDailySpend.create({ data: { dateWib: new Date(t), accountId: AKUN, campaignId: camp, adSetId: set, adId: ad, currency: "IDR", spend, source: "ADS_MANAGER_CSV", accountTimezone: "Asia/Jakarta", importedAt: new Date(), importId: imp.id, rowChecksum: String(++n).padStart(64, "0") } });
    }
  }
  await testPrisma.metaAdDailySpend.create({ data: { dateWib: T("2026-10-02T00:00:00Z"), accountId: AKUN, campaignId: "52699999999001", adSetId: "52699999999002", adId: AD9, currency: "IDR", spend: 5_000, source: "ADS_MANAGER_CSV", accountTimezone: "Asia/Jakarta", importedAt: new Date(), importId: imp.id, rowChecksum: String(++n).padStart(64, "0") } });
}
