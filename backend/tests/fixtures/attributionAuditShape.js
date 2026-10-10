// FIXTURE SINTETIS "berbentuk audit" — dibangun supaya agregatnya SAMA dengan hitungan agregat audit Fase 1 (10 Okt 2026, docs/ATRIBUSI-FASE1-AUDIT-REVIEW.md).
// Ini BUKAN data produksi: tidak ada nama, nomor, ID nyata, atau isi chat. Fungsinya membuktikan bahwa kode kohort menghasilkan angka audit dari data
// BERBENTUK audit, termasuk selisih terhadap definisi Dashboard. Bagian yang tidak diberikan audit (mis. sebaran 133 paid_at backfill per bulan,
// bulan lead pelanggan lama) ditetapkan di sini secara eksplisit dan TIDAK diklaim sebagai fakta produksi.
//
// Angka audit yang direproduksi:
//   populasi   : 9.362 customer = 8.825 lead sah + 537 dikecualikan (535 SPAM, 1 B2B, 6 staf — 5 di antaranya juga SPAM, sehingga 537 unik)
//   order      : 617 eligible, 42 batal, 21 pending; 9 customer hanya ber-order PENDING (Dashboard 415 vs kohort 406)
//   sebaran    : customer menurut order eligible 0=8.419, 1=297, 2=64, 3+=45 (repeat 109; Dashboard 111 karena 2 order PENDING)
//   bulan order: Jul 123, Agu 208, Sep 221, Okt 65; dari lead lama: Agu 39, Sep 55, Okt 35; order berulang Okt 25
//   ledger     : order ber-ledger per bulan order Jul 8/123, Agu 61/208, Sep 202/221, Okt 19/65
//   lunas      : 556 LUNAS tersimpan, 270 tanpa pembayaran ledger, 133 ber-paidAt backfill 31 Agt, 4 DP kini
//   rupiah     : Σ nilai order LUNAS Rp1.248,7 jt; uang ledger Rp633,7 jt (Rp631,9 jt pada order lunas + Rp1,8 jt DP)
//   prospek    : 991 di stage prospek-atau-lanjut, 118 tanpa transisi
import { PAID_AT_BACKFILL_31_AGT } from "../../src/services/attribution/cohortDefinitions.js";

const pad = (n, w = 5) => String(n).padStart(w, "0");
const at = (ym, day = 15, jam = 3) => `${ym}-${String(day).padStart(2, "0")}T${String(jam).padStart(2, "0")}:00:00Z`;

export function bangunFixtureBentukAudit() {
  const customers = [];
  const orders = [];
  const kontribusi = [];
  let nCust = 0, nOrd = 0;
  const cust = (ymLead, o = {}) => {
    const c = { id: `c${pad(++nCust)}`, createdAt: at(ymLead, 10), pipelineStage: "NEW", leadSource: "META_ADS", isInternalStaff: false, staffUserId: null, transitions: [], ...o };
    customers.push(c); return c;
  };
  const ord = (customerId, ymOrder, o = {}) => {
    const x = { id: `o${pad(++nOrd)}`, customerId, createdAt: at(ymOrder, 15), value: 0, tagihan: 0, status: "PROCESSING", penjualanKaryawanId: null, paymentStatus: "BELUM_BAYAR", paidAt: null, ...o };
    orders.push(x); return x;
  };

  // ── 1. Customer ber-order eligible (406), orderan eligible 617 ─────────────────────────────────────────────────
  const eligible = [];                                  // order eligible, urutan pembuatan (untuk penugasan status per bulan)
  const tambahEligible = (c, ym) => eligible.push(ord(c.id, ym));
  const singles = [["2026-07", "2026-07", 84], ["2026-08", "2026-08", 32], ["2026-09", "2026-09", 141], ["2026-10", "2026-10", 30], ["2026-09", "2026-10", 10]];
  const singlesCust = [];
  for (const [lead, order, n] of singles) for (let i = 0; i < n; i++) { const c = cust(lead); singlesCust.push(c); tambahEligible(c, order); }
  for (let i = 0; i < 25; i++) { const c = cust("2026-09"); tambahEligible(c, "2026-09"); tambahEligible(c, "2026-10"); }   // k=2, berulang di Okt
  for (let i = 0; i < 39; i++) { const c = cust("2026-07"); tambahEligible(c, "2026-07"); tambahEligible(c, "2026-08"); }   // k=2, pelunasan lintas bulan
  const multiAgu = [];
  for (let i = 0; i < 45; i++) {
    const c = cust("2026-08"); multiAgu.push(c);
    const k = i < 33 ? 4 : 5;                        // 33 customer 4 order + 12 customer 5 order = 192 order
    const t = i < 10 ? 2 : 1;                        // order lanjutan di Sep: 10×2 + 35×1 = 55
    for (let j = 0; j < k - t; j++) tambahEligible(c, "2026-08");
    for (let j = 0; j < t; j++) tambahEligible(c, "2026-09");
  }

  // ── 2. Status bayar & ledger per bulan order (angka audit) ─────────────────────────────────────────────────────
  const perBulan = {};
  for (const o of eligible) (perBulan[o.createdAt.slice(0, 7)] ||= []).push(o);
  const rencana = {
    // [ledgerLunas, lunasTanpaLedger, belumBayar, dpLedger, lunasBackfill(dari lunasTanpaLedger)]
    "2026-07": [8, 115, 0, 0, 60],
    "2026-08": [61, 147, 0, 0, 73],
    "2026-09": [202, 8, 11, 0, 0],
    "2026-10": [15, 0, 46, 4, 0],
  };
  let iLedgerLunas = 0, iTanpaLunas = 0;
  let nBayar = 0;
  const bayar = (o, amount, ymBayar, hari = 16) => kontribusi.push({ id: `p${pad(++nBayar)}`, orderId: o.id, amount, createdAt: at(ymBayar, hari, 4) });
  for (const [ym, [ledgerLunas, tanpaLunas, belum, dp, backfill]] of Object.entries(rencana)) {
    const daftar = perBulan[ym];
    let i = 0;
    for (let k = 0; k < ledgerLunas; k++, i++) {
      const o = daftar[i]; const v = 2_209_000 + (iLedgerLunas++ === 0 ? 126_000 : 0);
      o.value = o.tagihan = v; o.paymentStatus = "LUNAS"; o.paidAt = at(ym, 16, 4); bayar(o, v, ym);
    }
    for (let k = 0; k < dp; k++, i++) { const o = daftar[i]; o.value = o.tagihan = 2_000_000; o.paymentStatus = "DP"; bayar(o, 450_000, ym); }
    for (let k = 0; k < tanpaLunas; k++, i++) {
      const o = daftar[i]; const v = 2_284_000 + (iTanpaLunas++ === 0 ? 120_000 : 0);
      o.value = o.tagihan = v; o.paymentStatus = "LUNAS";
      o.paidAt = k < backfill ? PAID_AT_BACKFILL_31_AGT.toISOString() : at(ym, 18, 4);
    }
    for (let k = 0; k < belum; k++, i++) { const o = daftar[i]; o.value = o.tagihan = 1_500_000; o.paymentStatus = "BELUM_BAYAR"; }
    if (i !== daftar.length) throw new Error(`fixture tidak konsisten untuk ${ym}: ${i} != ${daftar.length}`);
  }

  // ── 3. PENDING (21) dan CANCELLED (42) ─────────────────────────────────────────────────────────────────────────
  for (let i = 0; i < 9; i++) { const c = cust("2026-10"); ord(c.id, "2026-10", { status: "PENDING", value: 1_000_000, tagihan: 1_000_000 }); }        // hanya PENDING
  for (let i = 0; i < 2; i++) ord(singlesCust[singlesCust.length - 1 - i].id, "2026-10", { status: "PENDING", value: 1_000_000, tagihan: 1_000_000 });   // → repeat versi Dashboard
  const multiJul = customers.filter((c) => c.createdAt.startsWith("2026-07") && orders.filter((o) => o.customerId === c.id && o.status !== "PENDING").length === 2);
  for (let i = 0; i < 10; i++) ord(multiJul[i].id, "2026-10", { status: "PENDING", value: 1_000_000, tagihan: 1_000_000 });
  const batalCust = [];
  for (let i = 0; i < 42; i++) { const c = cust("2026-10"); batalCust.push(c); ord(c.id, "2026-10", { status: "CANCELLED", value: 1_000_000, tagihan: 1_000_000 }); }

  // ── 4. Lead tanpa order sampai 8.825 + prospek ─────────────────────────────────────────────────────────────────
  const BULAN = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];
  const sahSaatIni = customers.length;               // semua customer di atas adalah lead sah
  const sisa = 8825 - sahSaatIni;
  for (let i = 0; i < sisa; i++) {
    const stage = i < 991 ? "PROSPECT" : "NEW";
    const transitions = i < 873 ? [{ toStage: "PROSPECT", createdAt: at(BULAN[i % 5], 12) }] : [];   // 991 prospek, 118 tanpa transisi
    cust(BULAN[i % 5], { pipelineStage: stage, transitions });
  }

  // ── 5. Dikecualikan: 535 SPAM (5 di antaranya juga staf), 1 B2B, 1 staf bukan SPAM ⇒ 537 unik ──────────────────
  for (let i = 0; i < 535; i++) cust("2026-09", { pipelineStage: "SPAM", isInternalStaff: i < 5 });
  cust("2026-09", { leadSource: "B2B_DIRECT" });
  cust("2026-09", { isInternalStaff: true });

  return { customers, orders, kontribusi, refunds: [] };
}

/** Definisi Dashboard (analytics.js:282/298): customer non-SPAM & non-B2B dengan order non-CANCELLED (termasuk PENDING). Hitung dari data mentah. */
export function hitungDefinisiDashboard({ customers, orders }) {
  const sah = new Set(customers.filter((c) => c.pipelineStage !== "SPAM" && c.leadSource !== "B2B_DIRECT").map((c) => c.id));
  const per = new Map();
  for (const o of orders) if (sah.has(o.customerId) && o.status !== "CANCELLED") per.set(o.customerId, (per.get(o.customerId) || 0) + 1);
  return { customerDenganOrder: per.size, repeat: [...per.values()].filter((n) => n >= 2).length };
}
