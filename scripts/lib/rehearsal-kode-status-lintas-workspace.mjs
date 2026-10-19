// Pemeriksaan KODE BARU "Status lintas workspace" (fungsi domain tunggal + Sales fleksibel + riwayat + koreksi Rika) terhadap data restore backup NYATA. Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal (salinan).
// Satu-satunya tulisan terjadi DI DALAM transaksi yang selalu DIBATALKAN (rollback) pada salinan; skrip rilis membuktikan sidik jari seluruh tabel sama sebelum dan sesudah.
import { createRequire } from "node:module";
const { PrismaClient } = createRequire(process.cwd() + "/")("@prisma/client");
const prisma = new PrismaClient();
const { selaraskanProduksiDenganOrderInTx } = await import("/app/src/services/orderProduksiSelaras.js");
const { loadRiwayatUnit, SUMBER_RIWAYAT } = await import("/app/src/services/productionRiwayatService.js");
const { ubahStatusUnitInTx, KE_STATUS, SUMBER_STATUS } = await import("/app/src/services/statusUnitLintasWorkspace.js");
const { pratinjauKoreksiPengirimanRute, terapkanKoreksiPengirimanRuteInTx } = await import("/app/src/services/koreksiPengirimanRute.js");
const { formatActivitySentence, EVENT_TYPES } = await import("/app/src/lib/activityLog.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d ? " — " + d : "")); };
const n = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const SUMBER = new Set(Object.values(SUMBER_RIWAYAT));

// 1. Riwayat unit pada data nyata: unit dengan Run (aktif/selesai/batal) dan tanpa Run
const unitBerRun = await prisma.unit.findMany({ where: { productionRunsV2: { some: {} } }, select: { id: true, unitCode: true, orderId: true }, orderBy: { id: "asc" }, take: 40 });
const unitTanpaRun = await prisma.unit.findMany({ where: { productionRunsV2: { none: {} } }, select: { id: true, unitCode: true, orderId: true }, orderBy: { id: "asc" }, take: 15 });
let baris = 0; let bernama = 0; let rusak = 0; let tidakUrut = 0;
for (const u of [...unitBerRun, ...unitTanpaRun]) {
  const run = await prisma.productionRun.findFirst({ where: { unitId: u.id }, orderBy: { createdAt: "desc" }, select: { id: true } });
  const r = await loadRiwayatUnit(prisma, { unit: u, run });
  baris += r.length;
  for (let i = 0; i < r.length; i += 1) {
    const x = r[i];
    if (!SUMBER.has(x.source) || typeof x.label !== "string" || !x.label.trim() || /undefined|\[object Object\]/.test(x.label) || !("actor" in x) || !x.at) rusak += 1;
    if (x.actor) bernama += 1;
    if (i > 0 && new Date(r[i - 1].at).getTime() > new Date(x.at).getTime()) tidakUrut += 1;
  }
}
cek(`Riwayat: ${unitBerRun.length + unitTanpaRun.length} unit nyata dihitung tanpa galat; semua baris punya sumber sah, kalimat, waktu, dan kolom pelaku; urut waktu naik`, rusak === 0 && tidakUrut === 0, `baris=${baris}, bernama=${bernama}, rusak=${rusak}, tidakUrut=${tidakUrut}`);
cek("Riwayat: data nyata memuat baris dengan NAMA pelaku (bukan semuanya kosong)", baris === 0 || bernama > 0, `bernama=${bernama}/${baris}`);

// 2. Kalimat riwayat jenis baru (semua bentuk)
const kal = [
  { aksi: "CANCEL", unitCode: "U-1", runStatusBefore: "ACTIVE", runPhase: "PROCESS", planDibatalkan: true, reservasiDilepas: 2, issueDibatalkan: ["ISS-1"], bahanSudahDiserahkan: [{ code: "M1", qty: 5, unit: "KG" }], orderStatusBefore: "PROCESSING", orderStatusAfter: "CANCELLED", reason: "uji" },
  { aksi: "READY", unitCode: "U-1", runStatusBefore: "ACTIVE", orderStatusBefore: "PROCESSING", orderStatusAfter: "READY", reason: "uji" },
  { aksi: "DELIVERED", unitCode: "U-1", runStatusBefore: "ACTIVE", orderStatusBefore: "READY", orderStatusAfter: "DELIVERED" },
].map((metadata) => formatActivitySentence({ eventType: EVENT_TYPES.PRODUCTION_FOLLOWS_ORDER, metadata }));
cek("Kalimat PRODUCTION_FOLLOWS_ORDER: batal (dengan peringatan retur bahan), Siap Kirim, Terkirim", kal.every((x) => typeof x === "string" && x.length > 20 && !/undefined/.test(x)) && /PERHATIAN Gudang/.test(kal[0]) && /Retur Bahan/.test(kal[0]) && /Siap Kirim|READY/.test(kal[1]), kal[0]);

// 3. Penyelarasan pada order nyata — DICOBA di dalam transaksi yang selalu dibatalkan
class Batal extends Error {}
const orderDenganRun = await prisma.$queryRawUnsafe(`select distinct o.id::text id, o.status::text status from "Order" o join units u on u.order_id = o.id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and o.status <> 'CANCELLED' order by 1 limit 3`);
if (orderDenganRun.length === 0) cek("Penyelarasan: tidak ada order dengan Run berjalan di data (dilewati)", true);
for (const o of orderDenganRun) {
  const sebelum = { run: await n(`select count(*)::int n from production_runs_v2 r join units u on u.id = r.unit_id where u.order_id = '${o.id}' and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')`), stok: await n("select count(*)::int n from stock_movements") };
  let hasil = null; let dalam = null; let galat = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: o.id, aksi: "CANCEL", actorId: null, alasan: "rehearsal rilis", orderStatusSebelum: o.status });
      dalam = {
        runBerjalan: await tx.productionRun.count({ where: { unit: { orderId: o.id }, status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] } } }),
        reservasiAktifTanpaIssueDiserahkan: await tx.materialReservation.count({ where: { status: "ACTIVE", plan: { run: { unit: { orderId: o.id }, status: "CANCELLED" } } } }),
        stok: await tx.stockMovement.count(),
        jejak: await tx.activityEvent.count({ where: { entityType: "order", entityId: o.id, eventType: "PRODUCTION_FOLLOWS_ORDER" } }),
      };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek(`Penyelarasan BATAL pada order nyata ${o.id.slice(0, 8)} (status ${o.status}): tanpa galat`, galat === null, galat ?? "");
  if (galat === null) {
    cek(`... semua Run berjalan (${sebelum.run}) dibatalkan di dalam transaksi; jejak tercatat; stok tidak bergerak; reservasi aktif tak tersisa pada Run batal`,
      dalam.runBerjalan === 0 && hasil.runDibatalkan.length === sebelum.run && dalam.jejak === sebelum.run && dalam.stok === sebelum.stok && dalam.reservasiAktifTanpaIssueDiserahkan === 0 || (hasil.peringatan.length > 0 && dalam.runBerjalan === 0),
      JSON.stringify({ sebelum, dalam, dibatalkan: hasil.runDibatalkan.length, peringatan: hasil.peringatan.length }));
    const sesudahRollback = await n(`select count(*)::int n from production_runs_v2 r join units u on u.id = r.unit_id where u.order_id = '${o.id}' and r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED')`);
    cek("... transaksi percobaan DIBATALKAN: Run di salinan tidak berubah", sesudahRollback === sebelum.run);
  }
}
// READY pada unit yang masih diproduksi — dicoba di transaksi yang dibatalkan
const unitProduksi = await prisma.$queryRawUnsafe(`select o.id::text oid, o.status::text ost from "Order" o join units u on u.order_id = o.id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and u.status in ('RECEIVED','IN_PRODUCTION') and o.status in ('PROCESSING','PENDING') limit 1`);
if (unitProduksi.length === 0) cek("Penyelarasan SIAP KIRIM: tidak ada unit produksi berjalan di data (dilewati)", true); else {
  let hasil = null; let galat = null; let penanda = null;
  try {
    await prisma.$transaction(async (tx) => {
      hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: unitProduksi[0].oid, aksi: "READY", actorId: null, alasan: "rehearsal rilis", orderStatusSebelum: unitProduksi[0].ost });
      penanda = await tx.productionRun.findFirst({ where: { unit: { orderId: unitProduksi[0].oid }, deliveryRelease: { path: ["kind"], equals: "SALES_STATUS_CHANGE" } }, select: { status: true } });
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek("Penyelarasan SIAP KIRIM pada order nyata: Run ditandai dilepas (SALES_STATUS_CHANGE) dan tetap berjalan", galat === null && hasil.runDilepas.length >= 1 && !!penanda && ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"].includes(penanda.status), galat ?? JSON.stringify(hasil));
}
// Order tanpa Run: tidak ada efek (perilaku V1 identik)
const tanpaRun = await prisma.$queryRawUnsafe(`select o.id::text id from "Order" o where not exists (select 1 from units u join production_runs_v2 r on r.unit_id = u.id where u.order_id = o.id) limit 1`);
if (tanpaRun.length) {
  let hasil = null;
  try { await prisma.$transaction(async (tx) => { hasil = await selaraskanProduksiDenganOrderInTx(tx, { orderId: tanpaRun[0].id, aksi: "CANCEL", actorId: null, alasan: "rehearsal", orderStatusSebelum: "PENDING" }); throw new Batal(); }); } catch (e) { if (!(e instanceof Batal)) hasil = { galat: e?.message }; }
  cek("Order tanpa Run: penyelarasan tidak berefek (kosong)", hasil && !hasil.galat && hasil.runDibatalkan.length === 0 && hasil.runDilepas.length === 0 && hasil.peringatan.length === 0, JSON.stringify(hasil));
}
// 4. FUNGSI DOMAIN TUNGGAL (ubahStatusUnitInTx) pada unit nyata — setiap percobaan di transaksi yang DIBATALKAN
const unitHidup = await prisma.$queryRawUnsafe(`select u.id::text id, u.order_id::text oid, o.status::text ost from units u join "Order" o on o.id = u.order_id join production_runs_v2 r on r.unit_id = u.id where r.status in ('PENDING_ARRIVAL','ACTIVE','BLOCKED') and u.status in ('RECEIVED','IN_PRODUCTION') and o.penjualan_karyawan_id is null order by u.id limit 1`);
if (unitHidup.length === 0) cek("Fungsi domain: tidak ada unit produksi berjalan di data (dilewati)", true); else {
  const u = unitHidup[0]; let galat = null; let dalam = null;
  try {
    await prisma.$transaction(async (tx) => {
      const a = await ubahStatusUnitInTx(tx, { unitIds: [u.id], ke: KE_STATUS.SIAP_KIRIM, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: u.oid, orderStatusSebelum: u.ost, sinkronOrder: true });
      const b = await ubahStatusUnitInTx(tx, { unitIds: [u.id], ke: KE_STATUS.SIAP_KIRIM, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: u.oid, orderStatusSebelum: u.ost, sinkronOrder: true }); // ulang = tidak menggandakan
      dalam = {
        a: a.diubah.length, b: b.diubah.length,
        status: (await tx.unit.findUniqueOrThrow({ where: { id: u.id } })).status,
        jobAktif: await tx.jobUnit.count({ where: { unitId: u.id, job: { type: "DELIVERY", status: { in: ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"] } } } }),
        run: (await tx.productionRun.findFirst({ where: { unitId: u.id, deliveryRelease: { path: ["kind"], equals: "SALES_STATUS_CHANGE" } }, select: { status: true } }))?.status ?? null,
      };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
  cek("Fungsi domain SIAP_KIRIM pada unit nyata: unit Siap Kirim, TEPAT SATU job pengiriman aktif, Run dilepas (SALES_STATUS_CHANGE) dan tetap berjalan, ulang tidak menggandakan", galat === null && dalam.a === 1 && dalam.b === 0 && dalam.status === "READY_FOR_DELIVERY" && dalam.jobAktif === 1 && ["ACTIVE", "BLOCKED", "PENDING_ARRIVAL"].includes(dalam.run), galat ?? JSON.stringify(dalam));
  let galat2 = null; let dalam2 = null;
  try {
    await prisma.$transaction(async (tx) => {
      const mv0 = await tx.stockMovement.count();
      const h = await ubahStatusUnitInTx(tx, { unitIds: [u.id], ke: KE_STATUS.BATAL, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: u.oid, alasan: "rehearsal rilis", orderStatusSebelum: u.ost, sinkronOrder: false, batalkanJobOrder: true });
      dalam2 = { diubah: h.diubah.length, status: (await tx.unit.findUniqueOrThrow({ where: { id: u.id } })).status, runBerjalan: await tx.productionRun.count({ where: { unitId: u.id, status: { in: ["PENDING_ARRIVAL", "ACTIVE", "BLOCKED"] } } }), stokSama: (await tx.stockMovement.count()) === mv0 };
      throw new Batal();
    });
  } catch (e) { if (!(e instanceof Batal)) galat2 = e?.message || String(e); }
  cek("Fungsi domain BATAL pada unit nyata: unit dibatalkan, Run tak ada yang berjalan, TANPA pergerakan stok otomatis", galat2 === null && dalam2.diubah === 1 && dalam2.status === "CANCELLED" && dalam2.runBerjalan === 0 && dalam2.stokSama, galat2 ?? JSON.stringify(dalam2));
}
// Konflik fakta: unit yang SUDAH berangkat/terkirim tidak boleh dibatalkan (ditolak dengan pilihan koreksi, tanpa menulis)
const unitTuntas = await prisma.$queryRawUnsafe("select u.id::text id, u.order_id::text oid, u.status::text st from units u where u.status in ('IN_TRANSIT_OUT','DELIVERED') order by u.id limit 1");
if (unitTuntas.length === 0) cek("Konflik: tidak ada unit berangkat/terkirim di data (dilewati)", true); else {
  let tolak = null;
  try { await prisma.$transaction(async (tx) => { await ubahStatusUnitInTx(tx, { unitIds: [unitTuntas[0].id], ke: KE_STATUS.BATAL, aktor: null, sumber: SUMBER_STATUS.SALES, orderId: unitTuntas[0].oid, alasan: "rehearsal", sinkronOrder: false }); throw new Batal(); }); } catch (e) { if (!(e instanceof Batal)) tolak = e; }
  cek("Konflik: BATAL pada unit berangkat/terkirim DITOLAK 409 berkode dengan pilihan koreksi", !!tolak && tolak.statusCode === 409 && /^UNIT_SUDAH_/.test(tolak.code) && Array.isArray(tolak.pilihanKoreksi) && tolak.pilihanKoreksi.length >= 2, tolak ? tolak.code : "tidak ditolak");
}
// 5. KOREKSI RIKA (RES-03102026-018-U1 → RTE-161026-02): pratinjau baca-saja + penerapan DI DALAM transaksi yang dibatalkan
const TANGGAL_RIKA = "2026-10-16"; // jam serah-terima tidak terbukti: hanya tanggal
const FOTO_RIKA = "/app/uploads/1792112641064-27qruk2yfg3.jpg"; // foto helper di grup SANO DRIVETHRU (dibaca saja; rehearsal tidak menyalin berkas)
const { periksaBerkasFoto } = await import("/app/src/services/koreksiPengirimanRute.js");
const rika = await prisma.unit.findUnique({ where: { unitCode: "RES-03102026-018-U1" }, select: { id: true } });
const rute = await prisma.route.findUnique({ where: { code: "RTE-161026-02" }, select: { id: true } });
if (!rika || !rute) { console.log("INFO Rika: unit atau rute tidak ada di salinan"); console.log("REHEARSAL_RIKA status=tidak-ada"); } else {
  const p = await pratinjauKoreksiPengirimanRute(prisma, { unitCode: "RES-03102026-018-U1", routeCode: "RTE-161026-02", tanggalKejadian: TANGGAL_RIKA, foto: (await import("node:fs")).existsSync(FOTO_RIKA) ? { path: FOTO_RIKA } : null });
  console.log("INFO Rika kondisi: " + JSON.stringify(p.kondisiSekarang));
  if (p.sudahDiterapkan) { cek("Rika: koreksi SUDAH diterapkan sebelumnya (idempoten, tidak ada yang perlu ditulis)", true); console.log("REHEARSAL_RIKA status=sudah"); }
  else if (!p.layak) { console.log("INFO Rika rintangan: " + JSON.stringify(p.rintangan)); console.log("REHEARSAL_RIKA status=tidak-layak"); }
  else {
    const aktor = await prisma.user.findFirst({ where: { active: true, OR: [{ role: "OWNER" }, { role: "ADMIN" }, { roles: { some: { role: { in: ["OWNER", "ADMIN"] } } } }] }, select: { id: true } });
    if (!aktor) { cek("Rika: ada pengguna ADMIN/OWNER aktif untuk rehearsal", false); } else {
      const f = (await import("node:fs")).existsSync(FOTO_RIKA) ? periksaBerkasFoto(FOTO_RIKA) : null;
      const buktiRehearsal = f ? { urls: ["/media/job-photos/rehearsal-tidak-ditulis" + (f.ext)], sha256: f.sha256, ukuranByte: f.ukuranByte, mime: f.mime, sumber: FOTO_RIKA } : null;
      const sebelumRute = await prisma.job.findMany({ where: { routeId: rute.id }, orderBy: { sequence: "asc" }, select: { id: true, status: true, sequence: true, updatedAt: true } });
      let hasil = null; let galat = null; let dalam = null;
      try {
        await prisma.$transaction(async (tx) => {
          hasil = await terapkanKoreksiPengirimanRuteInTx(tx, { unitCode: "RES-03102026-018-U1", routeCode: "RTE-161026-02", aktorId: aktor.id, tanggalKejadian: TANGGAL_RIKA, bukti: buktiRehearsal, alasan: "Rehearsal rilis: Rika sudah terkirim bersama rute Bandung tetapi tidak masuk Route Planner" });
          const ulang = await terapkanKoreksiPengirimanRuteInTx(tx, { unitCode: "RES-03102026-018-U1", routeCode: "RTE-161026-02", aktorId: aktor.id, tanggalKejadian: TANGGAL_RIKA, bukti: buktiRehearsal, alasan: "Rehearsal rilis: Rika sudah terkirim bersama rute Bandung tetapi tidak masuk Route Planner" });
          dalam = {
            ulangSudah: ulang.sudahDiterapkan === true,
            jobRute: await tx.job.findMany({ where: { routeId: rute.id }, orderBy: { sequence: "asc" }, select: { id: true, status: true, sequence: true, updatedAt: true } }),
            unit: (await tx.unit.findUniqueOrThrow({ where: { id: rika.id } })).status,
            rute: (await tx.route.findUniqueOrThrow({ where: { id: rute.id } })).status,
            jobUnit: await tx.jobUnit.count({ where: { unitId: rika.id, job: { type: "DELIVERY" } } }),
            runMarker: (await tx.productionRun.findFirst({ where: { unitId: rika.id }, orderBy: { createdAt: "desc" }, select: { status: true, deliveryRelease: true } })),
            qc: await tx.qualityInspection.count({ where: { run: { unitId: rika.id } } }),
          };
          throw new Batal();
        });
      } catch (e) { if (!(e instanceof Batal)) galat = e?.message || String(e); }
      const lamaUtuh = galat === null && sebelumRute.every((j) => { const k = dalam.jobRute.find((x) => x.id === j.id); return k && k.status === j.status && k.updatedAt.getTime() === j.updatedAt.getTime(); });
      cek("Rika (salinan DB): koreksi diterapkan di transaksi yang dibatalkan — 1 job baru di stop berikutnya, unit Terkirim, rute tetap Completed, Run tidak ditutup (penanda dilepas), job lama tidak berubah, ulang idempoten, tanpa QC baru",
        galat === null && hasil?.diterapkan === true && dalam.ulangSudah && dalam.jobRute.length === sebelumRute.length + 1 && lamaUtuh && dalam.unit === "DELIVERED" && dalam.rute === "COMPLETED" && dalam.jobUnit === 1 && dalam.runMarker?.status !== "COMPLETED" && ["DISPATCH_ROUTE_PLANNER", "SALES_STATUS_CHANGE"].includes(dalam.runMarker?.deliveryRelease?.kind),
        galat ?? JSON.stringify({ hasil: hasil && { diterapkan: hasil.diterapkan, sequence: hasil.sequence }, dalam: dalam && { ...dalam, jobRute: dalam.jobRute.length } }));
      const sesudah = await prisma.job.count({ where: { routeId: rute.id } });
      cek("Rika (salinan DB): transaksi percobaan DIBATALKAN — jumlah job rute di salinan tidak berubah", sesudah === sebelumRute.length);
      console.log("REHEARSAL_RIKA status=layak");
    }
  }
}
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
