// AUDIT paidAt KANONIK (30 Sep 2026) — daftar order yang paidAt-nya berbeda dari TANGGAL Payment terverifikasi yang membuat akumulasi mencapai tagihan.
//
//   docker compose exec backend node scripts/auditPaidAtKanonik.js                 # DRY-RUN (default): hanya menampilkan, tidak menulis
//   PAIDAT_BACKUP_OK=1 docker compose exec -e PAIDAT_BACKUP_OK=1 backend node scripts/auditPaidAtKanonik.js --apply
//
// Kelas: SAMA (tidak perlu koreksi) · BEDA_JAM (tanggal WIB sama — tidak dikoreksi) · BEDA_TANGGAL_BULAN_SAMA · PINDAH_BULAN (dasar komisi bergeser bulan)
//        · BELUM_CAPAI_TAGIHAN (Payment terverifikasi belum menutup tagihan — status LUNAS berasal dari klaim Sales, TIDAK disentuh).
// --apply memperbaiki HANYA BEDA_TANGGAL_BULAN_SAMA. PINDAH_BULAN hanya diterapkan bila PAIDAT_IZIN_PINDAH_BULAN=1 SETELAH daftarnya dilaporkan/disetujui.
// Tiap perubahan diaudit (paid_at_disinkron). Idempoten: jalankan ulang → tidak ada perubahan.

import { prisma } from "../src/db.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { tagihanOrder } from "../src/services/finance/tagihanOrder.js";
import { PILIH_TAGIHAN } from "../src/services/finance/tagihanOrder.js";

const APPLY = process.argv.includes("--apply");
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString();
const tgl = (d) => wib(d).slice(0, 10);
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID")}`;

async function kelaskan(db) {
  const orders = await db.order.findMany({
    where: { paidAt: { not: null }, status: { not: "CANCELLED" } },
    select: { ...PILIH_TAGIHAN, orderNumber: true, paidAt: true, customer: { select: { name: true } } },
  });
  const hasil = [];
  for (const o of orders) {
    const bayar = await db.payment.findMany({
      where: { orderId: o.id, cancelledAt: null, verifications: { some: {} } },
      select: { id: true, amount: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (bayar.length === 0) continue; // LUNAS tanpa Payment: bukan urusan skrip ini (daftar terpisah di laporan rekonsiliasi)
    const dasar = tagihanOrder(o, o.group ?? null);
    let kum = 0; let kanon = null;
    for (const p of bayar) { kum += p.amount; if (kum >= dasar) { kanon = p.createdAt; break; } }
    let kelas;
    if (!kanon) kelas = "BELUM_CAPAI_TAGIHAN";
    else if (o.paidAt.getTime() === kanon.getTime() || tgl(o.paidAt) === tgl(kanon)) kelas = o.paidAt.getTime() === kanon.getTime() ? "SAMA" : "BEDA_JAM";
    else kelas = tgl(o.paidAt).slice(0, 7) === tgl(kanon).slice(0, 7) ? "BEDA_TANGGAL_BULAN_SAMA" : "PINDAH_BULAN";
    hasil.push({ id: o.id, nomor: o.orderNumber, pelanggan: o.customer?.name, nilai: o.value, dibayar: kum, paidAt: o.paidAt, kanon, kelas });
  }
  return hasil;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN (tidak menulis apa pun)"}`);
  const semua = await kelaskan(prisma);
  const ringkas = {};
  for (const h of semua) ringkas[h.kelas] = (ringkas[h.kelas] ?? 0) + 1;
  console.log("Ringkasan kelas:", JSON.stringify(ringkas));
  const perlu = semua.filter((h) => ["BEDA_TANGGAL_BULAN_SAMA", "PINDAH_BULAN", "BELUM_CAPAI_TAGIHAN"].includes(h.kelas));
  for (const h of perlu) console.log(`  ${h.kelas.padEnd(24)} ${h.nomor.padEnd(18)} ${String(h.pelanggan ?? "").slice(0, 22).padEnd(22)} nilai ${rp(h.nilai).padStart(11)} dibayar ${rp(h.dibayar).padStart(11)}  paidAt ${tgl(h.paidAt)} → tanggal Payment ${h.kanon ? tgl(h.kanon) : "—"}`);
  const pindah = perlu.filter((h) => h.kelas === "PINDAH_BULAN");
  if (pindah.length) console.log(`\nPERHATIAN: ${pindah.length} order PINDAH BULAN (dasar komisi bergeser) — laporkan dulu sebelum apply.`);
  if (!APPLY) { console.log("\nDRY-RUN selesai."); return; }
  if (process.env.PAIDAT_BACKUP_OK !== "1") throw new Error("Menolak --apply: set PAIDAT_BACKUP_OK=1 SETELAH backup database dibuat.");
  const izinPindah = process.env.PAIDAT_IZIN_PINDAH_BULAN === "1";
  const kerjakan = perlu.filter((h) => h.kelas === "BEDA_TANGGAL_BULAN_SAMA" || (izinPindah && h.kelas === "PINDAH_BULAN"));
  const admin = await prisma.user.findFirst({ where: { role: "ADMIN", active: true }, orderBy: { createdAt: "asc" }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    for (const h of kerjakan) {
      const o = await tx.order.findUnique({ where: { id: h.id }, select: { paidAt: true } });
      if (!o || o.paidAt.getTime() !== h.paidAt.getTime()) continue; // berubah sejak dry-run — lewati
      await tx.order.update({ where: { id: h.id }, data: { paidAt: h.kanon } });
      await recordActivity(tx, { entityType: ENTITY_TYPES.ORDER, entityId: h.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: admin?.id ?? null, metadata: { aksi: "paid_at_disinkron", sebab: "audit_paidat_kanonik", dari: h.paidAt, ke: h.kanon, pindahBulan: h.kelas === "PINDAH_BULAN" } });
    }
  }, { timeout: 120_000 });
  console.log(`\nDITERAPKAN: ${kerjakan.length} order. Order lain tidak disentuh.`);
}

main().catch((e) => { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
