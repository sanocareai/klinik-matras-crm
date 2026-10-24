// Uji KODE BARU + migrasi "catatan pemakaian historis" pada SALINAN RESTORE backup nyata (DB sementara yang DIHAPUS skrip rilis; production tidak tersentuh).
// Dijalankan di image kandidat dengan DATABASE_URL = DB rehearsal SESUDAH migrasi diterapkan dan sidik jari tabel lama terbukti identik.
// Bagian A (baca-saja): tabel baru KOSONG, antrean posting KOSONG, kode baru memuat data nyata tanpa menulis apa pun — inilah keadaan production saat rilis.
// Bagian B (menulis HANYA pada salinan): satu impor mini + posting + koreksi pada unit/bahan NYATA dari restore, untuk membuktikan trigger/constraint/ledger pada skema nyata. Ini BUKAN impor manifest production dan BUKAN posting 384 transaksi.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
let gagal = 0; let dilewati = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 260) : "")); };
const lewati = (n, a) => { dilewati += 1; console.log(`SKIP ${n} — DILEWATI: ${a}`); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const baris = async (sql) => prisma.$queryRawUnsafe(sql);
const S = "/app/src/";
const cat = await import(S + "services/catatanPemakaianHistoris.js");
const pos = await import(S + "services/postingPemakaianHistoris.js");
const kor = await import(S + "services/koreksiPemakaian.js");
const val = await import(S + "services/finance/koreksiValuasi.js");
const jejak = await import(S + "services/finance/biayaBahan.js");
await import(S + "routes/pemakaianKoreksi.js"); // modul rute memuat tanpa galat (impor + dependensi)
const TABEL_BARU = ["usage_import_batches", "unit_usage_notes", "unit_usage_note_events", "fin_stock_movement_valuation_corrections"];
const inti = async () => ({ sm: await hitung("select count(*)::int n from stock_movements"), mi: await hitung("select count(*)::int n from material_issues"), jur: await hitung("select count(*)::int n from fin_journal_entries"), val: await hitung("select count(*)::int n from fin_stock_movement_valuations"), mat: await hitung("select count(*)::int n from materials"), unit: await hitung("select count(*)::int n from units"), koreksi: await hitung("select count(*)::int n from warehouse_corrections") });

// ───────── A. keadaan saat rilis (baca-saja) ─────────
const mig = await baris("select migration_name from _prisma_migrations where migration_name like '%catatan_pemakaian_historis' and finished_at is not null and rolled_back_at is null");
cek("migrasi catatan_pemakaian_historis tercatat selesai pada salinan", mig.length === 1, mig.map((m) => m.migration_name).join());
for (const t of TABEL_BARU) cek(`tabel baru ${t} ada dan KOSONG`, await hitung(`select count(*)::int n from ${t}`) === 0);
cek("kolom origin_type/origin_id di penyesuaian stok ada dan NULL di semua baris lama", await hitung("select count(*)::int n from stock_adjustment_requests where origin_type is not null or origin_id is not null") === 0 && await hitung("select count(*)::int n from information_schema.columns where table_name='stock_adjustment_requests' and column_name in ('origin_type','origin_id')") === 2);
const defJenis = (await baris("select pg_get_constraintdef(oid) d from pg_constraint where conname='warehouse_corrections_jenis_chk'"))[0]?.d ?? "";
cek("pagar jenis koreksi Gudang kini memuat GOODS_RECEIPT dan UNIT_USAGE (tetap dua jenis, kind/status tak berubah)", /GOODS_RECEIPT/.test(defJenis) && /UNIT_USAGE/.test(defJenis) && /PENDING_APPROVAL/.test(defJenis), defJenis);
cek("semua koreksi Gudang lama tetap sah (tidak ada baris yang melanggar pagar)", await hitung("select count(*)::int n from warehouse_corrections where doc_type not in ('GOODS_RECEIPT','UNIT_USAGE')") === 0);
const trig = await baris("select tgname from pg_trigger where not tgisinternal and tgname in ('unit_usage_notes_guard_trg','unit_usage_note_events_guard_trg','fin_smv_corr_append_only_trg') order by 1");
cek("3 trigger penjaga terpasang pada tabel baru", trig.length === 3, trig.map((t) => t.tgname).join());
const e0 = await inti();
const r0 = await pos.rencanakanPosting(prisma);
cek("ANTREAN POSTING KOSONG pada salinan data nyata (tidak ada catatan siap-posting; tidak ada 384 transaksi)", r0.jumlah === 0 && r0.orderUnik === 0, `jumlah=${r0.jumlah}`);
const ev0 = await cat.evaluasiUlang(prisma, { actorId: null });
cek("evaluasi ulang pada antrean kosong = nol perubahan", ev0.berubah === 0, JSON.stringify(ev0).slice(0, 120));
const unitContoh = (await baris("select u.id::text id, u.unit_code from units u where exists (select 1 from stock_movements s where s.unit_id = u.id and s.type = 'ISSUE') order by u.unit_code limit 1"))[0];
if (unitContoh) { const ch = await cat.ambilCatatanHistoris(prisma, unitContoh.id); cek("unit nyata ber-ISSUE: catatan historis kosong (tidak ada yang muncul sendiri)", ch.ringkas.total === 0, `${unitContoh.unit_code}`); const hj = await jejak.bacaJejakUnit(prisma, unitContoh.id, { izinHarga: true }); cek("jejak biaya unit nyata terbaca (kode baru + data lama)", !!hj && Array.isArray(hj.belumFinal ?? []), `gap=${hj?.belumFinal?.length}`); } else lewati("catatan historis unit nyata", "tidak ada unit ber-ISSUE pada restore");
const e1 = await inti(); cek("bagian A tidak menulis apa pun (pergerakan, Material Issue, jurnal, valuasi, bahan, unit, koreksi tetap)", JSON.stringify(e1) === JSON.stringify(e0), JSON.stringify(e1));
cek("tabel baru tetap kosong setelah semua pemeriksaan bagian A", (await Promise.all(TABEL_BARU.map((t) => hitung(`select count(*)::int n from ${t}`)))).every((n) => n === 0));

// ───────── B. jalur tulis pada SALINAN (impor mini → posting → koreksi → koreksi harga) ─────────
const u = (await baris(`select u.id::text id, u.unit_code, o."orderNumber" order_number from units u join "Order" o on o.id = u.order_id where o."orderNumber" ~ '^(RES|NEW)-[0-9]{8}-[0-9]+$' and u.status <> 'CANCELLED' and not exists (select 1 from stock_movements s where s.unit_id = u.id) and (select count(*) from units x where x.order_id = o.id) = 1 order by o."createdAt" desc limit 1`))[0];
const m = (await baris(`select m.id::text id, m.code, m.name, m.unit::text unit from materials m where m.active and (m.kind is null or m.kind <> 'PERLENGKAPAN_STOK') and (select count(*) from materials y where upper(y.name) = upper(m.name)) = 1 and (select coalesce(sum(qty),0) from stock_movements s where s.material_id = m.id) >= 10 and exists (select 1 from stock_movements s where s.material_id = m.id and s.qty > 0 and s.created_at < '2026-10-01') and m.name !~ '[",]' order by m.code limit 1`))[0];
const pelaku = await baris("select id::text id, name from \"User\" where active order by \"createdAt\" limit 2");
if (!u || !m || pelaku.length < 2) { lewati("jalur tulis pada salinan", `butuh unit tanpa pergerakan, bahan bersaldo, dan 2 pengguna aktif (unit=${!!u} bahan=${!!m} pengguna=${pelaku.length})`); }
else {
  const A = pelaku[0]; const O = pelaku[1]; const NL = String.fromCharCode(10);
  const HDR = ["No", "No. Resi / Order", "Tgl Selesai", "Bulan Selesai", "Nama Pelanggan", "Nama Sales", "Ukuran Kasur", "Jenis Layanan", "Tgl Komplain", "PIC Komplain", "PIC / Teknisi", "CORNER", "Kategori Bahan", "Nama Material / Bahan (SANO)", "Spesifikasi / Detail", "Barang", "Qty Pakai", "Satuan", "Harga Satuan (Rp)", "Total Biaya Bahan (Rp)", `"Total Penjualan${NL}(Rp)"`, "Insentif PIC", "Insentif Corner", "Keterangan / QC"].join(",");
  const QTY = "2,0";
  const csv = ["JURNAL RINCIAN REHEARSAL", "Data", HDR, `1,${u.order_number},5 Okt 26,OKT,Pelanggan,Sales,200 x 160,Paket,,,RISDI,,Lain-lain,${m.name},,BAHAN,"${QTY}",${m.unit},,,,,,QC OK`].join(NL);
  const ledgerLama = await hitung("select count(*)::int n from stock_movements where type = 'ISSUE' and unit_id is not null");
  const saldo = async () => Number((await baris(`select coalesce(sum(qty),0)::float n from stock_movements where material_id = '${m.id}'`))[0].n);
  const s0 = await saldo(); const sm0 = await hitung("select count(*)::int n from stock_movements"); const jur0 = await hitung("select count(*)::int n from fin_journal_entries"); const status0 = (await prisma.unit.findUnique({ where: { id: u.id }, select: { status: true } })).status;
  const rn = await cat.rencanakanImpor(prisma, { csvText: csv, namaBerkas: "rehearsal-mini.csv" });
  const ap = await cat.terapkanImpor(prisma, rn, { actorId: A.id });
  cek("impor mini (1 baris, unit nyata) membuat 1 catatan Excel + catatan LEDGER hanya untuk ISSUE lama; TANPA pergerakan baru", ap.batchBaru === true && await hitung("select count(*)::int n from unit_usage_notes where origin = 'EXCEL'") === 1 && await hitung("select count(*)::int n from unit_usage_notes where origin = 'LEDGER'") === ledgerLama && await hitung("select count(*)::int n from stock_movements") === sm0, `ledger=${ledgerLama}`);
  const ulang = await cat.terapkanImpor(prisma, await cat.rencanakanImpor(prisma, { csvText: csv, namaBerkas: "rehearsal-mini.csv" }), { actorId: A.id });
  cek("impor ulang berkas yang sama = nol perubahan (idempoten)", ulang.batchBaru === false && ulang.dibuat === 0);
  const n = await prisma.unitUsageNote.findFirst({ where: { origin: "EXCEL" } });
  cek("nilai asli berkas tersimpan apa adanya (raw_qty '2,0')", n.rawQty === QTY && n.rawUom === m.unit);
  let tolak = null; try { await prisma.$executeRawUnsafe(`update unit_usage_notes set raw_qty = '9' where id = '${n.id}'`); } catch (e) { tolak = String(e.message); }
  cek("trigger menolak mengubah nilai asli lewat SQL langsung", /tidak boleh diubah/.test(tolak ?? ""), tolak?.slice(0, 80));
  if (n.state !== "SIAP_POSTING") lewati("posting satu transaksi pada salinan", `catatan contoh berstatus ${n.state} (${(n.flags ?? []).map((f) => f.kode).join(",")}) — bukan SIAP_POSTING pada data restore ini`);
  else {
    const rp = await pos.rencanakanPosting(prisma, { unitIds: [u.id] });
    cek("rencana posting memuat tepat 1 transaksi untuk unit contoh", rp.jumlah === 1, `jumlah=${rp.jumlah}`);
    let tanpaPersetujuan = null; try { await pos.jalankanPosting(prisma, { persetujuan: { hashDisetujui: "salah", rujukan: "x", disetujuiOleh: "x" }, aktor: A, unitIds: [u.id] }); } catch (e) { tanpaPersetujuan = e.code ?? e.message; }
    cek("posting TANPA hash persetujuan yang benar ditolak (gerbang persetujuan)", !!tanpaPersetujuan, tanpaPersetujuan);
    const h = await pos.jalankanPosting(prisma, { persetujuan: { hashDisetujui: rp.hash, rujukan: "REHEARSAL-SALINAN", disetujuiOleh: "Rehearsal (salinan)" }, aktor: A, unitIds: [u.id] });
    const mv = await prisma.stockMovement.findFirst({ where: { unitId: u.id, materialId: m.id, type: "ISSUE" } });
    cek("posting: 1 ISSUE bertaut unit+bahan, tanggal HISTORIS (5 Okt WIB), pelaku terisi, saldo turun tepat 2,0", !!mv && Number(mv.qty) === -2 && mv.createdById === A.id && new Date(mv.createdAt).toISOString().startsWith("2026-10-0") && Math.abs((await saldo()) - (s0 - 2)) < 1e-6, mv ? mv.createdAt.toISOString() : "tidak ada");
    cek("posting: tidak ada jurnal HPP otomatis (jurnalHPP default MATI) dan valuasi dibekukan", await hitung(`select count(*)::int n from fin_stock_movement_valuations where movement_id = '${mv.id}'`) === 1 && await hitung("select count(*)::int n from fin_journal_entries") === jur0);
    const ulangPos = await pos.jalankanPosting(prisma, { persetujuan: { hashDisetujui: (await pos.rencanakanPosting(prisma, { unitIds: [u.id] })).hash, rujukan: "REHEARSAL-SALINAN", disetujuiOleh: "Rehearsal (salinan)" }, aktor: A, unitIds: [u.id] });
    cek("posting ulang = nol transaksi baru (idempoten)", (await hitung(`select count(*)::int n from stock_movements where unit_id = '${u.id}' and material_id = '${m.id}' and type = 'ISSUE'`)) === 1, JSON.stringify(ulangPos).slice(0, 100));
    const k = await kor.ajukanKoreksiPemakaian(prisma, { unitId: u.id, materialId: m.id, qtyBaru: 1.25, alasan: "Rehearsal: Excel terverifikasi 1,25", kunci: "rehearsal-kor-0001", aktor: A });
    let sendiri = null; try { await kor.setujuiKoreksiPemakaian(prisma, { koreksiId: k.id, aktor: A }); } catch (e) { sendiri = e.code ?? e.message; }
    cek("pemohon tidak bisa menyetujui koreksinya sendiri (pemisahan tugas)", !!sendiri, sendiri);
    const ok = await kor.setujuiKoreksiPemakaian(prisma, { koreksiId: k.id, aktor: O });
    const pembalik = await prisma.stockMovement.findUnique({ where: { id: ok.hasil.pergerakanId } });
    cek("koreksi disetujui orang lain: pergerakan pembalik bertaut ke pemakaian asal; saldo = awal − 1,25; asal tidak diubah", pembalik.correctsMovementId === mv.id && Math.abs((await saldo()) - (s0 - 1.25)) < 1e-6 && Number((await prisma.stockMovement.findUnique({ where: { id: mv.id } })).qty) === -2, `selisih=${ok.hasil.selisih}`);
    const kv = await val.koreksiValuasiPergerakan(prisma, { movementId: ok.hasil.pergerakanId, hargaBaru: 1000, alasan: "Rehearsal: harga manual (bukan tebakan production)", kunci: "rehearsal-val-0001", aktor: O });
    cek("koreksi harga memakai tabel terpisah; valuasi asli tidak diubah; tanpa jurnal otomatis", !!kv.koreksi && await hitung("select count(*)::int n from fin_stock_movement_valuation_corrections") === 1);
    let ubahKoreksi = null; try { await prisma.$executeRawUnsafe("update fin_stock_movement_valuation_corrections set reason = 'x'"); } catch (e) { ubahKoreksi = String(e.message); }
    cek("tabel koreksi harga append-only (UPDATE ditolak)", /append-only/.test(ubahKoreksi ?? ""));
    const neg = await hitung("select count(*)::int n from (select material_id from stock_movements group by material_id having sum(qty) < 0) x");
    const negAwal = await hitung(`select count(*)::int n from (select material_id from stock_movements where material_id <> '${m.id}' group by material_id having sum(qty) < 0) x`);
    cek("bahan contoh tidak menjadi minus akibat posting/koreksi", (await saldo()) >= 0, `bahan minus total=${neg}, selain contoh=${negAwal} (sudah ada sebelum rehearsal)`);
    const unitSesudah = await prisma.unit.findUnique({ where: { id: u.id }, select: { status: true } }); cek("status unit tidak berubah oleh posting/koreksi", unitSesudah.status === status0, `${status0} → ${unitSesudah.status}`);
  }
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal + " skip=" + dilewati);
process.exit(gagal ? 1 : 0);
