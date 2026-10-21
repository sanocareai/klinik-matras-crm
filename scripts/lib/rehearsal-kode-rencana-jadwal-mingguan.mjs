// Pemeriksaan KODE BARU terhadap data restore yang SUDAH dimigrasi (rehearsal mode image; BACA-SAJA — tidak ada tulisan). Dijalankan di container backend baru dengan DATABASE_URL = DB rehearsal.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const { getMinggu, getHari, getAntrean, parseAntreanQuery } = await import("/app/src/services/productionRencanaJadwalService.js");
const { isHariKerja } = await import("/app/src/lib/domain/productionRencanaAdmin.js");
let gagal = 0; const cek = (n, ok, d = "") => { if (!ok) gagal += 1; console.log((ok ? "PASS " : "FAIL ") + n + (d !== "" ? " — " + String(d).slice(0, 200) : "")); };
const hitung = async (sql) => Number((await prisma.$queryRawUnsafe(sql))[0].n);
const TABEL = { sm: "stock_movements", unit: "units", job: "jobs", run: "production_runs_v2", plan: "production_run_plans_v2", qc: "quality_inspections_v2", jur: "fin_journal_entries", cmd: "v2_commands", act: "activity_events", serah: "unit_custody_handoffs_v2", outbox: "domain_outbox", order: "\"Order\"", rec: "unit_workshop_receipts" };
const snap = async () => Object.fromEntries(await Promise.all(Object.entries(TABEL).map(async ([k, t]) => [k, await hitung(`select count(*)::int n from ${t}`)])));
const awal = await snap();
cek("data restore memuat unit nyata", awal.unit > 0, "unit=" + awal.unit);
for (const t of ["production_unit_schedules", "production_unit_schedule_events"]) cek(`tabel baru ${t} kosong (tanpa backfill)`, (await hitung(`select count(*)::int n from ${t}`)) === 0);

// ── Kalender minggu: aturan hari kerja + hitungan = database ──
const hari = (n) => new Date(Date.now() + 7 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const mg = await getMinggu(prisma, { start: hari(0) });
cek("kalender minggu: 7 hari, Senin–Sabtu 12 slot, Minggu libur kapasitas 0, total 72 slot", mg.days.length === 7 && mg.kapasitas.totalMinggu === 72 && mg.ringkasan.slotKerja === 72 && mg.days.every((d) => d.hariKerja === isHariKerja(d.date) && d.kapasitas === (isHariKerja(d.date) ? 12 : 0)));
const v2Rentang = await hitung(`select count(*)::int n from production_run_plans_v2 p join production_runs_v2 r on r.id = p.run_id where p.production_date between '${mg.start}' and '${mg.end}' and p.status::text <> 'CANCELLED' and r.status::text <> 'CANCELLED'`);
cek("jumlah rencana Meja pada minggu ini = database (belum ada jadwal Admin)", mg.days.reduce((a, d) => a + d.v2, 0) === v2Rentang && mg.days.every((d) => d.admin === 0), `kalender=${mg.days.reduce((a, d) => a + d.v2, 0)} sql=${v2Rentang}`);
cek("ringkasan minggu: terencana hanya hari kerja, hari libur dilaporkan terpisah", mg.ringkasan.terencanaKerja + mg.ringkasan.diLuarHariKerja === mg.days.reduce((a, d) => a + d.terencana, 0));
const hariAda = mg.days.find((d) => d.terencana > 0);
if (hariAda) { const hr = await getHari(prisma, { date: hariAda.date }); cek(`rincian hari ${hariAda.date}: jumlah unit = kalender`, hr.stations.reduce((a, s) => a + s.items.length, 0) + hr.tanpaMeja.length === hariAda.terencana && [...hr.stations.flatMap((s) => s.items), ...hr.tanpaMeja].every((i) => i.sumber === "V2")); } else console.log("INFO tidak ada rencana Meja pada minggu ini di restore (rincian hari dilewati)");

// ── Antrean: tab saling lepas dan jumlahnya = semua; unit batal/terkirim/spam tidak ada ──
const sem = await getAntrean(prisma, { query: parseAntreanQuery({ tab: "SEMUA", pageSize: "100" }) });
const sqlKandidat = await hitung(`select count(*)::int n from units u join "Order" o on o.id = u.order_id join "Customer" c on c.id = o."customerId" where u.status::text not in ('CANCELLED','READY_FOR_DELIVERY','READY_ON_CUSTOMER_HOLD','IN_TRANSIT_OUT','DELIVERED') and o.status::text <> 'CANCELLED' and c."pipelineStage"::text <> 'SPAM' and c.is_internal_staff = false`);
cek("antrean SEMUA = unit aktif di database (bukan batal/terkirim/spam/internal)", sem.total === sqlKandidat && !sem.truncated, `${sem.total}/${sqlKandidat}`);
const jumlahTab = ["SIAP", "KEPUTUSAN", "MENUNGGU_TIBA", "TERJADWAL"].reduce((a, t) => a + sem.counts[t], 0);
cek("tab antrean saling lepas dan berjumlah sama dengan SEMUA", jumlahTab === sem.counts.SEMUA, JSON.stringify(sem.counts));
cek("setiap kartu antrean punya alasan konkret + status bahan + posisi + revisi jadwal", sem.items.every((i) => typeof i.alasan === "string" && i.alasan.length > 3 && i.bahan?.key && i.posisi?.key && "revisiJadwal" in i && i.unitCas));
const keputusan = await getAntrean(prisma, { query: parseAntreanQuery({ tab: "KEPUTUSAN", pageSize: "100" }) });
cek("Butuh keputusan selalu menyebut penyebab dan langkah berikutnya", keputusan.items.every((i) => i.perluKeputusan && i.alasan && i.tindakanBerikut));
const cari = sem.items[0]; if (cari) { const q = await getAntrean(prisma, { query: parseAntreanQuery({ tab: "SEMUA", q: cari.unitCode }) }); cek("pencarian kode unit menemukan unitnya", q.items.some((i) => i.unitId === cari.unitId)); }
console.log(`INFO antrean: ${JSON.stringify(sem.counts)}; minggu ${mg.start}: terencana hari kerja=${mg.ringkasan.terencanaKerja}`);

// ── tidak ada tulisan ──
const akhir = await snap();
for (const k of Object.keys(awal)) cek(`tidak ada tulisan: ${k} tetap ${awal[k]}`, akhir[k] === awal[k]);
for (const t of ["production_unit_schedules", "production_unit_schedule_events"]) cek(`tidak ada tulisan: ${t} tetap kosong`, (await hitung(`select count(*)::int n from ${t}`)) === 0);
await prisma.$disconnect();
console.log("REHEARSAL_KODE_BARU gagal=" + gagal);
process.exit(gagal ? 1 : 0);
