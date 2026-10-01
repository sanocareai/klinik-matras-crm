// ANTREAN "PERLU VERIFIKASI FINANCE" — satu fungsi baca server untuk layar-ringkasan dan Export Excel. BACA-SAJA.
//
// Antrean = tiga jenis pekerjaan Finance yang berbeda (dihitung terpisah, tidak saling tumpang tindih):
//   A. Payment menunggu      — Payment aktif yang belum diverifikasi (query & periode SAMA dengan layar: customerPaymentRead.ambilDaftarPembayaran, status belum_verifikasi).
//   B. Klaim Lunas berbukti  — OrderPaymentClaim SUBMITTED (menunggu verifikasi) / EVIDENCE_REQUESTED (bukti diminta) — daftarKlaimFinance (antrean layar KlaimLunasSales).
//   C. Klaim lama            — order berstatus Lunas tanpa Payment penuh ("Bukti belum lengkap") — daftarLunasBelumDicatat (daftar layar LunasBelumDicatat).
// ATURAN ANTI-HITUNG-GANDA:
//   • Satu ORDER hanya satu baris klaim: bila sebuah order punya klaim berbukti (B) dan juga muncul di klaim lama (C), yang dihitung hanya B.
//   • Bila sebuah order punya Payment menunggu (A) DAN klaim (B/C), nominal yang sama tidak dihitung dua kali pada TOTAL: nominal tumpang tindih = min(Payment menunggu order itu,
//     nominal klaim order itu) dikurangkan dari total, dan jumlah transaksi tumpang tindih dikurangkan (satu pekerjaan Finance, bukan dua).
import { ambilDaftarPembayaran } from "./customerPaymentRead.js";
import { daftarLunasBelumDicatat } from "./penerimaanOrder.js";
import { daftarKlaimFinance, STATUS as STATUS_KLAIM } from "./klaimLunas.js";
import { saringPembayaran } from "./saringPembayaran.js";

const BATAS = 50_001;
const rp = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * @param opts.fromStr,toStr   periode WIB (hanya untuk Payment menunggu — klaim tidak terikat periode, sama dengan layar)
 * @param opts.saringan        { q, metode, verif, alokasi, bukti, rekening } — saringan chip/pencarian layar (hanya Payment)
 * @param opts.ids             id Payment yang tampil di layar (klien lama); bila ada, daftar dibatasi ke id itu
 * @param opts.klaimIds        id order klaim lama yang tampil di layar (null = semua)
 * @param opts.denganKlaim     false → Payment saja
 */
export async function bangunAntreanVerifikasi(db, { fromStr, toStr, saringan = {}, ids = null, klaimIds = null, denganKlaim = true } = {}) {
  const mentah = await ambilDaftarPembayaran(db, { fromStr, toStr, status: "belum_verifikasi", ids }, { take: BATAS });
  const payments = saringPembayaran(mentah, saringan);

  let berbukti = []; let lama = [];
  if (denganKlaim) {
    const kb = await daftarKlaimFinance(db, { status: [STATUS_KLAIM.SUBMITTED, STATUS_KLAIM.EVIDENCE_REQUESTED], take: 5000 });
    berbukti = kb.items.filter((k) => !k.groupId && k.order);
    const idBerbukti = new Set(berbukti.map((k) => k.order.id));
    const d = await daftarLunasBelumDicatat(db);
    const pilih = klaimIds ? new Set(klaimIds) : null;
    lama = d.items.filter((i) => (!pilih || pilih.has(i.orderId)) && !idBerbukti.has(i.orderId));
  }

  // nominal Payment menunggu per order (untuk tumpang tindih)
  const menungguPerOrder = new Map();
  for (const p of payments) {
    const bagian = p.finAllocations?.length ? p.finAllocations.map((a) => [a.orderId, Number(a.amount)]) : [[p.orderId, Number(p.amount)]];
    for (const [oid, n] of bagian) menungguPerOrder.set(oid, (menungguPerOrder.get(oid) ?? 0) + n);
  }
  const klaimPerOrder = new Map(); // orderId → nominal klaim
  for (const k of berbukti) klaimPerOrder.set(k.order.id, k.amount || 0);
  for (const i of lama) klaimPerOrder.set(i.orderId, i.sisa || 0);
  let tumpangN = 0; let tumpangRp = 0;
  for (const [oid, nk] of klaimPerOrder) {
    const m = menungguPerOrder.get(oid);
    if (m > 0) { tumpangN += 1; tumpangRp += Math.min(m, nk); }
  }

  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const kSubmitted = berbukti.filter((k) => k.status === STATUS_KLAIM.SUBMITTED);
  const kDiminta = berbukti.filter((k) => k.status === STATUS_KLAIM.EVIDENCE_REQUESTED);
  const lamaDiminta = lama.filter((i) => i.buktiDiminta);
  const nominalPay = sum(payments, (p) => p.amount);
  const ringkasan = {
    paymentMenunggu: { jumlah: payments.length, nominal: rp(nominalPay) },
    klaimBerbuktiMenunggu: { jumlah: kSubmitted.length, nominal: rp(sum(kSubmitted, (k) => k.amount)) },
    klaimBerbuktiBuktiDiminta: { jumlah: kDiminta.length, nominal: rp(sum(kDiminta, (k) => k.amount)) },
    klaimLamaBuktiBelumLengkap: { jumlah: lama.length, nominal: rp(sum(lama, (i) => i.sisa)), dariItuBuktiDiminta: lamaDiminta.length },
    tumpangTindih: { jumlah: tumpangN, nominal: rp(tumpangRp) },
  };
  const klaimTotalN = kSubmitted.length + kDiminta.length + lama.length;
  const klaimTotalRp = ringkasan.klaimBerbuktiMenunggu.nominal + ringkasan.klaimBerbuktiBuktiDiminta.nominal + ringkasan.klaimLamaBuktiBelumLengkap.nominal;
  ringkasan.klaimSales = { jumlah: klaimTotalN, nominal: rp(klaimTotalRp) };
  ringkasan.buktiBelumLengkap = { jumlah: lama.length, nominal: ringkasan.klaimLamaBuktiBelumLengkap.nominal };
  ringkasan.buktiDiminta = { jumlah: kDiminta.length + lamaDiminta.length, nominal: rp(ringkasan.klaimBerbuktiBuktiDiminta.nominal + sum(lamaDiminta, (i) => i.sisa)) };
  ringkasan.totalAntrean = { jumlah: payments.length + klaimTotalN - tumpangN, nominal: rp(nominalPay + klaimTotalRp - tumpangRp), keterangan: "Payment menunggu + klaim Sales, dikurangi order yang muncul di keduanya (satu pekerjaan Finance, bukan dua)" };

  return { payments, klaimBerbukti: berbukti, klaimLama: lama, ringkasan };
}
