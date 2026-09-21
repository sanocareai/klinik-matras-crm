// Kalibrasi saldo riil Kas & Bank (services/finance/kalibrasiSaldo.js): cutoff WIB di tengah hari pada ledger yang hanya menyimpan
// TANGGAL buku, jurnal koreksi tunggal/seimbang/idempoten, lawan jurnal ekuitas sistem, dan transaksi sesudah cutoff yang tetap utuh
// serta otomatis menggeser saldo current. Memakai konfigurasi PRODUKSI (KALIBRASI_20260919) apa adanya.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal, reverseJournal } from "../../src/services/finance/journal.js";
import { saldoKasBank } from "../../src/services/finance/reports.js";
import { toMoney } from "../../src/services/finance/money.js";
import { KALIBRASI_20260919 as K, KALIBRASI_20260921 as K2, hitungKoreksi, hitungPosisi, postKalibrasi, sebelumCutoff } from "../../src/services/finance/kalibrasiSaldo.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const UTC = (s) => new Date(s);

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = async (systemKey) => testPrisma.finAccount.findUnique({ where: { systemKey } });
  const bank = await akun(SYSTEM_KEYS.BANK); const kasAkun = await akun(SYSTEM_KEYS.KAS);
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: bank.id } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Uang Kas Sano", kind: "KAS", accountId: kasAkun.id } });
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  const beban = await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true } });
  const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  return { rek: { "KEM - Sano Bank": kem, "PT Sano": pt, "Uang Kas Sano": kas }, modal, beban, admin };
}

/** Jurnal dengan tanggal buku & waktu posting yang ditetapkan (waktu posting = createdAt & postedAt, seperti jurnal produksi). */
async function jurnal(ctx, { tanggal, dibuat, gerak, key = null }) {
  const lines = [];
  for (const [nama, v] of Object.entries(gerak)) {
    const r = ctx.rek[nama]; const n = toMoney(v);
    lines.push({ accountId: r.accountId, cashAccountId: r.id, ...(n.greaterThan(0) ? { debit: n } : { credit: n.abs() }) });
    lines.push({ accountId: n.greaterThan(0) ? ctx.modal.id : ctx.beban.id, ...(n.greaterThan(0) ? { credit: n } : { debit: n.abs() }) });
  }
  const { entry } = await testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: `uji ${tanggal}`, source: "MANUAL", idempotencyKey: key, userId: ctx.admin.id, lines }));
  await testPrisma.finJournalEntry.update({ where: { id: entry.id }, data: { createdAt: UTC(dibuat), postedAt: UTC(dibuat) } });
  return entry;
}

/** Skenario yang meniru produksi: dicatat mundur, tepat di batas jam, transfer 20 Sep, dan pasangan jurnal-balik lintas cutoff. */
async function skenario(ctx) {
  await jurnal(ctx, { tanggal: "2026-09-10", dibuat: "2026-09-10T03:00:00Z", gerak: { "KEM - Sano Bank": "20000000", "PT Sano": "100000000", "Uang Kas Sano": "1000000" } });
  await jurnal(ctx, { tanggal: "2026-09-17", dibuat: "2026-09-20T08:00:00Z", gerak: { "KEM - Sano Bank": "-1000000" } }); // B dicatat mundur, tanggal < cutoff → SEBELUM
  await jurnal(ctx, { tanggal: "2026-09-19", dibuat: "2026-09-19T12:30:00Z", gerak: { "KEM - Sano Bank": "-500000" } }); // C 19:30 WIB → sebelum
  await jurnal(ctx, { tanggal: "2026-09-19", dibuat: "2026-09-19T13:00:00.000Z", gerak: { "PT Sano": "-300000" } }); // D tepat 20:00:00.000 WIB → sebelum (inklusif)
  await jurnal(ctx, { tanggal: "2026-09-19", dibuat: "2026-09-19T13:00:00.001Z", gerak: { "KEM - Sano Bank": "-40000" } }); // E 1 ms sesudah → SESUDAH
  const f = await jurnal(ctx, { tanggal: "2026-09-19", dibuat: "2026-09-20T08:00:00Z", gerak: { "Uang Kas Sano": "-5000" } }); // F bertanggal 19, dicatat 20 → SESUDAH (tidak diasumsikan akhir hari)
  await jurnal(ctx, { tanggal: "2026-09-20", dibuat: "2026-09-20T01:00:00Z", gerak: { "KEM - Sano Bank": "7000000", "PT Sano": "-7000000" } }); // G transfer 20 Sep
  await jurnal(ctx, { tanggal: "2026-09-20", dibuat: "2026-09-20T05:00:00Z", gerak: { "Uang Kas Sano": "50000" } }); // H
  // I: jurnal 19 Sep (sebelum) yang DIBALIK pada 20 Sep (sesudah) — status REVERSED tetap dihitung, balikannya jatuh sesudah cutoff.
  const i = await jurnal(ctx, { tanggal: "2026-09-19", dibuat: "2026-09-19T10:00:00Z", gerak: { "PT Sano": "-700000" } });
  const balik = await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: i.id, date: "2026-09-20", reason: "uji pembalikan", userId: ctx.admin.id }));
  const idBalik = balik.reversal?.id ?? balik.entry?.id ?? balik.id;
  await testPrisma.finJournalEntry.update({ where: { id: idBalik }, data: { createdAt: UTC("2026-09-20T02:00:00Z"), postedAt: UTC("2026-09-20T02:00:00Z") } });
  return { f };
}

const per = (posisi, nama) => posisi.rekening.find((r) => r.nama === nama);
const jalankan = (ctx) => testPrisma.$transaction((tx) => postKalibrasi(tx, { userId: ctx.admin.id }), { timeout: 60_000, maxWait: 60_000 });

test("Klasifikasi cutoff: tanggal < cutoff sebelum (walau dicatat mundur); tanggal 19 dipilah waktu posting (inklusif); ≥ 20 sesudah; jurnal kalibrasi = sebelum", () => {
  const e = (date, dibuat, extra = {}) => ({ date: new Date(`${date}T00:00:00.000Z`), createdAt: UTC(dibuat), postedAt: null, idempotencyKey: null, ...extra });
  assert.equal(sebelumCutoff(e("2026-09-17", "2026-09-25T00:00:00Z")), true, "dicatat mundur");
  assert.equal(sebelumCutoff(e("2026-09-19", "2026-09-19T12:59:59.999Z")), true);
  assert.equal(sebelumCutoff(e("2026-09-19", "2026-09-19T13:00:00.000Z")), true, "tepat cutoff = inklusif");
  assert.equal(sebelumCutoff(e("2026-09-19", "2026-09-19T13:00:00.001Z")), false, "1 ms sesudah cutoff");
  assert.equal(sebelumCutoff(e("2026-09-19", "2026-09-20T08:00:00Z")), false, "tanggal cutoff tetapi dicatat sesudah: tidak diasumsikan akhir hari");
  assert.equal(sebelumCutoff(e("2026-09-19", "2026-09-19T13:00:00.001Z", { postedAt: UTC("2026-09-19T12:00:00Z") })), true, "postedAt didahulukan atas createdAt");
  assert.equal(sebelumCutoff(e("2026-09-20", "2026-09-19T01:00:00Z")), false, "20 Sep selalu sesudah");
  assert.equal(sebelumCutoff(e("2026-09-19", "2026-12-01T00:00:00Z", { idempotencyKey: K.idempotencyKey })), true, "jurnal kalibrasi mendefinisikan saldo pada cutoff");
  assert.equal(K.cutoff.toISOString(), "2026-09-19T13:00:00.000Z");
  // Pengecualian terkonfirmasi pemilik: hanya nomor yang terdaftar yang berpindah ke sisi SEBELUM.
  const dicatatMundur = e("2026-09-19", "2026-09-20T08:08:03Z", { entryNumber: "JV-19092026-368" });
  assert.equal(sebelumCutoff(dicatatMundur), true, "terdaftar di sebelumDikonfirmasi");
  assert.equal(sebelumCutoff({ ...dicatatMundur, entryNumber: "JV-19092026-999" }), false, "nomor lain tetap mengikuti aturan waktu posting");
  assert.deepEqual([...K.sebelumDikonfirmasi].sort(), ["JV-19092026-362", "JV-19092026-368"]);
});

test("Posisi pada cutoff dihitung dari ledger (bukan saldo current); net movement sesudah cutoff terpisah; jurnal 'dicatat mundur pada tanggal cutoff' dilaporkan", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  const p = await hitungPosisi(testPrisma);
  assert.equal(per(p, "KEM - Sano Bank").saldoCutoff, "18500000.00"); // 20jt −1jt −500rb
  assert.equal(per(p, "KEM - Sano Bank").mutasiSesudah, "6960000.00"); // −40rb +7jt
  assert.equal(per(p, "PT Sano").saldoCutoff, "99000000.00"); // 100jt −300rb −700rb (REVERSED tetap dihitung)
  assert.equal(per(p, "PT Sano").mutasiSesudah, "-6300000.00"); // −7jt +700rb (jurnal balik 20 Sep)
  assert.equal(per(p, "Uang Kas Sano").saldoCutoff, "1000000.00");
  assert.equal(per(p, "Uang Kas Sano").mutasiSesudah, "45000.00"); // −5rb +50rb
  for (const r of p.rekening) assert.equal(r.saldoCurrent, toMoney(r.saldoCutoff).plus(toMoney(r.mutasiSesudah)).toFixed(2));
  const sens = p.catatMundurTanggalCutoff.map((c) => `${c.rekening}:${c.net}`).sort();
  assert.deepEqual(sens, ["KEM - Sano Bank:-40000.00", "Uang Kas Sano:-5000.00"]); // E dan F
  const k = hitungKoreksi(p);
  assert.deepEqual(k.baris.map((b) => [b.nama, b.selisih]).sort(), [["KEM - Sano Bank", "-17733493.00"], ["PT Sano", "-62129385.00"], ["Uang Kas Sano", "-945500.00"]]);
  assert.equal(k.total, "-80808378.00");
});

test("Posting: SATU jurnal seimbang bertanggal cutoff; saldo pada cutoff = saldo riil; lawan = ekuitas sistem 'Koreksi Saldo Awal' (bukan pendapatan/biaya); audit tercatat", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  const r = await jalankan(ctx);
  assert.equal(r.created, true);
  const e = await testPrisma.finJournalEntry.findUnique({ where: { id: r.entry.id }, include: { lines: { include: { account: true } } } });
  assert.equal(e.description, "Kalibrasi saldo riil per 19 September 2026 pukul 20.00 WIB");
  assert.equal(e.date.toISOString().slice(0, 10), "2026-09-19");
  assert.equal(e.source, "SALDO_AWAL");
  assert.equal(e.status, "POSTED");
  assert.equal(e.idempotencyKey, K.idempotencyKey);
  const d = e.lines.reduce((s, l) => s.plus(l.debit), toMoney(0)); const c = e.lines.reduce((s, l) => s.plus(l.credit), toMoney(0));
  assert.ok(d.equals(c) && d.greaterThan(0), `debit ${d} = kredit ${c}`);
  const lawan = e.lines.filter((l) => !l.cashAccountId).map((l) => l.account);
  assert.ok(lawan.length > 0 && lawan.every((a) => a.systemKey === SYSTEM_KEYS.KOREKSI_SALDO_AWAL && a.type === "EKUITAS" && a.name === "Koreksi Saldo Awal"));
  assert.ok(!e.lines.some((l) => ["PENDAPATAN", "BEBAN", "BEBAN_POKOK"].includes(l.account.type)), "tidak menyentuh pendapatan/biaya");
  const p = await hitungPosisi(testPrisma);
  for (const [nama, target] of Object.entries(K.target)) assert.equal(per(p, nama).saldoCutoff, toMoney(target).toFixed(2), `${nama} pada cutoff`);
  const ev = await testPrisma.activityEvent.findFirst({ where: { entityType: "fin_journal", entityId: e.id, eventType: "DOCUMENT_POSTED" } });
  assert.equal(ev?.metadata?.aksi, "kalibrasi_saldo_riil");
  assert.equal(ev?.actorId, ctx.admin.id);
});

test("Saldo current = saldo riil cutoff + net movement sesudah cutoff; transaksi 20 Sep utuh & hanya diterapkan sekali; jurnal lain tidak diubah", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  const cuplik = async () => (await testPrisma.finJournalEntry.findMany({ orderBy: { entryNumber: "asc" }, include: { lines: { orderBy: { lineNo: "asc" } } } }))
    .filter((x) => x.idempotencyKey !== K.idempotencyKey).map((x) => [x.entryNumber, x.date.toISOString(), x.status, x.createdAt.toISOString(), x.lines.map((l) => `${l.accountId}:${l.debit}:${l.credit}:${l.cashAccountId}`).join("|")]);
  const sebelum = await cuplik();
  const jumlah20Sebelum = await testPrisma.finJournalEntry.count({ where: { date: { gt: new Date("2026-09-19T00:00:00Z") } } });
  await jalankan(ctx);
  assert.deepEqual(await cuplik(), sebelum, "tidak ada jurnal/baris lain yang berubah, terhapus, atau bertambah");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { date: { gt: new Date("2026-09-19T00:00:00Z") } } }), jumlah20Sebelum, "jurnal 20 Sep tidak bertambah/ganda");

  const p = await hitungPosisi(testPrisma);
  const current = await saldoKasBank(testPrisma, { to: "2026-09-30" });
  for (const r of p.rekening) {
    const harapan = toMoney(K.target[r.nama]).plus(toMoney(r.mutasiSesudah)).toFixed(2);
    assert.equal(toMoney(current.find((x) => x.id === r.id).saldo).toFixed(2), harapan, `${r.nama}: current = riil + mutasi sesudah`);
  }
  // Transaksi baru SESUDAH kalibrasi otomatis menggeser saldo current, TANPA menyentuh saldo pada cutoff.
  const kem = per(p, "KEM - Sano Bank");
  await jurnal(ctx, { tanggal: "2026-09-21", dibuat: "2026-09-21T03:00:00Z", gerak: { "KEM - Sano Bank": "-250000" } });
  const p2 = await hitungPosisi(testPrisma);
  assert.equal(per(p2, "KEM - Sano Bank").saldoCutoff, kem.saldoCutoff);
  assert.equal(per(p2, "KEM - Sano Bank").saldoCurrent, toMoney(kem.saldoCurrent).minus(250000).toFixed(2));
  const c2 = await saldoKasBank(testPrisma, { to: "2026-09-30" });
  assert.equal(toMoney(c2.find((x) => x.id === kem.id).saldo).toFixed(2), per(p2, "KEM - Sano Bank").saldoCurrent);
});

test("Idempoten: posting kedua tidak membuat jurnal; 6 proses PARALEL menghasilkan TEPAT satu jurnal dan satu audit", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  const hasil = await Promise.all(Array.from({ length: 6 }, () => jalankan(ctx)));
  assert.equal(hasil.filter((h) => h.created).length, 1, hasil.map((h) => `${h.created}:${h.alasan ?? ""}`).join(","));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: K.idempotencyKey } }), 1);
  const lagi = await jalankan(ctx);
  assert.equal(lagi.created, false);
  assert.equal(lagi.alasan, "sudah_diposting");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: K.idempotencyKey } }), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "fin_journal", eventType: "DOCUMENT_POSTED" } }), 1, "audit trail hanya satu");
  const p = await hitungPosisi(testPrisma);
  for (const [nama, target] of Object.entries(K.target)) assert.equal(per(p, nama).saldoCutoff, toMoney(target).toFixed(2), "tidak terhitung dua kali");
});

test("Laporan konsisten: buku besar (Σ debit = Σ kredit seluruh ledger), saldo akun Kas/Bank di COA = saldo rekening, dan akun Koreksi Saldo Awal menampung selisih", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  await jalankan(ctx);
  const [tot] = await testPrisma.$queryRawUnsafe(`select sum(debit) d, sum(credit) c from fin_journal_lines l join fin_journal_entries e on e.id=l.entry_id where e.status in ('POSTED','REVERSED')`);
  assert.equal(toMoney(tot.d).toFixed(2), toMoney(tot.c).toFixed(2), "neraca saldo seimbang");
  const saldoAkun = async (systemKey) => {
    const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
    const s = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
    return toMoney(s._sum.debit ?? 0).minus(toMoney(s._sum.credit ?? 0));
  };
  const kartu = await saldoKasBank(testPrisma, { to: "2026-09-30" });
  const jumlahKind = (kind) => kartu.filter((x) => x.kind === kind).reduce((s, x) => s.plus(toMoney(x.saldo)), toMoney(0));
  assert.equal((await saldoAkun(SYSTEM_KEYS.BANK)).toFixed(2), jumlahKind("BANK").toFixed(2));
  assert.equal((await saldoAkun(SYSTEM_KEYS.KAS)).toFixed(2), jumlahKind("KAS").toFixed(2));
  assert.equal((await saldoAkun(SYSTEM_KEYS.KOREKSI_SALDO_AWAL)).toFixed(2), "80808378.00", "akun ekuitas berdebit sebesar total pengurangan kas/bank");
});

test("Rekening target tidak ditemukan → ditolak keras, tidak ada jurnal (tidak menebak rekening)", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  await testPrisma.finCashAccount.update({ where: { id: ctx.rek["PT Sano"].id }, data: { name: "PT Sano (lama)" } });
  await assert.rejects(jalankan(ctx), /"PT Sano" tidak ditemukan/);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: K.idempotencyKey } }), 0);
});

test("Akun Koreksi Saldo Awal: satu akun saja walau Pasang Akun Bawaan dijalankan ulang (tidak ganda)", async () => {
  const ctx = await siapkan(); await skenario(ctx);
  await jalankan(ctx);
  assert.equal(await testPrisma.finAccount.count({ where: { name: "Koreksi Saldo Awal" } }), 1);
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); // "Pasang Akun Bawaan" dijalankan ulang tidak menggandakan
  assert.equal(await testPrisma.finAccount.count({ where: { systemKey: SYSTEM_KEYS.KOREKSI_SALDO_AWAL } }), 1);
});

test("Pengecualian terkonfirmasi pemilik: jurnal bertanggal cutoff yang diposting sesudahnya berpindah ke SEBELUM; saldo pada cutoff tetap = riil dan current = riil + mutasi sesudah", async () => {
  const ctx = await siapkan(); const { f } = await skenario(ctx);
  const konfig = { ...K, sebelumDikonfirmasi: [f.entryNumber] };
  const p = await hitungPosisi(testPrisma, konfig);
  assert.equal(per(p, "Uang Kas Sano").saldoCutoff, "995000.00"); // 1jt −5rb (F kini sebelum)
  assert.equal(per(p, "Uang Kas Sano").mutasiSesudah, "50000.00"); // hanya H
  assert.deepEqual(p.catatMundurTanggalCutoff.map((c) => c.rekening).sort(), ["KEM - Sano Bank"], "F tidak lagi dilaporkan sebagai sesudah cutoff");
  const r = await testPrisma.$transaction((tx) => postKalibrasi(tx, { konfig, userId: ctx.admin.id }), { timeout: 60_000, maxWait: 60_000 });
  assert.equal(r.created, true);
  const p2 = await hitungPosisi(testPrisma, konfig);
  for (const [nama, target] of Object.entries(K.target)) assert.equal(per(p2, nama).saldoCutoff, toMoney(target).toFixed(2));
  const cur = await saldoKasBank(testPrisma, { to: "2026-09-30" });
  for (const x of p2.rekening) assert.equal(toMoney(cur.find((c) => c.id === x.id).saldo).toFixed(2), toMoney(K.target[x.nama]).plus(toMoney(x.mutasiSesudah)).toFixed(2));
});

test("Kalibrasi ke-2 (21 Sep 10.09): hanya KEM & PT Sano, kas fisik TIDAK disentuh, jurnal kalibrasi pertama utuh, jurnal seimbang, idempoten, saldo = riil", async () => {
  const ctx = await siapkan();
  await skenario(ctx);
  const admin = ctx.admin;
  const pertama = await testPrisma.$transaction((tx) => postKalibrasi(tx, { userId: admin.id }), { timeout: 60_000, maxWait: 60_000 });
  assert.equal(pertama.created, true);
  // jurnal sesudah kalibrasi pertama tapi SEBELUM cutoff kedua (mis. pengeluaran 21 Sep pagi), dan satu SESUDAH cutoff kedua
  await jurnal(ctx, { tanggal: "2026-09-21", dibuat: "2026-09-21T01:00:00Z", gerak: { "KEM - Sano Bank": "-2000000" } });
  await jurnal(ctx, { tanggal: "2026-09-21", dibuat: "2026-09-21T04:00:00Z", gerak: { "PT Sano": "-100000" } }); // 11.00 WIB, sesudah 10.09
  const sebelum = await saldoKasBank(testPrisma, {});
  const saldoKas = sebelum.find((r) => r.name === "Uang Kas Sano").saldo;
  const kedua = await testPrisma.$transaction((tx) => postKalibrasi(tx, { konfig: K2, userId: admin.id }), { timeout: 60_000, maxWait: 60_000 });
  assert.equal(kedua.created, true, JSON.stringify(kedua.alasan));
  const e = await testPrisma.finJournalEntry.findUnique({ where: { id: kedua.entry.id }, include: { lines: true } });
  const D = e.lines.reduce((a, l) => a + Number(l.debit), 0); const Kr = e.lines.reduce((a, l) => a + Number(l.credit), 0);
  assert.equal(D, Kr, "seimbang");
  assert.equal(e.lines.filter((l) => l.cashAccountId).length, 2, "hanya dua rekening bank");
  assert.ok(!e.lines.some((l) => l.cashAccountId === ctx.rek["Uang Kas Sano"].id), "kas fisik tidak disentuh");
  const p = await hitungPosisi(testPrisma, K2);
  assert.equal(per(p, "KEM - Sano Bank").saldoCutoff, "4172788.00");
  assert.equal(per(p, "PT Sano").saldoCutoff, "36350615.00");
  assert.equal(per(p, "PT Sano").mutasiSesudah, "-100000.00", "jurnal sesudah cutoff kedua tetap sesudah");
  const sesudah = await saldoKasBank(testPrisma, {});
  assert.equal(sesudah.find((r) => r.name === "Uang Kas Sano").saldo, saldoKas, "saldo kas tak berubah");
  assert.equal(Number(sesudah.find((r) => r.name === "KEM - Sano Bank").saldo), 4172788);
  assert.equal(Number(sesudah.find((r) => r.name === "PT Sano").saldo), 36350615 - 100000);
  // jurnal kalibrasi pertama tak berubah
  assert.equal((await testPrisma.finJournalEntry.findUnique({ where: { id: pertama.entry.id } })).status, "POSTED");
  // idempoten
  const ulang = await testPrisma.$transaction((tx) => postKalibrasi(tx, { konfig: K2, userId: admin.id }));
  assert.equal(ulang.created, false);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: K2.idempotencyKey } }), 1);
});
