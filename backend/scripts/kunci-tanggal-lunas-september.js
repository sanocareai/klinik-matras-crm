// Mengunci tanggal lunas (paidAt) order September yang dihitung lunas atas KEPUTUSAN OWNER (2 Okt 2026): target Sales Kiki/Ervina 120 jt untuk insentif, berlaku September saja.
// Memakai services/pengecualianPaidAt.js — hasilnya baris riwayat per order (pembuat = Owner, alasan, waktu). TIDAK menyentuh Payment, jurnal, saldo, atau status bayar.
// DEFAULT = DRY-RUN (hanya membaca). Daftar order EKSPLISIT (hasil audit 2 Okt 2026), bukan pemilihan dinamis; berhenti bila ada order yang bukan LUNAS / paidAt-nya bukan September (WIB).
//   docker compose exec -T backend node scripts/kunci-tanggal-lunas-september.js [--apply] [--actor <email owner>] [--grup-a NO1,NO2] [--grup-b NO3,NO4]
// Grup A = order yang uangnya terverifikasi tetapi bergeser ke Oktober (paidAt dipulihkan ke 30 Sep). Grup B = order lunas September yang uang customer belum terverifikasi penuh (mis. Hotel Discovery).
import { prisma } from "../src/db.js";
import { buatPengecualian, pengecualianAktif } from "../src/services/pengecualianPaidAt.js";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const apply = process.argv.includes("--apply");
const aktorEmail = arg("actor") || "admin@klinikmatras.com";
const daftar = (v, bawaan) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : bawaan);
const GRUP_A = daftar(arg("grup-a"), ["RES-27092026-161", "RES-27092026-163", "RES-28092026-173"]);
const GRUP_B = daftar(arg("grup-b"), [
  "NEW-19092026-035", "RES-28092026-174", "RES-28092026-175", "NEW-25092026-042",
  "RES-19082026-083", "RES-19082026-084", "RES-19082026-085", "RES-19082026-086", "RES-19082026-087", "RES-19082026-088", "RES-19082026-089", "RES-19082026-090", "RES-19082026-091", "RES-19082026-092",
]);
const ALASAN = {
  A: "Keputusan Owner 2 Okt 2026: order dihitung lunas di SEPTEMBER agar target Sales 120 jt (insentif) tercapai; uang masuk 1 Okt sesuai bukti transfer, tanggal lunas dikunci 30 Sep. Berlaku September saja.",
  B: "Keputusan Owner 2 Okt 2026: keringanan target Sales September (insentif 120 jt) — order dihitung lunas di SEPTEMBER walau customer belum membayar penuh. Berlaku September saja.",
};
const bulanWib = (d) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 7);
const rp = (n) => `Rp${n.toLocaleString("id-ID")}`;

try {
  const aktor = await prisma.user.findUnique({ where: { email: aktorEmail }, select: { id: true, name: true } });
  if (!aktor) throw new Error(`Akun ${aktorEmail} tidak ditemukan`);
  const semuaNo = [...GRUP_A, ...GRUP_B];
  if (new Set(semuaNo).size !== semuaNo.length) throw new Error("Ada nomor order ganda di daftar");
  const orders = await prisma.order.findMany({ where: { orderNumber: { in: semuaNo } }, select: { id: true, orderNumber: true, value: true, status: true, paymentStatus: true, paidAt: true, customer: { select: { name: true } } } });
  const hilang = semuaNo.filter((n) => !orders.some((o) => o.orderNumber === n));
  if (hilang.length) throw new Error(`Order tidak ditemukan: ${hilang.join(", ")}`);
  const salah = orders.filter((o) => o.status === "CANCELLED" || o.paymentStatus !== "LUNAS" || !o.paidAt || bulanWib(o.paidAt) !== "2026-09");
  if (salah.length) throw new Error(`Bukan LUNAS di September (WIB) / dibatalkan: ${salah.map((o) => `${o.orderNumber}(${o.paymentStatus}, ${o.paidAt ? bulanWib(o.paidAt) : "tanpa tgl"})`).join(", ")}`);

  const baris = [];
  for (const o of orders) {
    const sudah = await pengecualianAktif(prisma, o.id);
    baris.push({ o, grup: GRUP_A.includes(o.orderNumber) ? "A" : "B", sudah: !!sudah });
  }
  const target = baris.filter((b) => !b.sudah);
  console.log(`${apply ? "TERAPKAN" : "DRY-RUN"}: ${target.length} order akan dikunci (${baris.length - target.length} sudah punya pengecualian aktif) · pelaku ${aktor.name} · total ${rp(target.reduce((s, b) => s + b.o.value, 0))}`);
  for (const b of baris.sort((x, y) => x.grup.localeCompare(y.grup) || x.o.orderNumber.localeCompare(y.o.orderNumber))) {
    console.log(`  [${b.grup}] ${b.o.orderNumber}  ${rp(b.o.value)}  ${b.o.customer.name}  lunas ${b.o.paidAt.toISOString()}  ${b.sudah ? "(sudah)" : "→ dikunci"}`);
  }
  if (!apply) { console.log("Tidak ada yang ditulis (tambahkan --apply)."); } else {
    await prisma.$transaction(async (tx) => { for (const b of target) await buatPengecualian(tx, { orderId: b.o.id, alasan: ALASAN[b.grup], actorId: aktor.id }); });
    console.log("SELESAI");
  }
} catch (e) { console.error("GAGAL:", e.message); process.exitCode = 1; } finally { await prisma.$disconnect(); }
