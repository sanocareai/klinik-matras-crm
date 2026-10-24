// SIMULASI TULIS pada DB REHEARSAL (salinan restore backup nyata; DIHAPUS sesudahnya) — BUKAN production. Dijalankan skrip rilis SETELAH sidik jari baca-saja lulus.
// Membuktikan, dengan data nyata: posting beberapa unit secara bersamaan + klik ganda + pembaca yang mengaudit setiap potret konsisten → tidak pernah ada keadaan palsu, tidak ada deadlock, hasil titik tetap,
// satu pergerakan per transaksi, jurnal/GL tidak berubah (jurnalHPP=false). Pagar keras: menolak jalan bila bukan DB bernama rehearsal_evl_*.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { periksaKeadaanCatatan, ambilCatatanHistoris, tungguPenyegaran } = await import("/app/src/services/catatanPemakaianHistoris.js");
const { postStockMovement } = await import("/app/src/services/inventoryLedger.js");
const { ajukanBatch, jalankanBatch, statusBatch } = await import("/app/src/services/postingBatchLatar.js");
const { rencanakanPosting, jalankanPosting } = await import("/app/src/services/postingPemakaianHistoris.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 260) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
if (!/^rehearsal_evl_\d+_\d+$/.test(dbNama)) { console.log("FAIL pagar: simulasi tulis HANYA di DB rehearsal_evl_* (ini: " + dbNama + ")"); console.log("SIMULASI_EVALUASI gagal=1"); process.exit(1); }

const admin = (await prisma.$queryRawUnsafe(`select id from "User" where email = 'admin@klinikmatras.com' limit 1`))[0];
cek("akun Admin impor ada di data restore (aktor posting)", !!admin);
const S = async () => ({
  gerak: await hitung("select count(*)::int n from stock_movements"), jurnal: await hitung("select count(*)::int n from fin_journal_entries"),
  gl1400: Number((await prisma.$queryRawUnsafe(`select coalesce(sum(l.debit - l.credit),0)::float n from fin_journal_lines l join fin_accounts a on a.id = l.account_id where a.code = '1-1400'`))[0].n),
  negatif: await hitung("select count(*)::int n from (select material_id from stock_movements group by 1 having sum(qty) < -0.0001) x"),
  siap: await hitung("select count(*)::int n from unit_usage_notes where state = 'SIAP_POSTING'"),
});
const plan0 = await rencanakanPosting(prisma);
const unitKandidat = [...new Set(plan0.transaksi.map((t) => t.unitId))].slice(0, 3);
cek("ada minimal 2 unit siap posting untuk disimulasikan", unitKandidat.length >= 2, unitKandidat.length);
const A = unitKandidat.slice(0, 1); const B = unitKandidat.slice(1, 3);
const pA = await rencanakanPosting(prisma, { unitIds: A }); const pB = await rencanakanPosting(prisma, { unitIds: B });
const s0 = await S();
let jalan = true; let potret = 0; let palsu = 0; let galatPembaca = 0;
const pembaca = (async () => { while (jalan) { try { const r = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 }); potret++; palsu += r.berubah; } catch { galatPembaca++; } } })();
const P = (hash, unitIds) => jalankanPosting(prisma, { persetujuan: { hashDisetujui: hash, rujukan: "REHEARSAL-SANDBOX-bukan-production", disetujuiOleh: "simulasi rilis" }, aktor: { id: admin.id }, unitIds });
const r = await Promise.allSettled([P(pA.hash, A), P(pB.hash, B), P(pA.hash, A)]);
jalan = false; await pembaca;
cek("tiga pemanggilan serentak (dua proses + klik ganda) semuanya selesai tanpa galat/deadlock", r.every((x) => x.status === "fulfilled" && x.value.gagal.length === 0), JSON.stringify(r.map((x) => x.status === "fulfilled" ? [x.value.diposting.length, x.value.dilewati.length, x.value.gagal.length] : String(x.reason?.message).slice(0, 80))));
const dipostingTotal = r.filter((x) => x.status === "fulfilled").reduce((n, x) => n + x.value.diposting.length, 0);
cek("setiap transaksi rencana diposting TEPAT SEKALI (klik ganda tidak menggandakan)", dipostingTotal === pA.jumlah + pB.jumlah, `${dipostingTotal} vs ${pA.jumlah + pB.jumlah}`);
cek("pembaca serentak mengaudit potret konsisten dan TIDAK menemukan keadaan palsu", potret > 0 && palsu === 0 && galatPembaca === 0, `potret=${potret} palsu=${palsu} galatPembaca=${galatPembaca}`);
const akhir = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
cek("keadaan akhir = titik tetap (evaluasi global tidak punya apa pun untuk diubah)", akhir.berubah === 0, `berubah=${akhir.berubah}`);
const s1 = await S();
cek("pergerakan stok bertambah tepat sebanyak transaksi", s1.gerak === s0.gerak + pA.jumlah + pB.jumlah, `${s0.gerak} → ${s1.gerak}`);
cek("jurnal dan GL 1-1400 TIDAK berubah (kuantitas dulu, tanpa jurnal HPP)", s1.jurnal === s0.jurnal && s1.gl1400 === s0.gl1400, `jurnal ${s0.jurnal}→${s1.jurnal}; GL ${s0.gl1400}→${s1.gl1400}`);
cek("tidak ada bahan baru yang menjadi negatif", s1.negatif <= s0.negatif, `${s0.negatif} → ${s1.negatif}`);
const rb = await rencanakanPosting(prisma);
cek("rencana berikutnya = rencana awal dikurangi yang sudah diposting (tidak memuat transaksi palsu)", rb.jumlah === plan0.jumlah - pA.jumlah - pB.jumlah, `${plan0.jumlah} → ${rb.jumlah}`);

// ── B. saldo diubah DI LUAR modul catatan (pengeluaran stok biasa lewat ledger inti): pembaca langsung sesudah commit tidak boleh melihat SIAP_POSTING basi; UI = mesin; tersimpan menyusul tanpa evaluasi manual ──
const sisa = await rencanakanPosting(prisma);
const perBahan = new Map(); for (const t of sisa.transaksi) perBahan.set(t.materialId, (perBahan.get(t.materialId) ?? 0) + 1);
const bahanUji = [...perBahan].sort((a, b) => b[1] - a[1])[0]?.[0];
const saldoBahan = bahanUji ? Number((await prisma.$queryRawUnsafe("select coalesce(sum(qty),0)::float s from stock_movements where material_id = $1::uuid", bahanUji))[0].s) : 0;
cek("ada bahan dengan saldo positif dan transaksi siap untuk uji perubahan di luar modul", !!bahanUji && saldoBahan > 0, bahanUji + " saldo " + saldoBahan);
if (bahanUji && saldoBahan > 0) {
  const trxBahan = sisa.transaksi.filter((t) => t.materialId === bahanUji);
  await prisma.$transaction((tx) => postStockMovement(tx, { materialId: bahanUji, type: "ISSUE", qty: -saldoBahan, note: "simulasi: pengeluaran biasa di luar modul catatan", createdById: admin.id }), { timeout: 60_000 });
  const rencanaSetelah = await rencanakanPosting(prisma);
  cek("rencana mesin langsung sesudah commit TIDAK memuat transaksi bahan yang saldonya dihabiskan pengeluaran biasa", !rencanaSetelah.transaksi.some((t) => t.materialId === bahanUji), trxBahan.length + " trx sebelum");
  const tampil = await ambilCatatanHistoris(prisma, trxBahan[0].unitId);
  cek("tampilan unit (yang dilihat pengguna) langsung benar: tidak ada catatan bahan itu yang SIAP_POSTING", !tampil.items.some((i) => i.bahan?.id === bahanUji && i.origin === "EXCEL" && i.state === "SIAP_POSTING"), tampil.items.filter((i) => i.bahan?.id === bahanUji).map((i) => i.state).join(","));
  await tungguPenyegaran();
  const a2 = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
  cek("keadaan TERSIMPAN menyusul tanpa evaluasi global manual (titik tetap)", a2.berubah === 0, "berubah=" + a2.berubah);
}
// ── C. batch di latar atas sebagian rencana: progres, selesai, tanpa pergerakan ganda, titik tetap ──
const semuaSisa = await rencanakanPosting(prisma);
const unitBatch = [...new Set(semuaSisa.transaksi.map((t) => t.unitId))].slice(0, 8);
const rencanaBatch = unitBatch.length ? await rencanakanPosting(prisma, { unitIds: unitBatch }) : { jumlah: 0 };
if (rencanaBatch.jumlah) {
  const setuju = { hashDisetujui: rencanaBatch.hash, rujukan: "REHEARSAL-SANDBOX-bukan-production", disetujuiOleh: "simulasi rilis" };
  const bt = await ajukanBatch(prisma, { persetujuan: setuju, aktor: { id: admin.id }, unitIds: unitBatch });
  cek("mengajukan batch tidak memposting apa pun dan idempoten (batchId = hash rencana)", bt.baru === true && bt.status === "MENUNGGU" && bt.batchId === rencanaBatch.hash);
  const gerakSblm = await hitung("select count(*)::int n from stock_movements"); const prog = [];
  const rb = await jalankanBatch(prisma, bt.batchId, { setelahUnit: async () => { prog.push((await statusBatch(prisma, bt.batchId)).unitSelesai); } });
  const sb = await statusBatch(prisma, bt.batchId);
  cek("batch selesai di latar dengan progres naik per unit", ["SELESAI", "SELESAI_SEBAGIAN"].includes(rb.status) && prog.length === bt.totalUnit && prog.every((v, i) => v === i + 1), rb.status + "; progres " + prog.join(","));
  const ulang = await jalankanBatch(prisma, bt.batchId); const ajukanLagi = await ajukanBatch(prisma, { persetujuan: setuju, aktor: { id: admin.id }, unitIds: unitBatch });
  cek("jalankan ulang batch yang sama = nol tulisan; ajukan ulang = batch yang sama", ulang.dijalankan === false && ajukanLagi.baru === false);
  const gerakKini = await hitung("select count(*)::int n from stock_movements");
  cek("pergerakan bertambah tepat sebanyak transaksi yang diposting (tanpa ganda)", gerakKini - gerakSblm === sb.transaksiDiposting, "+" + (gerakKini - gerakSblm) + " vs " + sb.transaksiDiposting);
  await tungguPenyegaran();
  const a3 = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
  cek("titik tetap sesudah batch", a3.berubah === 0, "berubah=" + a3.berubah);
  const s2 = await S(); cek("jurnal dan GL 1-1400 tetap sesudah batch", s2.jurnal === s0.jurnal && s2.gl1400 === s0.gl1400);
}
console.log("SIMULASI_EVALUASI gagal=" + gagal);
await prisma.$disconnect();
process.exit(gagal ? 1 : 0);
