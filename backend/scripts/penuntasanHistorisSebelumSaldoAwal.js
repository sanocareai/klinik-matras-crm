// PENUNTASAN PEMBAYARAN HISTORIS SEBELUM SALDO AWAL (keputusan Owner 29 Sep 2026; cutoff 18 September 2026 WIB) — lihat
// backend/src/services/finance/pembayaranHistoris.js untuk aturan lengkap.
//
//   docker compose exec backend node scripts/penuntasanHistorisSebelumSaldoAwal.js                 # DRY-RUN (default): tidak menulis apa pun
//   HISTORIS_BACKUP_OK=1 docker compose exec -e HISTORIS_BACKUP_OK=1 backend node scripts/penuntasanHistorisSebelumSaldoAwal.js --apply
//
// Isi:
//  A. Koreksi WILSON (order NEW-21082026-014, Rp1.900.000, 3 Sep 2026, PT Sano, JV-03092026-747) — tepat satu Payment + satu jurnal.
//  B. Koreksi KEM (Rp1.750.000, 15 Sep 2026, KEM - Sano Bank, diverifikasi 21 Sep) — tepat satu Payment. Ganda / sudah dicocokkan / periode SELESAI → dilaporkan, TIDAK dipaksa.
//  B2. Koreksi ALDHO G (RES-11092026-059, QRIS Rp3.978.030, tercatat 18 Sep, KEM - Sano Bank) — dikonfirmasi Owner: uang masuk sebelum 18 Sep (konfirmasiOwner).
//  C. Payment terverifikasi bertanggal sebelum cutoff yang belum berjurnal: C1 (audit saja) / C2 (Dr Laba Ditahan, Cr Piutang) / C3 (Dr Laba Ditahan, Cr Uang Muka);
//     C4 = exception (tidak diposting). Kas/Bank TIDAK PERNAH disentuh oleh C1/C2/C3.
// Semua penulisan dalam SATU transaksi + pemeriksaan pasca-tulis DI DALAM transaksi: kalau ada yang meleset, seluruhnya di-rollback.
// Idempoten: jalankan ulang → delta nol (Payment lama sudah diganti / jurnal non-kas berkunci PEMBAYARAN_ORDER:<paymentId> / audit dedupe).

import fs from "node:fs";
import { prisma } from "../src/db.js";
import { koreksiPembayaranHistoris, tuntaskanPembayaranHistoris, daftarKlasifikasiHistoris, LABEL_HISTORIS } from "../src/services/finance/pembayaranHistoris.js";
import { tanggalWIB } from "../src/services/finance/cutoff.js";

const APPLY = process.argv.includes("--apply");
const ALASAN = `${LABEL_HISTORIS}. Keputusan Owner 29 Sep 2026 (cutoff 18 Sep 2026 WIB); dasar: laporan Notion, data order/payment, bukti internal, konfirmasi CFO Kemal. Bukan cocok rekening koran.`;
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

const TARGET = [
  { nama: "WILSON", nomor: "NEW-21082026-014", amount: 1_900_000, tanggal: "2026-09-03", rekening: "PT Sano", jurnal: "JV-03092026-747", wajib: true },
  { nama: "KEM", nomor: null, amount: 1_750_000, tanggal: "2026-09-15", rekening: "KEM - Sano Bank", verifikasiWIB: "2026-09-21", wajib: false },
  // Aldho G: Owner mengonfirmasi uangnya masuk SEBELUM 18 Sep walau tercatat bertanggal 18 Sep (hari cutoff) — konfirmasiOwner mengizinkan tanggal <= cutoff.
  { nama: "ALDHO G", nomor: "RES-11092026-059", amount: 3_978_030, tanggal: "2026-09-18", rekening: "KEM - Sano Bank", wajib: false, konfirmasiOwner: true },
];

async function snapshot(db) {
  const q = (sql, ...a) => db.$queryRawUnsafe(sql, ...a);
  const [rek, akun, cnt, hash, tidakSeimbang, snapRekon, flags] = await Promise.all([
    q(`select c.name, coalesce(sum(l.debit - l.credit), 0)::text saldo from fin_cash_accounts c left join fin_journal_lines l on l.cash_account_id = c.id and l.account_id = c.account_id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED','REVERSED') group by c.name order by c.name`),
    q(`select a.code, coalesce(sum(l.debit - l.credit), 0)::text saldo from fin_accounts a left join fin_journal_lines l on l.account_id = a.id left join fin_journal_entries e on e.id = l.entry_id and e.status in ('POSTED','REVERSED') where a.code in ('3-3100','1-1300','2-1200') group by a.code order by a.code`),
    q(`select (select count(*) from payments)::int payments, (select count(*) from payments where cancelled_at is null)::int payments_aktif, (select count(*) from fin_payment_allocations)::int alokasi, (select count(*) from fin_journal_entries)::int jurnal, (select count(*) from fin_journal_lines)::int baris_jurnal, (select count(*) from "Order")::int orders`),
    q(`select 'payments' t, md5(coalesce(string_agg(x.id::text || x.amount::text || coalesce(x.cancelled_at::text,''), '|' order by x.id), '')) h from payments x
       union all select 'alokasi', md5(coalesce(string_agg(x.id::text || x.amount::text, '|' order by x.id), '')) from fin_payment_allocations x
       union all select 'jurnal', md5(coalesce(string_agg(x.id::text || x.status::text, '|' order by x.id), '')) from fin_journal_entries x
       union all select 'baris_jurnal', md5(coalesce(string_agg(x.id::text || x.debit::text || x.credit::text, '|' order by x.id), '')) from fin_journal_lines x
       union all select 'orders', md5(coalesce(string_agg(x.id::text || x.value::text || x."paymentStatus"::text || coalesce(x.paid_at::text,''), '|' order by x.id), '')) from "Order" x`),
    q(`select count(*)::int n from (select entry_id from fin_journal_lines group by entry_id having sum(debit) <> sum(credit)) x`),
    q(`select count(*)::int n, md5(coalesce(string_agg(x.id::text, '|' order by x.id), '')) h, (select string_agg(status::text || ':' || c::text, ',') from (select status, count(*) c from fin_bank_statements group by status order by status) s) status_rekon from fin_recon_snapshots x`),
    q(`select md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.key), '')) h from v2_feature_flags x`),
  ]);
  return {
    rekening: Object.fromEntries(rek.map((r) => [r.name, Number(r.saldo)])), akun: Object.fromEntries(akun.map((r) => [r.code, Number(r.saldo)])), jumlah: cnt[0],
    hash: Object.fromEntries(hash.map((r) => [r.t, r.h])), jurnalTidakSeimbang: tidakSeimbang[0].n, snapshotRekon: snapRekon[0], flagV2: flags[0].h,
  };
}

async function cariTarget(db) {
  const hasil = [];
  for (const t of TARGET) {
    const ps = await db.payment.findMany({
      where: {
        cancelledAt: null, amount: t.amount, replacesPaymentId: null,
        ...(t.nomor && { order: { orderNumber: t.nomor } }),
        cashAccount: { name: t.rekening }, verifications: { some: {} },
      },
      include: { order: { select: { orderNumber: true, customer: { select: { name: true } } } }, cashAccount: { select: { name: true } }, verifications: { select: { createdAt: true } } },
    });
    const cocok = [];
    for (const p of ps) {
      if (tanggalWIB(p.createdAt) !== t.tanggal) continue;
      if (t.verifikasiWIB && !p.verifications.some((v) => tanggalWIB(v.createdAt) === t.verifikasiWIB)) continue;
      const js = await db.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: p.id, status: "POSTED" }, select: { entryNumber: true, lines: { select: { debit: true, cashAccountId: true } } } });
      if (!js.some((e) => e.lines.some((l) => l.cashAccountId && Number(l.debit) > 0))) continue; // harus memiliki jurnal Dr Bank
      if (t.jurnal && !js.some((e) => e.entryNumber === t.jurnal)) continue;
      cocok.push({ p, jurnal: js.map((e) => e.entryNumber) });
    }
    // Sudah pernah dikoreksi (Payment lama dibatalkan + punya versi pengganti dengan kriteria yang sama) → jalankan ulang tidak dianggap galat.
    const lamaDiganti = await db.payment.findMany({
      where: { amount: t.amount, cashAccount: { name: t.rekening }, replacedBy: { isNot: null }, ...(t.nomor && { order: { orderNumber: t.nomor } }) },
      select: { createdAt: true },
    });
    hasil.push({ ...t, cocok, sudahDikoreksi: lamaDiganti.filter((p) => tanggalWIB(p.createdAt) === t.tanggal).length });
  }
  return hasil;
}

function tampil(judul, s) {
  console.log(`\n── ${judul} ──`);
  console.log("  saldo per rekening:", Object.entries(s.rekening).map(([k, v]) => `${k}=${rp(v)}`).join(" | "));
  console.log("  3-3100 Laba Ditahan:", rp(s.akun["3-3100"] ?? 0), "| 1-1300 Piutang:", rp(s.akun["1-1300"] ?? 0), "| 2-1200 Uang Muka:", rp(s.akun["2-1200"] ?? 0));
  console.log("  jumlah:", JSON.stringify(s.jumlah), "| jurnal tidak seimbang:", s.jurnalTidakSeimbang);
  console.log("  snapshot rekonsiliasi:", JSON.stringify(s.snapshotRekon));
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis, satu transaksi)" : "DRY-RUN (tidak menulis apa pun)"}`);
  const sebelum = await snapshot(prisma);
  tampil("KONDISI SEBELUM", sebelum);

  const daftar = await daftarKlasifikasiHistoris(prisma);
  console.log(`\n── KLASIFIKASI (cutoff ${daftar.cutoff}) — Payment terverifikasi bertanggal sebelum cutoff ──`);
  for (const [k, v] of Object.entries(daftar.ringkas)) console.log(`  ${k.padEnd(11)} ${String(v.jumlah).padStart(3)} payment  ${rp(v.nilai)}`);
  const c4 = daftar.items.filter((i) => i.kelas === "C4");
  if (c4.length) { console.log("  EXCEPTION C4:"); for (const i of c4) console.log(`   - ${i.orderNumber} ${rp(i.amount)} ${i.tanggal}: [${i.kode}] ${i.alasan}`); }

  const target = await cariTarget(prisma);
  const adaBlokir = [];
  console.log("\n── TARGET KOREKSI ──");
  for (const t of target) {
    if (t.cocok.length === 1) console.log(`  ${t.nama}: 1 Payment cocok → ${t.cocok[0].p.order.orderNumber} (${t.cocok[0].p.order.customer?.name}) ${rp(t.cocok[0].p.amount)} ${t.tanggal} ${t.rekening}, jurnal ${t.cocok[0].jurnal.join(",")}`);
    else if (t.cocok.length === 0 && t.sudahDikoreksi === 1) console.log(`  ${t.nama}: sudah dikoreksi sebelumnya (Payment lama diganti versi pengganti) → tidak ada yang dikerjakan`);
    else { console.log(`  ${t.nama}: ${t.cocok.length} Payment cocok (${t.sudahDikoreksi} sudah dikoreksi) → TIDAK diproses (harus tepat satu)`); adaBlokir.push(`${t.nama}: ${t.cocok.length} target`); }
  }
  const wilson = target.find((t) => t.nama === "WILSON");
  if (!(wilson.cocok.length === 1 || (wilson.cocok.length === 0 && wilson.sudahDikoreksi === 1))) throw new Error("Target Wilson harus tepat satu Payment dan satu jurnal (atau sudah dikoreksi tepat satu kali) — berhenti.");

  const ids = new Set(target.filter((t) => t.cocok.length === 1).map((t) => t.cocok[0].p.id));
  const batch = daftar.items.filter((i) => ["C1", "C2", "C3"].includes(i.kelas));
  const bankLain = daftar.items.filter((i) => i.kelas === "BANK_GANDA" && !ids.has(i.paymentId));
  if (bankLain.length) console.log(`  PERHATIAN: ${bankLain.length} Payment BANK_GANDA lain di luar target — TIDAK disentuh: ${bankLain.map((i) => i.orderNumber).join(", ")}`);
  console.log(`\n── RENCANA ──\n  koreksi Bank: ${ids.size} | batch tanpa Bank: ${batch.length} (C1 ${batch.filter((i) => i.kelas === "C1").length}, C2 ${batch.filter((i) => i.kelas === "C2").length}, C3 ${batch.filter((i) => i.kelas === "C3").length}) | exception C4: ${c4.length}`);
  const jurnalNonKas = batch.filter((i) => i.lawan);
  console.log(`  jurnal non-kas baru dari batch: ${jurnalNonKas.length} (${rp(jurnalNonKas.reduce((s, i) => s + i.amount, 0))}); Kas/Bank tidak disentuh batch.`);
  const nilaiBank = target.filter((t) => t.cocok.length === 1).reduce((s, t) => s + t.amount, 0);
  console.log(`  dampak Bank (hanya koreksi target): -${rp(nilaiBank)}`);
  console.log(`  revenue baru: 0 | Payment baru: ${ids.size} (versi pengganti) | Payment ganda: 0`);
  if (adaBlokir.length) console.log("  BLOCKER:", adaBlokir.join("; "));

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = fs.existsSync("/app/data") ? "/app/data" : ".";
  fs.writeFileSync(`${dir}/historis-${stamp}-sebelum.json`, JSON.stringify({ sebelum, klasifikasi: daftar, rencana: { koreksiBank: [...ids], batch: batch.length } }, null, 2));

  if (!APPLY) { console.log(`\nDRY-RUN selesai. Snapshot tersimpan di ${dir}/historis-${stamp}-sebelum.json. Backup dulu, lalu jalankan dengan HISTORIS_BACKUP_OK=1 … --apply`); return; }
  if (process.env.HISTORIS_BACKUP_OK !== "1") throw new Error("Menolak --apply: set HISTORIS_BACKUP_OK=1 SETELAH backup database dibuat dan diverifikasi.");

  const aktor = await prisma.user.findFirst({ where: { email: "gilang@klinikmatras.com", active: true }, select: { id: true, name: true } });
  if (!aktor) throw new Error("Akun Owner (gilang@klinikmatras.com) tidak ditemukan untuk atribusi");
  console.log(`\n>>> APPLY sebagai ${aktor.name} …`);

  const hasil = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "HISTORIS_SEBELUM_SALDO_AWAL");
    const out = { koreksi: [], batch: [], dilewati: [] };
    for (const t of target) {
      if (t.cocok.length !== 1) continue;
      // SAVEPOINT per target: kegagalan target non-wajib (KEM) membatalkan HANYA penulisan targetnya sendiri (mis. exception ditemukan setelah pembalikan),
      // tidak pernah meninggalkan setengah koreksi. Target wajib (Wilson) yang gagal = rollback seluruh transaksi.
      await tx.$executeRawUnsafe("SAVEPOINT s_target");
      try {
        out.koreksi.push({ nama: t.nama, ...(await koreksiPembayaranHistoris(tx, { paymentId: t.cocok[0].p.id, userId: aktor.id, alasan: ALASAN, konfirmasiOwner: !!t.konfirmasiOwner })) });
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT s_target");
      } catch (e) {
        if (t.wajib) throw e;
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT s_target");
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT s_target");
        // Blokir yang sah (sudah dicocokkan / periode SELESAI / ganda) dilaporkan sebagai blocker transaksi itu, TIDAK di-bypass.
        out.dilewati.push({ nama: t.nama, kode: e.code ?? "ERROR", alasan: e.message });
      }
    }
    // Batch dihitung ulang DI DALAM transaksi (setelah kunci) — klasifikasi ulang menangkap perubahan akibat koreksi di atas.
    const segar = await daftarKlasifikasiHistoris(tx);
    for (const i of segar.items.filter((x) => ["C1", "C2", "C3"].includes(x.kelas))) {
      out.batch.push({ orderNumber: i.orderNumber, kelas: i.kelas, ...(await tuntaskanPembayaranHistoris(tx, { paymentId: i.paymentId, userId: aktor.id, alasan: ALASAN })) });
    }

    // Pemeriksaan pasca-tulis (di dalam transaksi; kegagalan = rollback total).
    const sesudah = await snapshot(tx);
    const dRek = Object.fromEntries(Object.keys(sebelum.rekening).map((k) => [k, +(sesudah.rekening[k] - sebelum.rekening[k]).toFixed(2)]));
    const harap = { "PT Sano": 0, "KEM - Sano Bank": 0 };
    for (const k of out.koreksi) { const t = target.find((x) => x.nama === k.nama); harap[t.rekening] -= t.amount; }
    for (const [k, v] of Object.entries(dRek)) {
      const h = harap[k] ?? 0;
      if (Math.abs(v - h) > 0.005) throw new Error(`Saldo ${k} berubah ${rp(v)} (diharapkan ${rp(h)}) — rollback`);
    }
    if (sesudah.jurnalTidakSeimbang !== 0) throw new Error("Ada jurnal tidak seimbang — rollback");
    if (JSON.stringify(sesudah.snapshotRekon) !== JSON.stringify(sebelum.snapshotRekon)) throw new Error("Snapshot rekonsiliasi berubah — rollback");
    if (sesudah.flagV2 !== sebelum.flagV2) throw new Error("Flag Production V2 berubah — rollback");
    if (sesudah.jumlah.payments - sebelum.jumlah.payments !== out.koreksi.length) throw new Error("Jumlah Payment bertambah tidak sesuai jumlah koreksi (Payment ganda?) — rollback");
    if (sesudah.jumlah.orders !== sebelum.jumlah.orders) throw new Error("Jumlah order berubah — rollback");
    return { out, sesudah, dRek };
  }, { timeout: 180_000, maxWait: 30_000 });

  fs.writeFileSync(`${dir}/historis-${stamp}-sesudah.json`, JSON.stringify(hasil, null, 2));
  tampil("KONDISI SESUDAH", hasil.sesudah);
  console.log("\n  Δ saldo rekening:", JSON.stringify(hasil.dRek));
  console.log("  koreksi:", JSON.stringify(hasil.out.koreksi.map((k) => ({ nama: k.nama, lama: k.lamaId, baru: k.baruId, klasifikasi: k.klasifikasi, dibalik: k.jurnalDibalik, pengganti: k.jurnalPengganti, statusOrder: k.statusOrder }))));
  if (hasil.out.dilewati.length) console.log("  DILEWATI:", JSON.stringify(hasil.out.dilewati));
  const per = (k) => hasil.out.batch.filter((b) => b.kelas === k);
  console.log(`  batch: C1 ${per("C1").length} (audit saja) | C2 ${per("C2").length} | C3 ${per("C3").length} | jurnal non-kas baru ${hasil.out.batch.filter((b) => b.entryNumber).length}`);

  // Jalankan ulang = delta nol.
  const dua = await snapshot(prisma);
  const ulang = await prisma.$transaction(async (tx) => {
    const segar = await daftarKlasifikasiHistoris(tx);
    let jurnalBaru = 0;
    for (const i of segar.items.filter((x) => ["C1", "C2", "C3"].includes(x.kelas))) {
      const before = await tx.finJournalEntry.count();
      await tuntaskanPembayaranHistoris(tx, { paymentId: i.paymentId, userId: aktor.id, alasan: ALASAN });
      jurnalBaru += (await tx.finJournalEntry.count()) - before;
    }
    return { jurnalBaru };
  });
  const tiga = await snapshot(prisma);
  const sama = JSON.stringify(dua.hash) === JSON.stringify(tiga.hash) || (dua.jumlah.jurnal === tiga.jumlah.jurnal && dua.jumlah.payments === tiga.jumlah.payments);
  console.log(`  jalankan ulang: jurnal baru ${ulang.jurnalBaru}, Payment/jurnal ${sama ? "delta nol" : "BERUBAH!"}`);
  if (!sama || ulang.jurnalBaru !== 0) process.exitCode = 1;
}

main().catch((e) => { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; }).finally(async () => { await prisma.$disconnect(); });
