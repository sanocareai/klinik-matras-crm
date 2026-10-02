// Merapikan tanda rekening yang SALAH pada baris jurnal lama (koreksi 2 Okt 2026): baris beban biaya admin bank (6-1700) yang ditandai cashAccountId membuat saldo per rekening
// (Kas & Bank, saldo buku rekonsiliasi) menghitung biaya admin sebagai UANG MASUK. Skrip ini HANYA mengosongkan cash_account_id pada baris yang akunnya BUKAN akun COA rekening itu.
// TIDAK mengubah nominal, akun, tanggal, atau status jurnal; debit = kredit tetap; laporan berbasis akun COA (Laba Rugi, Neraca, Arus Kas) tidak terpengaruh.
// DEFAULT = DRY-RUN. Berhenti bila ada baris salah-tanda pada akun selain 6-1700 (tidak diaudit). Diaudit satu event dengan saldo per rekening sebelum/sesudah.
//   docker compose exec -T backend node scripts/rapikan-tanda-rekening-biaya-admin.js [--apply] [--actor <email admin>]
import { prisma } from "../src/db.js";
import { saldoKasBank } from "../src/services/finance/reports.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";

const apply = process.argv.includes("--apply");
const i = process.argv.indexOf("--actor");
const aktorEmail = i > 0 ? process.argv[i + 1] : "admin@klinikmatras.com";
const rp = (n) => `Rp${Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;

try {
  const aktor = await prisma.user.findUnique({ where: { email: aktorEmail }, select: { id: true, name: true } });
  if (!aktor) throw new Error(`Akun ${aktorEmail} tidak ditemukan`);
  const baris = await prisma.$queryRawUnsafe(`
    SELECT l.id::text AS id, l.cash_account_id::text AS rek_id, c.name AS rek, a.code AS akun, e.entry_number AS jurnal, (l.debit - l.credit)::text AS net
      FROM fin_journal_lines l JOIN fin_cash_accounts c ON c.id = l.cash_account_id JOIN fin_accounts a ON a.id = l.account_id JOIN fin_journal_entries e ON e.id = l.entry_id
     WHERE l.account_id <> c.account_id ORDER BY e.entry_number`);
  const asing = baris.filter((b) => b.akun !== "6-1700");
  if (asing.length) throw new Error(`Ada baris salah-tanda pada akun selain 6-1700 (${[...new Set(asing.map((b) => b.akun))].join(", ")}) — tidak diaudit, berhenti`);

  const sebelum = await saldoKasBank(prisma);
  const perRek = new Map();
  for (const b of baris) { const x = perRek.get(b.rek) ?? { n: 0, net: 0 }; x.n += 1; x.net += Number(b.net); perRek.set(b.rek, x); }
  console.log(`${apply ? "TERAPKAN" : "DRY-RUN"}: ${baris.length} baris beban biaya admin ditandai rekening (akan dikosongkan)`);
  for (const [rek, x] of perRek) console.log(`  ${rek}: ${x.n} baris, net ${rp(x.net)} → saldo rekening turun ${rp(x.net)}`);
  console.log("Saldo SEBELUM:", sebelum.map((s) => `${s.name}=${rp(s.saldo)}`).join(" · "));
  if (!apply) { console.log("Tidak ada yang ditulis (tambahkan --apply)."); } else if (baris.length === 0) { console.log("Tidak ada yang perlu dirapikan."); } else {
    await prisma.$transaction(async (tx) => {
      const n = await tx.$executeRawUnsafe(`UPDATE fin_journal_lines SET cash_account_id = NULL WHERE id = ANY($1::uuid[])`, baris.map((b) => b.id));
      if (n !== baris.length) throw new Error(`Jumlah baris terubah (${n}) berbeda dari rencana (${baris.length}) — dibatalkan`);
      await recordActivity(tx, {
        entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: "koreksi-tanda-rekening-biaya-admin", eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktor.id,
        metadata: { aksi: "rapikan_tanda_rekening", jumlahBaris: baris.length, perRekening: Object.fromEntries([...perRek].map(([k, v]) => [k, { baris: v.n, net: v.net }])), jurnal: [...new Set(baris.map((b) => b.jurnal))], alasan: "Baris beban biaya admin ditandai rekening sehingga saldo rekening menghitung biaya sebagai uang masuk; tanda dikosongkan, nominal/akun tidak berubah." },
      });
    });
    const sesudah = await saldoKasBank(prisma);
    console.log("Saldo SESUDAH:", sesudah.map((s) => `${s.name}=${rp(s.saldo)}`).join(" · "));
    console.log("SELESAI");
  }
} catch (e) { console.error("GAGAL:", e.message); process.exitCode = 1; } finally { await prisma.$disconnect(); }
