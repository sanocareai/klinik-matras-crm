// Menandai order lama sebagai PENJUALAN KARYAWAN (services/penjualanKaryawan.js). DEFAULT = DRY-RUN (hanya membaca). Hanya mengisi Order.staffSellerId — TIDAK menulis Payment/jurnal/saldo.
//   docker compose exec -T backend node scripts/tandai-penjualan-karyawan.js --seller emon@klinikmatras.com --actor admin@klinikmatras.com --orders NEW-27092026-047,NEW-27092026-048,...
//   (tambahkan --apply untuk benar-benar menulis). Berhenti bila ada nomor order yang tidak ditemukan / dibatalkan / sudah punya penjual lain.
import { prisma } from "../src/db.js";
import { ubahPenjualKaryawan } from "../src/services/penjualanKaryawan.js";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
const apply = process.argv.includes("--apply");
const sellerEmail = arg("seller"), actorEmail = arg("actor"), daftar = (arg("orders") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (!sellerEmail || !actorEmail || daftar.length === 0) { console.error("Wajib: --seller <email> --actor <email admin> --orders NO1,NO2,..."); process.exit(1); }

try {
  const seller = await prisma.user.findUnique({ where: { email: sellerEmail }, select: { id: true, name: true, active: true } });
  const actor = await prisma.user.findUnique({ where: { email: actorEmail }, select: { id: true, name: true } });
  if (!seller || !seller.active) throw new Error(`Karyawan ${sellerEmail} tidak ditemukan/nonaktif`);
  if (!actor) throw new Error(`Admin ${actorEmail} tidak ditemukan`);
  const orders = await prisma.order.findMany({ where: { orderNumber: { in: daftar } }, select: { id: true, orderNumber: true, status: true, value: true, staffSellerId: true, customer: { select: { name: true } } } });
  const hilang = daftar.filter((n) => !orders.some((o) => o.orderNumber === n));
  if (hilang.length) throw new Error(`Order tidak ditemukan: ${hilang.join(", ")}`);
  const bermasalah = orders.filter((o) => o.status === "CANCELLED" || (o.staffSellerId && o.staffSellerId !== seller.id));
  if (bermasalah.length) throw new Error(`Order dibatalkan / sudah punya penjual lain: ${bermasalah.map((o) => o.orderNumber).join(", ")}`);
  const target = orders.filter((o) => o.staffSellerId !== seller.id);
  console.log(`${apply ? "TERAPKAN" : "DRY-RUN"}: penjual ${seller.name} · ${target.length} order akan ditandai (${orders.length - target.length} sudah ditandai) · total Rp${orders.reduce((s, o) => s + o.value, 0).toLocaleString("id-ID")}`);
  for (const o of orders) console.log(`  ${o.orderNumber}  Rp${o.value.toLocaleString("id-ID")}  pelanggan=${o.customer.name}  ${o.staffSellerId === seller.id ? "(sudah)" : "→ ditandai"}`);
  if (apply) {
    for (const o of target) await prisma.$transaction((tx) => ubahPenjualKaryawan(tx, { orderId: o.id, staffSellerId: seller.id, actorId: actor.id }));
    console.log("SELESAI");
  } else console.log("Tidak ada yang ditulis (tambahkan --apply).");
} catch (e) { console.error("GAGAL:", e.message); process.exitCode = 1; } finally { await prisma.$disconnect(); }
