// AUDIT HITUNG GANDA & KONSISTENSI ANGKA FINANCE (Fase 1 — Kontrak Angka, 1 Okt 2026). BACA-SAJA: hanya SELECT/agregat, tidak menulis, tidak memperbaiki.
//
// Tiap pemeriksaan menjawab satu pertanyaan "apakah satu kejadian uang dihitung dua kali?" dan mengembalikan jumlah temuan + nilai + contoh (maks 5).
// Status: OK (0 temuan) atau PERLU_DITINJAU. Audit TIDAK mengubah data historis — perbaikan (bila ada) lewat jalur koreksi resmi dengan persetujuan.
import { STATUS_DIHITUNG } from "./journal.js";
import { KEY as KEY_ORDER } from "./posting/orderRevenue.js";

const rp = (n) => Math.round(Number(n) || 0);
const CONTOH = 5;

const hasil = (kunci, judul, pertanyaan, temuan, nilai, contoh, catatan = null) => ({
  kunci, judul, pertanyaan, jumlahTemuan: temuan, nilai: rp(nilai), contoh: contoh.slice(0, CONTOH),
  status: temuan === 0 ? "OK" : "PERLU_DITINJAU", statusLabel: temuan === 0 ? "Tidak ada hitung ganda" : "Perlu ditinjau", catatan,
});

export async function auditKonsistensi(db) {
  const akunKas = (await db.finAccount.findMany({ where: { OR: [{ systemKey: "KAS" }, { systemKey: "BANK" }] }, select: { id: true } })).map((a) => a.id);
  const out = [];

  // 1. Penerimaan pelanggan: satu Payment ↔ paling banyak satu jurnal penerimaan
  const ganda = await db.finJournalEntry.groupBy({ by: ["sourceId"], where: { source: "PEMBAYARAN_ORDER", status: { in: STATUS_DIHITUNG } }, _count: { _all: true }, having: { sourceId: { _count: { gt: 1 } } } });
  out.push(hasil("PAYMENT_JURNAL_GANDA", "Payment dijurnal lebih dari sekali", "Apakah satu Payment menambah kas dua kali?", ganda.length, 0, ganda.map((g) => ({ paymentId: g.sourceId, jumlahJurnal: g._count._all }))));

  // 2. Resi & alokasi Payment: Σ alokasi harus = nominal Payment (alokasi membagi satu uang ke beberapa order, bukan menambah uang)
  const alok = await db.finPaymentAllocation.groupBy({ by: ["paymentId"], _sum: { amount: true } });
  const payAlok = alok.length ? await db.payment.findMany({ where: { id: { in: alok.map((a) => a.paymentId) }, cancelledAt: null }, select: { id: true, amount: true } }) : [];
  const petaAlok = new Map(alok.map((a) => [a.paymentId, rp(a._sum.amount)]));
  const tidakSama = payAlok.filter((p) => petaAlok.get(p.id) !== rp(p.amount));
  out.push(hasil("ALOKASI_TIDAK_SAMA", "Alokasi Resi/order ≠ nominal Payment", "Apakah pembagian satu Payment ke beberapa order menambah atau mengurangi uang?", tidakSama.length,
    tidakSama.reduce((s, p) => s + Math.abs(rp(p.amount) - petaAlok.get(p.id)), 0), tidakSama.map((p) => ({ paymentId: p.id, nominal: rp(p.amount), totalAlokasi: petaAlok.get(p.id) })),
    `${payAlok.length} Payment beralokasi diperiksa`));

  // 3. Transfer antar bank: kedua sisi tidak boleh masuk Kas Masuk/Keluar (Arus Kas mengecualikan source TRANSFER_KAS)
  const transfer = akunKas.length ? await db.finJournalEntry.findMany({ where: { source: "TRANSFER_KAS", status: { in: STATUS_DIHITUNG } }, select: { id: true, entryNumber: true, lines: { select: { debit: true, credit: true, accountId: true } } } }) : [];
  const tak = transfer.filter((e) => {
    const d = e.lines.reduce((s, l) => s + Number(l.debit), 0); const k = e.lines.reduce((s, l) => s + Number(l.credit), 0);
    return Math.abs(d - k) > 0.005;
  });
  out.push(hasil("TRANSFER_TAK_SEIMBANG", "Transfer antar rekening tidak seimbang", "Apakah transfer antar bank mengubah total kas?", tak.length, 0, tak.map((e) => ({ jurnal: e.entryNumber })),
    `${transfer.length} jurnal transfer diperiksa; Arus Kas mengecualikan semuanya dari Kas Masuk/Keluar`));

  // 4. Uang muka operasional: pertanggungjawaban aktif tidak boleh melebihi uang muka (kalau lebih = biaya terhitung lebih besar dari uang yang keluar)
  const settle = await db.finOperationalAdvanceSettlement.groupBy({ by: ["advanceId"], where: { status: "ACTIVE" }, _sum: { amount: true } });
  const uangMuka = settle.length ? await db.finOperationalAdvance.findMany({ where: { id: { in: settle.map((s) => s.advanceId) } }, select: { id: true, amount: true } }) : [];
  const petaSettle = new Map(settle.map((s) => [s.advanceId, rp(s._sum.amount)]));
  const lebih = uangMuka.filter((a) => petaSettle.get(a.id) > rp(a.amount));
  out.push(hasil("UANG_MUKA_LEBIH", "Pertanggungjawaban + pengembalian melebihi uang muka", "Apakah uang muka dan pertanggungjawabannya dihitung dua kali?", lebih.length,
    lebih.reduce((s, a) => s + (petaSettle.get(a.id) - rp(a.amount)), 0), lebih.map((a) => ({ uangMukaId: a.id, nominal: rp(a.amount), terpakai: petaSettle.get(a.id) }))));

  // 5. Uang muka vs pengeluaran: biaya yang dipertanggungjawabkan dengan uang muka TIDAK boleh juga mengurangi kas lagi lewat jurnal PENGELUARAN
  const pj = await db.finOperationalAdvanceSettlement.findMany({ where: { status: "ACTIVE", type: "PERTANGGUNGJAWABAN", expenseId: { not: null } }, select: { expenseId: true, amount: true } });
  let kasGanda = [];
  if (pj.length && akunKas.length) {
    const ids = [...new Set(pj.map((s) => s.expenseId))];
    const js = await db.finJournalEntry.findMany({ where: { source: "PENGELUARAN", sourceId: { in: ids }, status: { in: STATUS_DIHITUNG } }, select: { sourceId: true, entryNumber: true, lines: { where: { accountId: { in: akunKas } }, select: { credit: true } } } });
    kasGanda = js.map((j) => ({ pengeluaranId: j.sourceId, jurnal: j.entryNumber, kasKeluar: rp(j.lines.reduce((s, l) => s + Number(l.credit), 0)) })).filter((x) => x.kasKeluar > 0);
  }
  out.push(hasil("UANG_MUKA_PENGELUARAN_GANDA", "Pengeluaran berpertanggungjawaban uang muka juga mengurangi kas", "Apakah biaya yang memakai uang muka mengeluarkan kas dua kali (saat uang muka diberikan dan saat biaya diposting)?", kasGanda.length,
    kasGanda.reduce((s, x) => s + x.kasKeluar, 0), kasGanda, `${pj.length} pertanggungjawaban aktif diperiksa`));

  // 6. Tagihan supplier vs pembayaran: Σ alokasi pembayaran (tidak dibatalkan) tidak boleh melebihi total tagihan
  const bayarSup = await db.finSupplierPaymentAllocation.groupBy({ by: ["billId"], where: { payment: { cancelledAt: null } }, _sum: { amount: true } });
  const tagihan = bayarSup.length ? await db.finSupplierBill.findMany({ where: { id: { in: bayarSup.map((b) => b.billId) } }, select: { id: true, billNumber: true, amount: true } }) : [];
  const petaBayar = new Map(bayarSup.map((b) => [b.billId, rp(b._sum.amount)]));
  const bayarLebih = tagihan.filter((t) => petaBayar.get(t.id) > rp(t.amount));
  out.push(hasil("SUPPLIER_BAYAR_LEBIH", "Pembayaran supplier melebihi tagihan", "Apakah pembayaran supplier dihitung sebagai pengeluaran baru di atas tagihannya?", bayarLebih.length,
    bayarLebih.reduce((s, t) => s + (petaBayar.get(t.id) - rp(t.amount)), 0), bayarLebih.map((t) => ({ tagihan: t.billNumber, nominal: rp(t.amount), terbayar: petaBayar.get(t.id) })), `${tagihan.length} tagihan berpembayaran diperiksa`));

  // 7. Refund: total refund aktif atas satu order tidak boleh melebihi uang terverifikasi yang pernah masuk untuk order itu
  const ref = await db.finRefund.groupBy({ by: ["orderId"], where: { status: { notIn: ["DITOLAK", "DIBATALKAN"] } }, _sum: { amount: true } });
  let refLebih = [];
  if (ref.length) {
    const ids = ref.map((r) => r.orderId);
    const bayar = await db.payment.findMany({ where: { cancelledAt: null, verifications: { some: {} }, OR: [{ orderId: { in: ids } }, { finAllocations: { some: { orderId: { in: ids } } } }] }, select: { orderId: true, amount: true, finAllocations: { select: { orderId: true, amount: true } } } });
    const masuk = new Map();
    for (const p of bayar) {
      const bagian = p.finAllocations.length ? p.finAllocations.map((a) => [a.orderId, rp(a.amount)]) : [[p.orderId, rp(p.amount)]];
      for (const [oid, n] of bagian) masuk.set(oid, (masuk.get(oid) ?? 0) + n);
    }
    refLebih = ref.filter((r) => rp(r._sum.amount) > (masuk.get(r.orderId) ?? 0)).map((r) => ({ orderId: r.orderId, refund: rp(r._sum.amount), uangMasuk: masuk.get(r.orderId) ?? 0 }));
  }
  out.push(hasil("REFUND_LEBIH", "Refund melebihi uang yang pernah masuk", "Apakah refund mengembalikan lebih dari uang terverifikasi order itu?", refLebih.length, refLebih.reduce((s, r) => s + (r.refund - r.uangMasuk), 0), refLebih,
    "Refund atas order yang dibayar sebelum saldo awal tetap sah bila Payment-nya terverifikasi"));

  // 8. Jurnal penerimaan yatim: jurnal PEMBAYARAN_ORDER aktif yang Payment-nya tidak ada / dibatalkan (kas bertambah untuk uang yang tak lagi sah)
  const jr = await db.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", status: "POSTED" }, select: { sourceId: true, entryNumber: true, idempotencyKey: true } });
  const idPay = jr.map((j) => j.sourceId).filter(Boolean);
  const pay = idPay.length ? await db.payment.findMany({ where: { id: { in: idPay } }, select: { id: true, cancelledAt: true } }) : [];
  const petaPay = new Map(pay.map((p) => [p.id, p]));
  const yatim = jr.filter((j) => j.idempotencyKey === KEY_ORDER.payment(j.sourceId) && (!petaPay.has(j.sourceId) || petaPay.get(j.sourceId).cancelledAt));
  out.push(hasil("JURNAL_PENERIMAAN_YATIM", "Jurnal penerimaan untuk Payment yang dibatalkan", "Apakah ada kas masuk di buku untuk uang yang sudah dibatalkan?", yatim.length, 0, yatim.map((j) => ({ jurnal: j.entryNumber, paymentId: j.sourceId })),
    `${jr.length} jurnal penerimaan aktif diperiksa`));

  return {
    dibuatPada: new Date().toISOString(), bacaSaja: true,
    ringkasan: { diperiksa: out.length, bersih: out.filter((x) => x.status === "OK").length, perluDitinjau: out.filter((x) => x.status !== "OK").length },
    pemeriksaan: out,
  };
}
