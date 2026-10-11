// FASE 1 — INTI KOHORT (murni: tanpa DB, tanpa I/O, deterministik). Lihat cohortDefinitions.js untuk arti tiap metrik.
//
// Tiga tanggal DIBEDAKAN dan menghasilkan TIGA laporan terpisah (tidak ada tampilan campuran):
//   perBulanLead       — kunci Customer.createdAt (bulan WIB): apa yang dihasilkan lead bulan itu sepanjang umurnya
//   perBulanOrder      — kunci Order.createdAt (bulan WIB):    apa yang dibukukan di bulan itu, dari lead bulan sama vs lead lama
//   perBulanPembayaran — kunci Payment.createdAt / Order.paidAt / hari lunas ledger (bulan WIB): uang dan lunas yang terjadi di bulan itu
// Tiga satuan DIBEDAKAN: customer, order, dan rupiah. Rupiah dipisah lagi: BOOKED (Order.value), UANG (ledger valid), dan nilai order lunas.
//
// DUA jenis lunas dengan nama eksplisit — tidak pernah ditukar:
//   lunasMenurutCrm     status tersimpan (Order.paymentStatus = LUNAS) — yang dilihat tampilan operasional; konflik ledger TETAP termasuk
//   lunasTerbuktiLedger ledger valid menutup SELURUH tagihan (bersih ≥ tagihan) — konflik/kurang TIDAK masuk
//
// Masukan sudah berupa objek biasa. Loader (cohortLoader.js) menyiapkan `kontribusi` yang SUDAH disaring dengan aturan paymentLedger
// (bukan dibatalkan, lolos gerbang verifikasi, sadar-alokasi). Inti ini tidak menebak apa pun.
import { ORDER_EXCLUDED_STATUS, STAGE_PROSPEK_ATAU_LANJUT, LEAD_EXCLUSION, PAID_AT_BACKFILL_31_AGT } from "./cohortDefinitions.js";

const WIB_MS = 7 * 3600 * 1000;
/** Hari kalender WIB (YYYY-MM-DD) dari instan UTC. */
export const hariWIB = (d) => new Date(new Date(d).getTime() + WIB_MS).toISOString().slice(0, 10);
/** Bulan kalender WIB (YYYY-MM). */
export const bulanWIB = (d) => hariWIB(d).slice(0, 7);
const rp = (n) => Number(n) || 0;
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const dalamPeta = (m, k) => m.get(k) || m.set(k, []).get(k);
const jum = (obj, f) => Object.values(obj).reduce((s, x) => s + f(x), 0);

/** Alasan customer bukan lead pemasaran; null = lead sah. */
export function alasanBukanLead(c) {
  if (c.pipelineStage === "SPAM") return "SPAM";
  if (c.leadSource === "B2B_DIRECT") return "B2B_DIRECT";
  if (c.isInternalStaff) return "INTERNAL_STAFF";
  if (c.staffUserId) return "PROFIL_KARYAWAN";
  return null;
}

/**
 * Jejak pembayaran satu order. `kontribusi` = [{ id, amount, createdAt }] yang SUDAH dihitung. Urutan = hari WIB lalu id
 * (sama dengan paymentLedger.tanggalLunasEfektif), sehingga tanggal lunas tidak bergantung waktu pencatatan/koreksi.
 */
export function jejakPembayaran(kontribusi, tagihan, refunds = []) {
  const urut = [...kontribusi].sort((a, b) => {
    const da = hariWIB(a.createdAt), db = hariWIB(b.createdAt);
    return da < db ? -1 : da > db ? 1 : String(a.id) < String(b.id) ? -1 : 1;
  });
  const T = rp(tagihan);
  let kum = 0, hariBayarPertama = null, hariLunas = null, pernahDp = false;
  for (const k of urut) {
    kum += rp(k.amount);
    if (hariBayarPertama === null) {
      hariBayarPertama = hariWIB(k.createdAt);
      if (T > 0 && kum < T) pernahDp = true;   // pembayaran pertama belum menutup tagihan = ada fase DP
    }
    if (hariLunas === null && T > 0 && kum >= T) hariLunas = hariWIB(k.createdAt);
  }
  const refund = refunds.reduce((s, r) => s + rp(r.amount), 0);
  const kotor = urut.reduce((s, k) => s + rp(k.amount), 0);
  const bersih = Math.max(kotor - refund, 0);                  // aturan paidForOrder: tidak pernah negatif
  const status = T > 0 && bersih >= T ? "LUNAS" : bersih > 0 ? "DP" : "BELUM_BAYAR";
  return {
    kotor, refund, bersih, status, hariBayarPertama, hariLunas: status === "LUNAS" ? hariLunas : null, pernahDp,
    jumlahPembayaran: urut.length, pernahMenerima: kotor > 0,
  };
}

/**
 * Tanggal lunas MENURUT CRM (Order.paymentStatus/paidAt). Mengembalikan null bila order tidak LUNAS.
 *   TERCATAT      paidAt terisi dan BUKAN timestamp backfill 31 Agt 2026 → hari WIB masuk tren lunasMenurutCrm
 *   TIDAK_PASTI   paidAt = timestamp backfill (tanggal asli tidak pernah tercatat) → TIDAK masuk tren mana pun
 *   TANPA_TANGGAL LUNAS tanpa paidAt
 * `dikunciOwner`: tanggal itu dikunci pengecualian Owner — membuktikan TANGGAL yang dikunci, bukan uang diterima.
 * `didukungLedger`: ledger valid juga menghitung order ini LUNAS pada hari WIB yang sama.
 */
export function tanggalLunasMenurutCrm(order, jejak) {
  if (order.paymentStatus !== "LUNAS") return null;
  if (!order.paidAt) return { sumber: "TANPA_TANGGAL", hari: null, didukungLedger: false, dikunciOwner: false };
  if (new Date(order.paidAt).getTime() === PAID_AT_BACKFILL_31_AGT.getTime()) return { sumber: "TIDAK_PASTI", hari: null, didukungLedger: false, dikunciOwner: false };
  const hari = hariWIB(order.paidAt);
  return { sumber: "TERCATAT", hari, didukungLedger: jejak.status === "LUNAS" && jejak.hariLunas === hari, dikunciOwner: !!order.paidAtDikunciOwner };
}

/**
 * BUKTI PELUNASAN satu order eligible — memisahkan status tersimpan, cakupan ledger, dan bukti:
 *   LUNAS_TERBUKTI_LEDGER                 tersimpan LUNAS dan ledger valid ≥ tagihan
 *   LUNAS_TANPA_LEDGER                    tersimpan LUNAS, tidak ada payment valid sama sekali (histori/manual; belum terbukti)
 *   KONFLIK_LUNAS_LEDGER_TIDAK_CUKUP      tersimpan LUNAS, ada payment valid tetapi bersih < tagihan (mis. 50%): bukan lunas terbukti dan bukan DP selaras
 *   KONFLIK_BELUM_LUNAS_LEDGER_CUKUP      tersimpan bukan LUNAS tetapi ledger valid ≥ tagihan
 *   null                                  tidak ada klaim lunas dan tidak ada konflik lunas
 * `kekurangan` = tagihan − bersih ledger (rupiah) untuk konflik tidak-cukup. Penyebab konflik TIDAK disimpulkan.
 */
export function buktiPelunasanOrder(order, jejak, tagihan) {
  const adaLedger = jejak.jumlahPembayaran > 0;
  if (order.paymentStatus === "LUNAS") {
    if (jejak.status === "LUNAS") return { kelas: "LUNAS_TERBUKTI_LEDGER", kekurangan: 0 };
    if (!adaLedger) return { kelas: "LUNAS_TANPA_LEDGER", kekurangan: 0 };
    return { kelas: "KONFLIK_LUNAS_LEDGER_TIDAK_CUKUP", kekurangan: Math.max(rp(tagihan) - jejak.bersih, 0) };
  }
  if (jejak.status === "LUNAS") return { kelas: "KONFLIK_BELUM_LUNAS_LEDGER_CUKUP", kekurangan: 0 };
  return null;
}

const kosongBukti = () => ({
  lunasTerbuktiLedger: 0, lunasTanpaLedger: 0,
  konflikLunasTersimpanLedgerTidakCukup: 0, konflikBelumLunasTersimpanLedgerCukup: 0,
  kekuranganRupiahKonflik: 0,
});
const kosongLunasCrm = () => ({ jumlah: 0, nilai: 0, tanggalPasti: 0, tanggalTidakPasti: 0, tanpaTanggal: 0, tanggalDikunciOwner: 0, didukungLedger: 0 });
const kosongLunasLedger = () => ({ jumlah: 0, nilai: 0 });
const kosongCakupan = () => ({ orderEligible: 0, orderBerLedger: 0, berLedgerCukup: 0, berLedgerSebagian: 0, orderTanpaLedger: 0, nilaiOrderTanpaLedger: 0 });
const kosongStatus = () => ({ BELUM_BAYAR: 0, DP: 0, LUNAS: 0, LAIN: 0 });

const kosongLead = () => ({
  // satuan customer
  leads: 0,
  pernahDitandaiProspek: { berTanggal: 0, tanpaTanggal: 0, stageSaatIni: 0 },
  customerDenganOrder: 0, customerRepeat: 0, customerOrderPertamaBulanSama: 0, customerHanyaOrderPending: 0,
  // satuan order
  orders: 0, orderPending: 0, orderBatal: 0, orderDpSaatIniLedger: 0, orderDpSaatIniKonflikLunasCrm: 0, orderPernahDp: 0, orderDenganRefund: 0,
  statusBayarTersimpan: kosongStatus(),
  // rupiah — booked
  nilaiOrder: 0,
  // dua jenis lunas + bukti
  lunasMenurutCrm: kosongLunasCrm(),
  lunasTerbuktiLedger: kosongLunasLedger(),
  buktiPelunasan: kosongBukti(),
  // rupiah — ledger valid
  uangLedger: 0, refundDisetujui: 0, uangBersihLedger: 0, uangPadaOrderPending: 0, uangPadaOrderBatal: 0,
  cakupanLedger: kosongCakupan(),
  // sebaran lintas bulan (kunci = bulan WIB order / pembayaran / lunas)
  menurutBulanOrder: {}, menurutBulanPembayaran: {}, menurutBulanLunasMenurutCrm: {}, menurutBulanLunasTerbuktiLedger: {},
});
const kosongOrderBulan = () => ({
  orders: 0, nilaiOrder: 0, customerUnik: 0,
  orderDariLeadBulanSama: 0, orderDariLeadLama: 0, orderSebelumLead: 0,
  orderPertamaCustomer: 0, orderBerulang: 0,   // berulang = customer itu sudah punya order eligible yang lebih awal
  orderPending: 0, orderBatal: 0,
  statusBayarTersimpan: kosongStatus(),
  lunasMenurutCrm: kosongLunasCrm(), lunasTerbuktiLedger: kosongLunasLedger(), buktiPelunasan: kosongBukti(),
  cakupanLedger: kosongCakupan(),
});
const kosongBayarBulan = () => ({
  uangLedger: 0, jumlahPembayaran: 0, orderDibayar: 0,
  uangDariLeadBulanSama: 0, uangDariLeadLama: 0, uangPadaOrderPending: 0,
  refundDisetujui: 0, uangBersihLedger: 0,
  lunasMenurutCrm: { jumlah: 0, didukungLedger: 0, konflikLedger: 0, tanggalDikunciOwner: 0 },   // menurut paidAt tercatat (bukan backfill) pada bulan itu
  lunasTerbuktiLedger: { jumlah: 0 },                                                            // menurut hari WIB payment yang menutup tagihan
});

/**
 * @param {object} input
 * @param {Array<{id,createdAt,pipelineStage,leadSource,isInternalStaff,staffUserId,transitions?:Array<{toStage,createdAt}>}>} input.customers
 * @param {Array<{id,customerId,createdAt,status,value,tagihan?,penjualanKaryawanId?,paymentStatus?,paidAt?,paidAtDikunciOwner?}>} input.orders
 * @param {Array<{id,orderId,amount,createdAt}>} input.kontribusi  hanya yang DIHITUNG; sudah sadar-alokasi
 * @param {Array<{orderId,amount,approvedAt?,date?,status}>} [input.refunds]
 */
export function buildCohort({ customers, orders, kontribusi, refunds = [] }) {
  const perBulanLead = {};
  const lead = (m) => (perBulanLead[m] ||= kosongLead());
  const perBulanOrder = {};
  const obln = (m) => (perBulanOrder[m] ||= kosongOrderBulan());
  const perBulanPembayaran = {};
  const pbln = (m) => (perBulanPembayaran[m] ||= kosongBayarBulan());
  const luarKohort = { orders: 0, nilaiOrder: 0, uangLedger: 0, uangPadaOrderBatal: 0, refundDisetujui: 0, perAlasan: {} };
  const alasanLuar = (a) => (luarKohort.perAlasan[a] ||= { customers: 0, orders: 0, nilaiOrder: 0, uangLedger: 0 });

  // 1. Lead dan kohort
  const peta = new Map();   // customerId → { bulanLead, alasan }
  for (const c of customers) {
    const alasan = alasanBukanLead(c);
    if (alasan) { peta.set(c.id, { alasan }); alasanLuar(alasan).customers++; continue; }
    const bulanLead = bulanWIB(c.createdAt);
    peta.set(c.id, { bulanLead, alasan: null });
    const k = lead(bulanLead); k.leads++;
    const tr = (c.transitions || []).filter((t) => STAGE_PROSPEK_ATAU_LANJUT.includes(t.toStage));
    if (tr.length) k.pernahDitandaiProspek.berTanggal++;
    else if (STAGE_PROSPEK_ATAU_LANJUT.includes(c.pipelineStage)) k.pernahDitandaiProspek.tanpaTanggal++;
    if (STAGE_PROSPEK_ATAU_LANJUT.includes(c.pipelineStage)) k.pernahDitandaiProspek.stageSaatIni++;
  }

  // 2. Pembayaran per order
  const kontribPerOrder = new Map();
  for (const k of kontribusi) dalamPeta(kontribPerOrder, k.orderId).push(k);
  const refundPerOrder = new Map();
  for (const r of refunds) if (r.status === "DISETUJUI") dalamPeta(refundPerOrder, r.orderId).push(r);
  const orderIds = new Set(orders.map((o) => o.id));

  // 3. Order
  const perCustomerEligible = new Map();   // customerId → [{ bulan, createdAt, id }]
  const customerPending = new Set();       // customer dengan ≥1 order PENDING (bukan karyawan)
  const customerUnikBulan = new Map();     // bulanOrder → Set(customerId)
  const orderDibayarBulan = new Map();     // bulanBayar → Set(orderId)
  const bagian = { eligible: 0, pending: 0, batal: 0, luar: 0 };
  let selisihStatusBayar = 0;
  for (const o of orders) {
    const info = peta.get(o.customerId);
    const tagihan = o.tagihan != null ? o.tagihan : o.value;
    const jejak = jejakPembayaran(kontribPerOrder.get(o.id) || [], tagihan, refundPerOrder.get(o.id) || []);
    const bulanOrder = bulanWIB(o.createdAt);

    const luarAlasan = !info ? "CUSTOMER_TIDAK_DIKENAL" : o.penjualanKaryawanId ? "ORDER_PENJUALAN_KARYAWAN" : info.alasan;
    if (luarAlasan) {
      if (o.status === "CANCELLED") { bagian.batal++; luarKohort.uangPadaOrderBatal += jejak.kotor; continue; }   // batal luar kohort: dihitung di `batal`, uangnya dilacak terpisah
      bagian.luar++;
      luarKohort.orders++; luarKohort.nilaiOrder += rp(o.value); luarKohort.uangLedger += jejak.kotor; luarKohort.refundDisetujui += jejak.refund;
      const a = alasanLuar(luarAlasan); a.orders++; a.nilaiOrder += rp(o.value); a.uangLedger += jejak.kotor;
      continue;
    }
    const k = lead(info.bulanLead);

    if (o.status === "CANCELLED") {
      bagian.batal++; k.orderBatal++; k.uangPadaOrderBatal += jejak.kotor;
      obln(bulanOrder).orderBatal++;
      continue;
    }
    if (o.status === "PENDING") {
      bagian.pending++; k.orderPending++; k.uangPadaOrderPending += jejak.kotor;
      obln(bulanOrder).orderPending++;
      customerPending.add(o.customerId);
      // uang pada order PENDING tetap fakta kas — tercatat sebagai uang ledger; order-nya sendiri tidak dihitung.
    } else {
      bagian.eligible++;
      const ob = obln(bulanOrder);
      k.orders++; k.nilaiOrder += rp(o.value);
      ob.orders++; ob.nilaiOrder += rp(o.value);
      inc(k.menurutBulanOrder, bulanOrder, 1);
      if (bulanOrder === info.bulanLead) ob.orderDariLeadBulanSama++;
      else if (bulanOrder > info.bulanLead) ob.orderDariLeadLama++;
      else ob.orderSebelumLead++;                       // anomali data: order bertanggal sebelum customer dibuat
      dalamPeta(perCustomerEligible, o.customerId).push({ bulan: bulanOrder, createdAt: new Date(o.createdAt).getTime(), id: String(o.id) });
      (customerUnikBulan.get(bulanOrder) || customerUnikBulan.set(bulanOrder, new Set()).get(bulanOrder)).add(o.customerId);

      const bukti = buktiPelunasanOrder(o, jejak, tagihan);
      const konflikLunas = bukti?.kelas === "KONFLIK_LUNAS_LEDGER_TIDAK_CUKUP";
      if (jejak.status === "DP") { k.orderDpSaatIniLedger++; if (o.paymentStatus === "LUNAS") k.orderDpSaatIniKonflikLunasCrm++; }
      if (jejak.pernahDp) k.orderPernahDp++;
      if (jejak.refund > 0) k.orderDenganRefund++;
      if (o.paymentStatus && o.paymentStatus !== jejak.status) selisihStatusBayar++;

      // status tersimpan
      const stKey = ["BELUM_BAYAR", "DP", "LUNAS"].includes(o.paymentStatus) ? o.paymentStatus : "LAIN";
      k.statusBayarTersimpan[stKey]++; ob.statusBayarTersimpan[stKey]++;

      // cakupan ledger — per bulan lead DAN per bulan order
      for (const c of [k.cakupanLedger, ob.cakupanLedger]) {
        c.orderEligible++;
        if (jejak.jumlahPembayaran > 0) { c.orderBerLedger++; if (jejak.status === "LUNAS") c.berLedgerCukup++; else c.berLedgerSebagian++; }
        else { c.orderTanpaLedger++; c.nilaiOrderTanpaLedger += rp(o.value); }
      }

      // lunasTerbuktiLedger: ledger valid menutup seluruh tagihan (apa pun status tersimpannya)
      if (jejak.status === "LUNAS") {
        for (const l of [k.lunasTerbuktiLedger, ob.lunasTerbuktiLedger]) { l.jumlah++; l.nilai += rp(o.value); }
        const bulanLunas = jejak.hariLunas.slice(0, 7);
        inc(k.menurutBulanLunasTerbuktiLedger, bulanLunas, 1);
        pbln(bulanLunas).lunasTerbuktiLedger.jumlah++;
      }

      // bukti pelunasan: partisi tepat-satu atas LUNAS tersimpan (+ konflik arah sebaliknya)
      if (bukti) {
        for (const b of [k.buktiPelunasan, ob.buktiPelunasan]) {
          if (bukti.kelas === "LUNAS_TERBUKTI_LEDGER") b.lunasTerbuktiLedger++;
          else if (bukti.kelas === "LUNAS_TANPA_LEDGER") b.lunasTanpaLedger++;
          else if (bukti.kelas === "KONFLIK_LUNAS_LEDGER_TIDAK_CUKUP") { b.konflikLunasTersimpanLedgerTidakCukup++; b.kekuranganRupiahKonflik += bukti.kekurangan; }
          else b.konflikBelumLunasTersimpanLedgerCukup++;
        }
      }

      // lunasMenurutCrm: status tersimpan LUNAS — konflik ledger TETAP termasuk
      const tl = tanggalLunasMenurutCrm(o, jejak);
      if (tl) {
        for (const l of [k.lunasMenurutCrm, ob.lunasMenurutCrm]) {
          l.jumlah++; l.nilai += rp(o.value);
          if (tl.sumber === "TERCATAT") {
            l.tanggalPasti++;
            if (tl.didukungLedger) l.didukungLedger++;
            if (tl.dikunciOwner) l.tanggalDikunciOwner++;
          } else if (tl.sumber === "TIDAK_PASTI") l.tanggalTidakPasti++;
          else l.tanpaTanggal++;
        }
        if (tl.sumber === "TERCATAT") {
          const bulanLunas = tl.hari.slice(0, 7);
          inc(k.menurutBulanLunasMenurutCrm, bulanLunas, 1);
          const pl = pbln(bulanLunas).lunasMenurutCrm;
          pl.jumlah++;
          if (tl.didukungLedger) pl.didukungLedger++;
          if (konflikLunas) pl.konflikLedger++;
          if (tl.dikunciOwner) pl.tanggalDikunciOwner++;
        }
      }
    }

    // uang (eligible + pending): per pembayaran → bulan pembayaran
    for (const p of kontribPerOrder.get(o.id) || []) {
      const bulanBayar = bulanWIB(p.createdAt);
      k.uangLedger += rp(p.amount);
      const kb = (k.menurutBulanPembayaran[bulanBayar] ||= { uang: 0, refund: 0 }); kb.uang += rp(p.amount);
      const pb = pbln(bulanBayar);
      pb.uangLedger += rp(p.amount); pb.jumlahPembayaran++;
      if (bulanBayar === info.bulanLead) pb.uangDariLeadBulanSama += rp(p.amount); else pb.uangDariLeadLama += rp(p.amount);
      if (o.status === "PENDING") pb.uangPadaOrderPending += rp(p.amount);
      (orderDibayarBulan.get(bulanBayar) || orderDibayarBulan.set(bulanBayar, new Set()).get(bulanBayar)).add(o.id);
    }
    for (const r of refundPerOrder.get(o.id) || []) {
      const bulanRefund = bulanWIB(r.approvedAt || r.date);
      k.refundDisetujui += rp(r.amount);
      const kb = (k.menurutBulanPembayaran[bulanRefund] ||= { uang: 0, refund: 0 }); kb.refund += rp(r.amount);
      pbln(bulanRefund).refundDisetujui += rp(r.amount);
    }
  }
  for (const k of Object.values(perBulanLead)) k.uangBersihLedger = k.uangLedger - k.refundDisetujui;
  for (const [m, b] of Object.entries(perBulanPembayaran)) { b.uangBersihLedger = b.uangLedger - b.refundDisetujui; b.orderDibayar = (orderDibayarBulan.get(m) || new Set()).size; }
  for (const [m, s] of customerUnikBulan) obln(m).customerUnik = s.size;

  // 4. Customer dengan order (satuan customer, bukan order)
  const sebaranOrderPerCustomer = { "0": 0, "1": 0, "2": 0, "3+": 0 };
  for (const [cid, daftar] of perCustomerEligible) {
    const k = lead(peta.get(cid).bulanLead);
    k.customerDenganOrder++;
    if (daftar.length >= 2) k.customerRepeat++;
    const urut = daftar.slice().sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
    if (urut[0].bulan === peta.get(cid).bulanLead) k.customerOrderPertamaBulanSama++;
    urut.forEach((x, i) => { if (i === 0) obln(x.bulan).orderPertamaCustomer++; else obln(x.bulan).orderBerulang++; });
    sebaranOrderPerCustomer[daftar.length >= 3 ? "3+" : String(daftar.length)]++;
  }
  sebaranOrderPerCustomer["0"] = jum(perBulanLead, (k) => k.leads) - perCustomerEligible.size;
  for (const cid of customerPending) {
    if (!perCustomerEligible.has(cid)) lead(peta.get(cid).bulanLead).customerHanyaOrderPending++;
  }

  // 5. Rekonsiliasi — dihitung dari data MENTAH secara independen, bukan dari akumulator di atas.
  const leadMentah = customers.filter((c) => !alasanBukanLead(c)).length;
  const dipetakan = new Map(orders.map((o) => [o.id, o]));
  const eligibleMentah = orders.filter((o) => {
    const i = peta.get(o.customerId);
    return i && !i.alasan && !o.penjualanKaryawanId && !ORDER_EXCLUDED_STATUS.includes(o.status);
  });
  const uangEligibleMentah = kontribusi.filter((k) => {
    const o = dipetakan.get(k.orderId); if (!o) return false;
    const i = peta.get(o.customerId);
    return i && !i.alasan && !o.penjualanKaryawanId && o.status !== "CANCELLED";
  }).reduce((s, k) => s + rp(k.amount), 0);
  const uangSemuaMentah = kontribusi.reduce((s, k) => s + rp(k.amount), 0);
  const uangOrderTakDikenal = kontribusi.filter((k) => !orderIds.has(k.orderId)).reduce((s, k) => s + rp(k.amount), 0);
  const customerEligibleMentah = new Set(eligibleMentah.map((o) => o.customerId)).size;
  const lunasCrmMentah = eligibleMentah.filter((o) => o.paymentStatus === "LUNAS");
  const lunasCrmPastiMentah = lunasCrmMentah.filter((o) => o.paidAt && new Date(o.paidAt).getTime() !== PAID_AT_BACKFILL_31_AGT.getTime()).length;
  const berLedgerMentah = eligibleMentah.filter((o) => (kontribPerOrder.get(o.id) || []).length > 0).length;
  // ledger menutup tagihan, dihitung ulang tanpa jejakPembayaran: Σ kontribusi − Σ refund disetujui (≥ 0) ≥ tagihan > 0
  const ledgerCukupMentah = eligibleMentah.filter((o) => {
    const T = rp(o.tagihan != null ? o.tagihan : o.value);
    const masuk = (kontribPerOrder.get(o.id) || []).reduce((s, x) => s + rp(x.amount), 0);
    const keluar = (refundPerOrder.get(o.id) || []).reduce((s, x) => s + rp(x.amount), 0);
    return T > 0 && Math.max(masuk - keluar, 0) >= T;
  }).length;
  const crm = (f) => jum(perBulanLead, (k) => f(k.lunasMenurutCrm));
  const bk = (f) => jum(perBulanLead, (k) => f(k.buktiPelunasan));
  const bkBulanOrder = (f) => jum(perBulanOrder, (b) => f(b.buktiPelunasan));
  const semuaBukti = (b) => b.lunasTerbuktiLedger + b.lunasTanpaLedger + b.konflikLunasTersimpanLedgerTidakCukup + b.konflikBelumLunasTersimpanLedgerCukup;

  const cek = [];
  const tambah = (id, a, b, ket) => cek.push({ id, ok: a === b, a, b, ket });
  // populasi dan order
  tambah("lead_kohort_vs_mentah", jum(perBulanLead, (k) => k.leads), leadMentah, "Σ lead semua kohort = lead sah di masukan");
  tambah("customer_dengan_order_vs_mentah", jum(perBulanLead, (k) => k.customerDenganOrder), customerEligibleMentah, "Σ customer dengan order = customer unik pada order eligible mentah");
  tambah("order_kohort_vs_mentah", jum(perBulanLead, (k) => k.orders), eligibleMentah.length, "Σ order kohort lead = order eligible di masukan");
  tambah("order_perBulanOrder_vs_kohort", jum(perBulanOrder, (b) => b.orders), jum(perBulanLead, (k) => k.orders), "Σ order per bulan order = Σ order per bulan lead");
  tambah("order_partisi_semua", bagian.eligible + bagian.pending + bagian.batal + bagian.luar, orders.length, "Setiap order masuk tepat satu bagian: eligible/pending/batal/luar kohort");
  tambah("order_pertama_berulang_lengkap", jum(perBulanOrder, (b) => b.orderPertamaCustomer + b.orderBerulang), jum(perBulanOrder, (b) => b.orders), "Setiap order eligible = order pertama customer atau order berulang");
  // rupiah booked dan uang
  tambah("nilai_order_kohort_vs_mentah", jum(perBulanLead, (k) => k.nilaiOrder), eligibleMentah.reduce((s, o) => s + rp(o.value), 0), "Σ nilai order (booked)");
  tambah("nilai_order_perBulanOrder_vs_kohort", jum(perBulanOrder, (b) => b.nilaiOrder), jum(perBulanLead, (k) => k.nilaiOrder), "Σ nilai order per bulan order");
  tambah("uang_kohort_vs_mentah", jum(perBulanLead, (k) => k.uangLedger), uangEligibleMentah, "Σ uang ledger kohort = kontribusi pada order bukan batal, customer dalam kohort");
  tambah("uang_perBulanPembayaran_vs_kohort", jum(perBulanPembayaran, (b) => b.uangLedger), jum(perBulanLead, (k) => k.uangLedger), "Σ uang per bulan pembayaran = Σ uang per bulan lead");
  tambah("uang_partisi_semua",
    jum(perBulanLead, (k) => k.uangLedger) + jum(perBulanLead, (k) => k.uangPadaOrderBatal) + luarKohort.uangLedger + luarKohort.uangPadaOrderBatal + uangOrderTakDikenal,
    uangSemuaMentah,
    "Σ seluruh kontribusi = kohort (eligible+pending) + order batal (kohort & luar) + luar kohort + order tak dikenal");
  // lunas menurut CRM
  tambah("lunas_crm_vs_mentah", crm((l) => l.jumlah), lunasCrmMentah.length, "Σ lunasMenurutCrm = order eligible dengan paymentStatus LUNAS");
  tambah("lunas_crm_terbagi_lengkap", crm((l) => l.tanggalPasti + l.tanggalTidakPasti + l.tanpaTanggal), crm((l) => l.jumlah), "Setiap LUNAS CRM tepat satu: tanggal pasti / tidak pasti / tanpa tanggal");
  tambah("lunas_crm_pasti_vs_mentah", crm((l) => l.tanggalPasti), lunasCrmPastiMentah, "Σ tanggalPasti = LUNAS dengan paidAt terisi bukan timestamp backfill");
  tambah("lunas_crm_tren_vs_kohort", jum(perBulanPembayaran, (b) => b.lunasMenurutCrm.jumlah), crm((l) => l.tanggalPasti), "Tren lunasMenurutCrm hanya memuat tanggalPasti (tanpa backfill); konflik ledger tetap ikut");
  // lunas terbukti ledger dan bukti
  tambah("lunas_terbukti_ledger_vs_mentah", jum(perBulanLead, (k) => k.lunasTerbuktiLedger.jumlah), ledgerCukupMentah, "Σ lunasTerbuktiLedger = order eligible yang ledger bersihnya ≥ tagihan (dihitung ulang dari mentah)");
  tambah("lunas_terbukti_ledger_tren_vs_kohort", jum(perBulanPembayaran, (b) => b.lunasTerbuktiLedger.jumlah), jum(perBulanLead, (k) => k.lunasTerbuktiLedger.jumlah), "Tren lunasTerbuktiLedger = total kohort");
  tambah("bukti_partisi_lunas_crm_vs_mentah", bk((b) => b.lunasTerbuktiLedger + b.lunasTanpaLedger + b.konflikLunasTersimpanLedgerTidakCukup), lunasCrmMentah.length, "Setiap LUNAS CRM jatuh ke tepat satu: terbukti ledger / tanpa ledger / konflik tidak cukup");
  tambah("bukti_terhubung_ke_lunas_ledger", jum(perBulanLead, (k) => k.lunasTerbuktiLedger.jumlah), bk((b) => b.lunasTerbuktiLedger + b.konflikBelumLunasTersimpanLedgerCukup), "lunasTerbuktiLedger = (LUNAS CRM terbukti) + (ledger cukup tetapi CRM belum LUNAS)");
  tambah("bukti_perBulanOrder_vs_kohort", bkBulanOrder(semuaBukti), bk(semuaBukti), "Bukti pelunasan per bulan order = per bulan lead (total)");
  // cakupan ledger
  tambah("cakupan_ledger_lengkap", jum(perBulanLead, (k) => k.cakupanLedger.orderBerLedger + k.cakupanLedger.orderTanpaLedger), eligibleMentah.length, "orderBerLedger + orderTanpaLedger = order eligible");
  tambah("cakupan_ledger_vs_mentah", jum(perBulanLead, (k) => k.cakupanLedger.orderBerLedger), berLedgerMentah, "Σ order eligible yang punya ≥ 1 pembayaran dihitung");
  tambah("cakupan_perBulanOrder_vs_kohort", jum(perBulanOrder, (b) => b.cakupanLedger.orderBerLedger), jum(perBulanLead, (k) => k.cakupanLedger.orderBerLedger), "Cakupan ledger per bulan order = per bulan lead (total)");

  const urutKunci = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    perBulanLead: urutKunci(perBulanLead),
    perBulanOrder: urutKunci(perBulanOrder),
    perBulanPembayaran: urutKunci(perBulanPembayaran),
    luarKohort,
    total: {
      leads: jum(perBulanLead, (k) => k.leads),
      customerDenganOrder: jum(perBulanLead, (k) => k.customerDenganOrder),
      customerHanyaOrderPending: jum(perBulanLead, (k) => k.customerHanyaOrderPending),
      customerMenurutJumlahOrder: sebaranOrderPerCustomer,
      orders: jum(perBulanLead, (k) => k.orders), nilaiOrder: jum(perBulanLead, (k) => k.nilaiOrder),
      orderPending: bagian.pending, orderBatal: bagian.batal,
      lunasMenurutCrm: {
        jumlah: crm((l) => l.jumlah), nilai: crm((l) => l.nilai), tanggalPasti: crm((l) => l.tanggalPasti),
        tanggalTidakPasti: crm((l) => l.tanggalTidakPasti), tanpaTanggal: crm((l) => l.tanpaTanggal),
        tanggalDikunciOwner: crm((l) => l.tanggalDikunciOwner), didukungLedger: crm((l) => l.didukungLedger),
      },
      lunasTerbuktiLedger: { jumlah: jum(perBulanLead, (k) => k.lunasTerbuktiLedger.jumlah), nilai: jum(perBulanLead, (k) => k.lunasTerbuktiLedger.nilai) },
      buktiPelunasan: {
        lunasTerbuktiLedger: bk((b) => b.lunasTerbuktiLedger), lunasTanpaLedger: bk((b) => b.lunasTanpaLedger),
        konflikLunasTersimpanLedgerTidakCukup: bk((b) => b.konflikLunasTersimpanLedgerTidakCukup),
        konflikBelumLunasTersimpanLedgerCukup: bk((b) => b.konflikBelumLunasTersimpanLedgerCukup),
        kekuranganRupiahKonflik: bk((b) => b.kekuranganRupiahKonflik),
      },
      orderPernahDp: jum(perBulanLead, (k) => k.orderPernahDp),
      orderDpSaatIniLedger: jum(perBulanLead, (k) => k.orderDpSaatIniLedger),
      orderDpSaatIniKonflikLunasCrm: jum(perBulanLead, (k) => k.orderDpSaatIniKonflikLunasCrm),
      uangLedger: jum(perBulanLead, (k) => k.uangLedger), refundDisetujui: jum(perBulanLead, (k) => k.refundDisetujui), uangBersihLedger: jum(perBulanLead, (k) => k.uangBersihLedger),
      orderBerLedger: jum(perBulanLead, (k) => k.cakupanLedger.orderBerLedger),
      pernahDitandaiProspekBerTanggal: jum(perBulanLead, (k) => k.pernahDitandaiProspek.berTanggal),
      pernahDitandaiProspekTanpaTanggal: jum(perBulanLead, (k) => k.pernahDitandaiProspek.tanpaTanggal),
      selisihStatusBayar,
    },
    bagianOrder: bagian,
    pengecualian: LEAD_EXCLUSION,
    rekonsiliasi: { ok: cek.every((c) => c.ok), cek },
  };
}
