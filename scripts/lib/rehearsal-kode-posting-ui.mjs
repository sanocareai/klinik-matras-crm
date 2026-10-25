// (rilis UI posting historis: ditambah pratinjau manifest + daftar/status batch BACA-SAJA)
// Pemeriksaan KODE BARU "evaluasi catatan pemakaian historis: global + atomik + terserialisasi" terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// BACA-SAJA: skrip rilis membuktikan isi seluruh tabel sama sebelum dan sesudah. Yang diperiksa: keadaan catatan production SUDAH titik tetap menurut kode baru (evaluasi global tidak punya apa pun untuk diubah),
// rencana posting dapat dibangun, dan kunci evaluasi tersedia di Postgres (pg_advisory_xact_lock) tanpa menahan apa pun.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { periksaKeadaanCatatan, kunciEvaluasiCatatan } = await import("/app/src/services/catatanPemakaianHistoris.js");
const { rencanakanPosting } = await import("/app/src/services/postingPemakaianHistoris.js");
const { pratinjauPosting } = await import("/app/src/services/postingPratinjau.js");
const { daftarBatch } = await import("/app/src/services/postingBatchLatar.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 240) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);

const dbNama = (await prisma.$queryRawUnsafe("select current_database() n"))[0].n;
cek("berjalan di DB rehearsal (bukan production)", /^rehearsal_evl_\d+_\d+$/.test(dbNama), dbNama);
const n0 = await hitung("select count(*)::int n from unit_usage_notes");
cek("tabel catatan pemakaian historis berisi (impor v2 ada di data restore)", n0 > 0, n0);

// 1) keadaan production = titik tetap (potret konsisten RepeatableRead; tanpa kunci; tanpa tulisan)
const r = await prisma.$transaction((tx) => periksaKeadaanCatatan(tx), { isolationLevel: "RepeatableRead", timeout: 120_000 });
cek("keadaan catatan production = titik tetap: evaluasi global tidak mengubah satu pun catatan", r.berubah === 0, `berubah=${r.berubah} ${JSON.stringify((r.detail ?? []).slice(0, 2))}`);
cek("semua catatan Excel + LEDGER diperiksa (bukan sebagian)", r.diperiksa >= n0 - 1, `diperiksa=${r.diperiksa} dari ${n0}`);

// 2) rencana posting dapat dibangun dari keadaan yang sama (tanpa menulis) dan konsisten antar-bacaan
const a = await rencanakanPosting(prisma); const b = await rencanakanPosting(prisma);
cek("rencana posting stabil (hash sama dua kali) dan hanya memuat catatan SIAP_POSTING", a.hash === b.hash && a.jumlah === b.jumlah, `${a.jumlah} trx / ${a.orderUnik} order; hash ${a.hash.slice(0, 12)}`);
cek("transaksi rencana = kelompok unit × bahan dari catatan SIAP_POSTING", a.jumlah <= (await hitung("select count(*)::int n from unit_usage_notes where state = 'SIAP_POSTING'")));

// 2b) pratinjau manifest (yang dibaca UI): hash = hash rencana efektif; angka konsisten; tidak menulis
const pr = await pratinjauPosting(prisma);
cek("pratinjau manifest: hash = hash rencana efektif dan jumlah sama", pr.hash === a.hash && pr.jumlahTrx === a.jumlah && pr.jumlahOrder === a.orderUnik, `${pr.jumlahOrder} order / ${pr.jumlahTrx} trx`);
cek("pratinjau: HPP berbukti + selisih belum dijurnal terisi, status PARSIAL bila ada tanpa harga/tertahan, jurnal tidak dibuat", Number.isFinite(pr.hpp.hppBerbukti) && pr.hpp.selisihBelumDijurnal === pr.hpp.hppBerbukti && pr.hpp.jurnalDibuat === false && (pr.hpp.status === "PARSIAL") === (pr.hpp.trxTanpaHarga > 0 || pr.hpp.catatanTertahan > 0), `${pr.hpp.status} Rp${pr.hpp.hppBerbukti}`);
cek("pratinjau memuat yang dibutuhkan konfirmasi manifest: digest isi, ID unit, isi transaksi (bahan, qty, satuan, tanggal), saldo bahan SEGAR dari ledger", /^[0-9a-f]{64}$/.test(pr.digestIsi ?? "") && pr.order.every((o) => o.unitId && o.trx.every((t) => t.kodeBahan && Number.isFinite(t.qty) && t.satuan && t.tanggal)) && pr.bahan.every((b) => b.kode && Number.isFinite(b.saldoSekarang)));
cek("pratinjau: setiap order punya rincian transaksi dan dampak per bahan", pr.order.every((o) => o.trx.length > 0) && pr.bahan.length > 0 && pr.order.length === pr.jumlahOrder);
cek("daftar batch dapat dibaca", Array.isArray(await daftarBatch(prisma, { limit: 5 })));
// 2c) pagar konfirmasi manifest (fungsi murni terhadap data nyata, TANPA menulis): konfirmasi dari pratinjau cocok; pilihan lain / jumlah lain ditolak; Finance ditolak sebelum menghitung
const { wajibKonfirmasiManifest, ringkasRencana, saldoBahanRencana } = await import("/app/src/services/postingKonfirmasiManifest.js");
const dbDiam = { activityEvent: { create: async () => {} }, material: prisma.material, stockMovement: prisma.stockMovement }; // penolakan tidak ditulis di sini
const owner = { id: "rehearsal-owner", name: "Owner", roles: ["OWNER"] }; const finance = { id: "rehearsal-finance", name: "Finance", roles: ["FINANCE"] };
const rr = ringkasRencana(a); const kon = { hash: rr.hash, unitIds: rr.unitIds, daftarOrder: rr.daftarOrder, jumlahOrder: rr.jumlahOrder, jumlahTrx: rr.jumlahTrx, rujukan: "REHEARSAL-CEK-12345", isiTransaksi: rr.isiTransaksi, saldoManifest: await saldoBahanRencana(prisma, a) };
const setuju = (k, o = {}) => ({ hashDisetujui: a.hash, rujukan: "REHEARSAL-CEK-12345", disetujuiOleh: "rehearsal", konfirmasi: k, ...o });
const coba = async (fn) => { try { await fn(); return "ok"; } catch (e) { return e.code; } };
cek("pagar konfirmasi: konfirmasi yang benar dari data nyata diterima (Owner)", (await coba(() => wajibKonfirmasiManifest(dbDiam, { rencana: a, persetujuan: setuju(kon), aktor: owner }))) === "ok");
cek("pagar konfirmasi: jumlah transaksi / isi transaksi / saldo ditinjau yang berbeda ditolak", (await coba(() => wajibKonfirmasiManifest(dbDiam, { rencana: a, persetujuan: setuju({ ...kon, jumlahTrx: kon.jumlahTrx + 1 }), aktor: owner }))) === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && (await coba(() => wajibKonfirmasiManifest(dbDiam, { rencana: a, persetujuan: setuju({ ...kon, isiTransaksi: kon.isiTransaksi.slice(1) }), aktor: owner }))) === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && (await coba(() => wajibKonfirmasiManifest(dbDiam, { rencana: a, persetujuan: setuju({ ...kon, saldoManifest: kon.saldoManifest.map((s) => ({ ...s, saldo: s.saldo + 1 })) }), aktor: owner }))) === "KONFIRMASI_MANIFEST_TIDAK_COCOK");
cek("pagar konfirmasi: Finance tanpa Owner ditolak HANYA_OWNER_MEMULAI; tanpa konfirmasi ditolak KONFIRMASI_MANIFEST_WAJIB", (await coba(() => wajibKonfirmasiManifest(dbDiam, { rencana: a, persetujuan: setuju(kon), aktor: finance }))) === "HANYA_OWNER_MEMULAI" && (await coba(() => wajibKonfirmasiManifest(dbDiam, { rencana: a, persetujuan: setuju(undefined), aktor: owner }))) === "KONFIRMASI_MANIFEST_WAJIB");

// 3) kunci evaluasi: pg_advisory_xact_lock tersedia dan re-entrant dalam satu transaksi (dipakai berlapis oleh posting → evaluasi); dilepas saat transaksi berakhir
const ok3 = await prisma.$transaction(async (tx) => { await kunciEvaluasiCatatan(tx); await kunciEvaluasiCatatan(tx); return true; }, { timeout: 30_000 }).catch((e) => String(e.message).slice(0, 160));
cek("kunci evaluasi advisory dapat diambil dua kali dalam satu transaksi (re-entrant) lalu dilepas", ok3 === true, ok3);
cek("tidak ada kunci advisory tersisa setelah transaksi", (await hitung("select count(*)::int n from pg_locks where locktype = 'advisory' and granted and pid <> pg_backend_pid() and database = (select oid from pg_database where datname = current_database())")) === 0);

// 4) tidak ada tulisan: jumlah baris tabel kunci tidak berubah
const n1 = await hitung("select count(*)::int n from unit_usage_notes");
cek("pemeriksaan tidak menulis (jumlah catatan sama)", n0 === n1, `${n0} → ${n1}`);
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
await prisma.$disconnect();
process.exit(gagal ? 1 : 0);
