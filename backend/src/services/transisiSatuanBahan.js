// TRANSISI SATUAN BAHAN (Nov 2026) — mengubah satuan stok master dengan MENJAGA identitas material dan arti ledger.
//
// Masalah: ledger menyimpan qty tanpa satuan (satuannya = materials.unit). Mengganti materials.unit begitu saja membuat seluruh riwayat berlabel satuan baru, dan penyesuaian numerik sesudahnya mencampur satuan.
// Desain (migrasi 20261231120000):
//   • Setiap pergerakan membawa satuan SAAT dicatat (stock_movements.unit_at_entry; trigger DB mengisinya dari master dengan FOR SHARE, jadi penulisan serentak tidak bisa salah satuan).
//   • Transisi = SATU transaksi: kunci bahan → cocokkan pratinjau → pengaman historis → ADJUSTMENT penutup saldo lama (bersatuan lama) → ganti satuan master → ADJUSTMENT pembuka saldo awal (bersatuan baru)
//     → dokumen transisi append-only. Sesudah commit, SUM(qty) LANGSUNG berupa saldo dalam satuan baru; tidak pernah ada saat saldo lama berlabel satuan baru.
//   • Ditolak bila pergerakan/saldo/catatan/penghalang berubah dari pratinjau (hash), bila ada dokumen terbuka berbasis satuan lama (penyesuaian, GR, PO), atau bila catatan historis EXCEL belum diposting dan belum
//     ada tautan SO (tautan bisa dipasang di transaksi yang SAMA, sebelum satuan baru terlihat).
//   • Harga Berlaku, PO, GR, valuasi, jurnal, dan pergerakan lama TIDAK disentuh dan tetap berisi satuan asalnya. Harga bersatuan lama tidak pernah dipakai sebagai harga satuan baru (laporan: 'Satuan tidak cocok').
//   • Kewajiban konversi terbuka (mis. penerimaan dalam satuan lama yang belum bisa diterjemahkan) disimpan di dokumen; saldo baru berstatus cakupan PARSIAL selama kewajiban itu ada.
//   Tidak ada posting historis, jurnal, valuasi, pemetaan catatan, atau deklarasi.
import crypto from "node:crypto";
import { MaterialUnit } from "@prisma/client";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { postStockMovement, lockRowForUpdate } from "./inventoryLedger.js";
import { KoreksiError } from "./warehouseCorrection.js";
import { tautanSOAktif } from "./pengamanHistorisPascaSO.js";
import { muatAturanSatuanPakai } from "./satuanPakaiService.js";
import { aturanUntukBahan } from "../lib/domain/satuanPakaiBahan.js";
import { selisihTransfer } from "./selisihTransfer.js";
import { satuanCatatanPer } from "./referensiHargaSatuan.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;
const MAKS_GERAKAN = 20000;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const wajib = (c, m, code, status = 400, extra = null) => { if (!c) throw new KoreksiError(m, status, code, extra); };
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const batasDariTanggal = (tgl) => new Date(`${tgl}T23:59:59.999+07:00`);
const sha = (x) => crypto.createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const wajibPenyetuju = (aktor) => {
  wajib(aktor?.id, "Pelaku wajib ada", "PELAKU_WAJIB", 401);
  wajib(hasPermission(aktor, P.INVENTORY_ADJUSTMENT_APPROVE), "Hanya penyetuju (inventory:adjustment_approve) yang boleh menjalankan transisi satuan", "BUKAN_PENYETUJU", 403);
  wajib(hasPermission(aktor, P.INVENTORY_WRITE), "Transisi satuan wajib izin inventory:write", "TANPA_IZIN_STOK", 403);
};

function rapikanKewajiban(arr) {
  const a = Array.isArray(arr) ? arr : []; wajib(a.length <= 20, "kewajiban konversi terbuka maksimum 20 butir", "KEWAJIBAN_TIDAK_VALID");
  return a.map((k, i) => {
    const jumlah = Number(k?.jumlah); const satuan = norm(k?.satuan).toUpperCase(); const rujukan = norm(k?.rujukan); const keterangan = norm(k?.keterangan);
    wajib(rujukan.length >= 3 && rujukan.length <= 120 && Number.isFinite(jumlah) && jumlah !== 0 && Math.abs(r4(jumlah) - jumlah) < 1e-9 && Object.values(MaterialUnit).includes(satuan), `kewajiban konversi #${i + 1} tidak valid (rujukan, jumlah ≠ 0, satuan lama sah)`, "KEWAJIBAN_TIDAK_VALID");
    return { rujukan, jumlah: r4(jumlah), satuan, keterangan: keterangan.slice(0, 300) };
  });
}

/** Keadaan bahan SAAT INI (satu potret; dipanggil dengan `prisma` untuk pratinjau atau `tx` setelah kunci untuk penerapan). Baca-saja. */
/** Setara satuan baru untuk kewajiban terbuka, HANYA bila ada aturan satuan pakai berlaku (bawaan Owner/penimpaan tercatat) untuk bahan ini dengan satuan stok = satuan kewajiban dan satuan pakai = satuan baru. Informasi; tidak memposting apa pun. */
function perkayaKewajiban(kewajiban, m, satuanBaru, aturanSemua) {
  const aturan = aturanUntukBahan({ code: m.code, unit: m.unit }, aturanSemua);
  return kewajiban.map((k) => (aturan && aturan.satuanStok === k.satuan && aturan.satuanPakai === satuanBaru
    ? { ...k, setara: { jumlah: r4(k.jumlah * aturan.faktor), satuan: satuanBaru, faktor: aturan.faktor, dasar: aturan.sumber ?? "ATURAN_SATUAN_PAKAI" } }
    : { ...k, setara: null }));
}

async function ambilKeadaan(db, materialId, { satuanBaru, saldoBaru, kewajiban }) {
  const m = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true, category: true, active: true, reorderPoint: true, reorderQty: true, dataNote: true } });
  wajib(m, "bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  kewajiban = perkayaKewajiban(kewajiban, m, satuanBaru, await muatAturanSatuanPakai(db));
  const gerak = await db.stockMovement.findMany({ where: { materialId }, select: { id: true, qty: true, createdAt: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAKS_GERAKAN + 1 });
  wajib(gerak.length <= MAKS_GERAKAN, `pergerakan bahan terlalu banyak untuk transisi satu langkah (>${MAKS_GERAKAN})`, "GERAKAN_TERLALU_BANYAK", 422);
  const saldoLama = r4(gerak.reduce((a, x) => a + Number(x.qty), 0));
  const digest = sha(gerak.map((x) => `${x.id}|${Number(x.qty).toFixed(4)}|${x.createdAt.toISOString()}`).join("\n"));
  const n1 = async (q, ...a) => Number((await db.$queryRawUnsafe(q, ...a))[0].n);
  const catatan = await db.unitUsageNote.findMany({ where: { materialId, origin: "EXCEL", state: { in: ["SIAP_POSTING", "PERLU_DICEK"] } }, select: { qty: true } });
  const ukur = {
    penyesuaianTerbuka: await n1("SELECT COUNT(*)::int n FROM stock_adjustment_requests WHERE material_id = $1::uuid AND status::text NOT IN ('POSTED','REJECTED','CANCELLED','VOID')", materialId),
    grTerbuka: await n1("SELECT COUNT(*)::int n FROM goods_receipt_lines l JOIN goods_receipts g ON g.id = l.goods_receipt_id WHERE l.material_id = $1::uuid AND g.status::text NOT IN ('COMPLETED','REJECTED','CANCELLED')", materialId),
    poTerbuka: await n1("SELECT COUNT(*)::int n FROM fin_purchase_order_lines l JOIN fin_purchase_orders o ON o.id = l.purchase_order_id WHERE l.material_id = $1::uuid AND o.status::text NOT IN ('SELESAI','DIBATALKAN')", materialId),
    bom: await n1("SELECT COUNT(*)::int n FROM planned_bom_lines_v2 WHERE material_id = $1::uuid", materialId),
    rencanaProduksi: await n1("SELECT COUNT(*)::int n FROM production_unit_material_plans p CROSS JOIN LATERAL jsonb_array_elements(p.lines::jsonb) l WHERE l->>'materialId' = $1", materialId),
    reservasi: await n1("SELECT COUNT(*)::int n FROM material_reservations_v2 WHERE material_id = $1::uuid", materialId),
    katalogSupplier: await n1("SELECT COUNT(*)::int n FROM fin_supplier_materials WHERE material_id = $1::uuid", materialId),
    permintaanReplenishment: await n1("SELECT COUNT(*)::int n FROM replenishment_requests WHERE material_id = $1::uuid", materialId),
    transferBerjalan: await n1("SELECT COUNT(*)::int n FROM stock_transfer_lines l JOIN stock_transfers t ON t.id = l.stock_transfer_id WHERE l.material_id = $1::uuid AND t.status::text IN ('DRAFT','WAITING_APPROVAL','APPROVED','PICKED','IN_TRANSIT')", materialId),
    selisihTransferTerbuka: await selisihTransferTerbukaBahan(db, materialId),
    poSeluruh: await n1("SELECT COUNT(*)::int n FROM fin_purchase_order_lines WHERE material_id = $1::uuid", materialId),
    grSeluruh: await n1("SELECT COUNT(*)::int n FROM goods_receipt_lines WHERE material_id = $1::uuid", materialId),
  };
  const harga = await db.materialHargaBerlaku.findMany({ where: { materialId }, select: { satuan: true, unitPrice: true, effectiveFrom: true }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }] });
  const tautanAktif = (await tautanSOAktif(db, [materialId])).get(materialId) ?? null;
  const penghalang = [];
  const tambah = (kode, pesan) => penghalang.push({ kode, pesan });
  if (!m.active) tambah("BAHAN_NONAKTIF", "bahan nonaktif");
  if (m.unit === satuanBaru) tambah("SATUAN_SAMA", `satuan master sudah ${satuanBaru}`);
  if (ukur.penyesuaianTerbuka) tambah("PENYESUAIAN_TERBUKA", `${ukur.penyesuaianTerbuka} permintaan penyesuaian belum selesai (berbasis satuan lama)`);
  if (ukur.grTerbuka) tambah("GR_TERBUKA", `${ukur.grTerbuka} baris penerimaan belum selesai (berbasis satuan lama)`);
  if (ukur.poTerbuka) tambah("PO_TERBUKA", `${ukur.poTerbuka} baris PO belum selesai/dibatalkan (berbasis satuan lama)`);
  if (ukur.transferBerjalan) tambah("TRANSFER_BERJALAN", `${ukur.transferBerjalan} baris transfer stok belum selesai (jumlah kirim/terima berbasis satuan lama)`);
  if (ukur.selisihTransferTerbuka) tambah("SELISIH_TRANSFER_TERBUKA", `${ukur.selisihTransferTerbuka} baris transfer selesai masih punya selisih kirim/terima yang belum diselesaikan (berbasis satuan lama)`);
  if (ukur.bom) tambah("BOM_ADA", `${ukur.bom} baris BOM merujuk bahan ini`);
  if (ukur.rencanaProduksi) tambah("RENCANA_PRODUKSI_ADA", `${ukur.rencanaProduksi} baris rencana bahan unit produksi merujuk bahan ini (jumlah tersimpan dalam satuan lama)`);
  if (ukur.reservasi) tambah("RESERVASI_ADA", `${ukur.reservasi} reservasi merujuk bahan ini`);
  if (ukur.katalogSupplier) tambah("KATALOG_SUPPLIER_ADA", `${ukur.katalogSupplier} entri katalog supplier (konversi beli → stok) merujuk bahan ini`);
  if (ukur.permintaanReplenishment) tambah("REPLENISHMENT_ADA", `${ukur.permintaanReplenishment} permintaan replenishment merujuk bahan ini`);
  if (m.reorderPoint !== null || m.reorderQty !== null) tambah("BATAS_MINIMUM_ADA", "titik/jumlah pesan ulang tersimpan dalam satuan lama");
  const pratinjau = {
    materialId, kode: m.code, nama: m.name, satuanLama: m.unit, satuanBaru, saldoLama, saldoBaru,
    pergerakan: { jumlah: gerak.length, jumlahQty: saldoLama, sidikJari: digest, terakhir: gerak.length ? gerak[gerak.length - 1].createdAt.toISOString() : null },
    catatanHistoris: { excelBelumDiposting: catatan.length, qty: r4(catatan.reduce((a, x) => a + Number(x.qty ?? 0), 0)), tautanSOAktif: !!tautanAktif },
    dokumen: ukur,
    hargaTidakDibawa: harga.filter((h) => h.satuan !== satuanBaru).map((h) => ({ satuan: h.satuan, harga: Number(h.unitPrice), berlakuSejak: h.effectiveFrom.toISOString().slice(0, 10) })),
    kewajibanTerbuka: kewajiban, cakupan: kewajiban.length ? "PARSIAL" : "TUNTAS_SATUAN_BARU",
    perkiraanSetelahKewajiban: kewajiban.length && kewajiban.every((k) => k.setara) ? { satuan: satuanBaru, saldo: r4(saldoBaru + kewajiban.reduce((a, k) => a + k.setara.jumlah, 0)), catatan: "PERKIRAAN informasional: saldo hasil SO ditambah setara kewajiban terbuka. Tidak diposting; penyelesaian kewajiban lewat jalur resmi dengan persetujuan terpisah." } : null,
    penghalang,
  };
  // hash mengikat keadaan yang MENENTUKAN hasil (bukan tautan: boleh dipasang di transaksi penerapan)
  pratinjau.hash = sha({ v: 1, materialId, lama: m.unit, baru: satuanBaru, saldoBaru, gerak: [gerak.length, saldoLama, digest], catatan: [catatan.length, pratinjau.catatanHistoris.qty], dokumen: ukur, penghalang: penghalang.map((p) => p.kode).sort(), kewajiban });
  return { pratinjau, material: m, saldoLama, gerakanN: gerak.length, digest, tautanAktif };
}

function bacaPermintaan(t, i) {
  wajib(UUID.test(String(t?.materialId ?? "")), `transisi #${i + 1}: bahan tidak valid`, "BAHAN_TIDAK_VALID");
  wajib(Object.values(MaterialUnit).includes(t?.satuanBaru), `transisi #${i + 1}: satuan baru tidak valid`, "SATUAN_TIDAK_VALID");
  const saldoBaru = Number(t?.saldoBaru); wajib(t?.saldoBaru !== undefined && t?.saldoBaru !== null && String(t.saldoBaru).trim() !== "" && Number.isFinite(saldoBaru) && saldoBaru >= 0 && saldoBaru <= 10_000_000 && Math.abs(r4(saldoBaru) - saldoBaru) < 1e-9, `transisi #${i + 1}: saldo baru harus angka ≥ 0 (maks 4 desimal)`, "SALDO_BARU_TIDAK_VALID");
  return { materialId: t.materialId, satuanBaru: t.satuanBaru, saldoBaru: r4(saldoBaru), kewajiban: rapikanKewajiban(t.kewajibanTerbuka), hashPratinjau: t.hashPratinjau };
}

/** Pratinjau baca-saja untuk 1–10 transisi. Tidak menulis apa pun. */
export async function pratinjauTransisi(db, { aktor, transisi }) {
  wajibPenyetuju(aktor);
  const daftar = Array.isArray(transisi) ? transisi : []; wajib(daftar.length >= 1 && daftar.length <= 10, "transisi wajib 1–10 bahan", "TRANSISI_TIDAK_VALID");
  const baca = daftar.map(bacaPermintaan); wajib(new Set(baca.map((b) => b.materialId)).size === baca.length, "bahan yang sama muncul lebih dari sekali", "BAHAN_GANDA");
  const hasil = []; for (const b of baca) hasil.push((await ambilKeadaan(db, b.materialId, b)).pratinjau);
  return { jumlah: hasil.length, bolehDiterapkan: hasil.every((h) => h.penghalang.length === 0), transisi: hasil, hashGabungan: sha(hasil.map((h) => h.hash).join("|")) };
}

/**
 * Terapkan 1–10 transisi SEKALIGUS (satu transaksi: semua berhasil atau tidak satu pun). `tautan` ({soTanggal, sumber, alasan, rujukanHash}) dipakai untuk memasang tautan SO di transaksi yang sama
 * bagi bahan yang punya catatan historis EXCEL belum diposting tetapi belum bertautan; tanpa itu, bahan semacam itu ditolak.
 */
export async function terapkanTransisi(prisma, { aktor, transisi, sumber, alasan, rujukanHash, tautan = null, kunci }) {
  wajibPenyetuju(aktor);
  const k = String(kunci ?? "").trim(); wajib(k.length >= 8 && k.length <= 90, "Idempotency-Key wajib (8–90 karakter)", "KUNCI_WAJIB", 428);
  const daftar = Array.isArray(transisi) ? transisi : []; wajib(daftar.length >= 1 && daftar.length <= 10, "transisi wajib 1–10 bahan", "TRANSISI_TIDAK_VALID");
  const baca = daftar.map(bacaPermintaan); wajib(new Set(baca.map((b) => b.materialId)).size === baca.length, "bahan yang sama muncul lebih dari sekali", "BAHAN_GANDA");
  for (const b of baca) wajib(HEX64.test(String(b.hashPratinjau ?? "")), "hash pratinjau wajib (64 heksadesimal) untuk setiap transisi", "HASH_PRATINJAU_WAJIB");
  const s = norm(sumber); wajib(s.length >= 3 && s.length <= 300, "sumber hasil SO wajib (3–300 karakter)", "SUMBER_WAJIB");
  const a = norm(alasan); wajib(a.length >= 10 && a.length <= 500, "alasan wajib (10–500 karakter)", "ALASAN_WAJIB");
  const r = norm(rujukanHash); wajib(r.length >= 8 && r.length <= 200, "rujukan hash manifest wajib (≥8 karakter)", "RUJUKAN_WAJIB");
  let tautanIsi = null;
  if (tautan) {
    const ts = norm(tautan.sumber), ta = norm(tautan.alasan), tr = norm(tautan.rujukanHash);
    wajib(/^\d{4}-\d{2}-\d{2}$/.test(String(tautan.soTanggal ?? "")) && !Number.isNaN(Date.parse(`${tautan.soTanggal}T00:00:00Z`)) && String(tautan.soTanggal) <= wibTgl(new Date()), "tautan.soTanggal wajib (YYYY-MM-DD, bukan masa depan)", "TANGGAL_SO_WAJIB");
    wajib(ts.length >= 3 && ts.length <= 300 && ta.length >= 10 && ta.length <= 500 && tr.length >= 8 && tr.length <= 200, "tautan.sumber/alasan/rujukanHash tidak valid", "TAUTAN_TIDAK_VALID");
    tautanIsi = { soTanggal: String(tautan.soTanggal), sumber: ts, alasan: ta, rujukanHash: tr };
  }
  const urut = [...baca].sort((x, y) => x.materialId.localeCompare(y.materialId));
  return prisma.$transaction(async (tx) => {
    for (const b of urut) { await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `transisi_satuan:${b.materialId}`); await lockRowForUpdate(tx, "materials", b.materialId); }
    // idempoten: semua dokumen kunci ini sudah ada dan isinya sama → kembalikan tanpa menulis; sebagian → tolak
    const ada = await tx.materialUnitTransition.findMany({ where: { idempotencyKey: { in: urut.map((b) => `${k}:${b.materialId}`) } } });
    if (ada.length) {
      wajib(ada.length === urut.length, "sebagian transisi dengan kunci ini sudah ada — seluruh permintaan ditolak", "KUNCI_DIPAKAI_LAIN", 409);
      for (const b of urut) { const d = ada.find((x) => x.idempotencyKey === `${k}:${b.materialId}`); wajib(d.toUnit === b.satuanBaru && Number(d.balanceNew) === b.saldoBaru && d.previewHash === b.hashPratinjau && d.reason === a && d.referenceHash === r, "Idempotency-Key ini sudah dipakai untuk isi yang berbeda", "KUNCI_DIPAKAI_LAIN", 409); }
      return { ulang: true, transisi: ada.map((d) => ({ transisiId: d.id, materialId: d.materialId, dari: d.fromUnit, ke: d.toUnit })) };
    }
    // 1) keadaan di bawah kunci HARUS sama dengan pratinjau yang disetujui; tanpa penghalang
    const keadaan = [];
    for (const b of urut) {
      const kd = await ambilKeadaan(tx, b.materialId, b);
      wajib(kd.pratinjau.hash === b.hashPratinjau, `${kd.pratinjau.kode}: keadaan bahan berubah dari pratinjau yang disetujui (pergerakan/saldo/catatan/dokumen). Buat pratinjau baru; tidak ada yang ditulis.`, "PRATINJAU_BERUBAH", 409, { kode: kd.pratinjau.kode });
      wajib(kd.pratinjau.penghalang.length === 0, `${kd.pratinjau.kode}: ${kd.pratinjau.penghalang.map((p) => p.pesan).join("; ")}`, "TRANSISI_DITOLAK", 409, { kode: kd.pratinjau.kode, penghalang: kd.pratinjau.penghalang });
      keadaan.push({ b, kd });
    }
    // 2) PENGAMAN HISTORIS aktif di transaksi ini SEBELUM satuan baru terlihat
    const tautanBaru = [];
    for (const { b, kd } of keadaan) {
      if (kd.pratinjau.catatanHistoris.excelBelumDiposting > 0 && !kd.tautanAktif) {
        wajib(tautanIsi, `${kd.pratinjau.kode}: ${kd.pratinjau.catatanHistoris.excelBelumDiposting} catatan pemakaian historis belum diposting dan belum bertaut SO — sertakan tautan SO (dipasang di transaksi yang sama) atau pasang lebih dulu`, "TANPA_TAUTAN_SO", 409, { kode: kd.pratinjau.kode });
        const e = await recordActivity(tx, { entityType: ENTITY_TYPES.PERNYATAAN_HISTORIS_SO, entityId: b.materialId, eventType: EVENT_TYPES.SO_DITAUTKAN, actorId: aktor.id,
          metadata: { materialId: b.materialId, kode: kd.pratinjau.kode, soTanggal: tautanIsi.soTanggal, batasUTC: batasDariTanggal(tautanIsi.soTanggal).toISOString(), sumber: tautanIsi.sumber, alasan: tautanIsi.alasan, rujukanHash: tautanIsi.rujukanHash, dokumen: null, menggantikanId: null, idempotencyKey: `${k}:${b.materialId}`, dibuatBersamaTransisi: true } });
        tautanBaru.push({ materialId: b.materialId, tautanId: e.id });
      }
    }
    // 3) transisi per bahan: tutup saldo lama → ganti satuan → buka saldo baru → dokumen
    const hasil = [];
    for (const { b, kd } of keadaan) {
      const transisiId = crypto.randomUUID(); const dari = kd.material.unit; const ke = b.satuanBaru;
      await tx.$executeRawUnsafe("SELECT set_config('app.transisi_satuan', $1, true)", transisiId); // penanda transaksi: satu-satunya jalan yang boleh mengubah satuan bahan berpergerakan
      let tutup = null; let buka = null;
      const catatan = `Transisi satuan ${dari}→${ke} (dokumen ${transisiId.slice(0, 8)})`;
      if (kd.saldoLama !== 0) tutup = await postStockMovement(tx, { materialId: b.materialId, type: "ADJUSTMENT", qty: r4(-kd.saldoLama), reason: `${catatan}: penutupan saldo lama ${kd.saldoLama} ${dari}. ${a}`.slice(0, 500), note: `${catatan}: saldo lama ditutup`, createdById: aktor.id, unitAtEntry: dari, unitTransitionId: transisiId });
      const tgl = wibTgl(new Date());
      const catatanMaster = `${kd.material.dataNote ? kd.material.dataNote + " | " : ""}Satuan stok ${dari} → ${ke} sejak ${tgl} (dokumen ${transisiId.slice(0, 8)}); pergerakan sebelumnya dalam ${dari}.`.slice(0, 1000);
      await tx.material.update({ where: { id: b.materialId }, data: { unit: ke, dataNote: catatanMaster } });
      if (b.saldoBaru !== 0) buka = await postStockMovement(tx, { materialId: b.materialId, type: "ADJUSTMENT", qty: b.saldoBaru, reason: `${catatan}: saldo awal ${b.saldoBaru} ${ke} (hasil SO: ${s}). ${a}`.slice(0, 500), note: `${catatan}: saldo awal satuan baru`, createdById: aktor.id, unitAtEntry: ke, unitTransitionId: transisiId });
      const [{ jumlah }] = await tx.$queryRawUnsafe("SELECT COALESCE(SUM(qty),0)::float AS jumlah FROM stock_movements WHERE material_id = $1::uuid", b.materialId);
      wajib(Math.abs(Number(jumlah) - b.saldoBaru) < 1e-6, `${kd.pratinjau.kode}: saldo sesudah transisi (${jumlah}) bukan saldo baru (${b.saldoBaru}) — dibatalkan`, "SALDO_TIDAK_SESUAI", 500);
      await tx.materialUnitTransition.create({ data: { id: transisiId, materialId: b.materialId, fromUnit: dari, toUnit: ke, balanceOld: kd.saldoLama, balanceNew: b.saldoBaru, movementCount: kd.gerakanN, movementsDigest: kd.digest, previewHash: b.hashPratinjau, source: s, reason: a, referenceHash: r, openObligations: b.kewajiban, closeMovementId: tutup?.id ?? null, openMovementId: buka?.id ?? null, idempotencyKey: `${k}:${b.materialId}`, createdById: aktor.id } });
      await recordActivity(tx, { entityType: ENTITY_TYPES.MATERIAL, entityId: b.materialId, eventType: EVENT_TYPES.MATERIAL_UPDATED, actorId: aktor.id, metadata: { aksi: "transisi_satuan", code: kd.pratinjau.kode, transisiId, dari, ke, saldoLama: kd.saldoLama, saldoBaru: b.saldoBaru, kewajibanTerbuka: b.kewajiban.length } });
      hasil.push({ transisiId, materialId: b.materialId, kode: kd.pratinjau.kode, dari, ke, saldoLama: kd.saldoLama, saldoBaru: b.saldoBaru, penutupId: tutup?.id ?? null, pembukaId: buka?.id ?? null, cakupan: b.kewajiban.length ? "PARSIAL" : "TUNTAS_SATUAN_BARU", kewajibanTerbuka: b.kewajiban });
    }
    return { ulang: false, transisi: hasil, tautanBaru };
  }, { timeout: 60_000, maxWait: 15_000 });
}

/** Jumlah baris transfer SELESAI untuk bahan ini yang masih punya selisih kirim/terima belum diselesaikan (SUSUT/DITEMUKAN belum menutup). Baca-saja. */
async function selisihTransferTerbukaBahan(db, materialId) {
  const trf = await db.stockTransfer.findMany({ where: { status: "COMPLETED", lines: { some: { materialId } } }, take: 500, include: { lines: { include: { material: { select: { code: true, name: true, unit: true } } } } } });
  let n = 0; for (const t of trf) { if (!t.lines.some((l) => l.materialId === materialId && Number(l.qtySent) > Number(l.qtyReceived ?? l.qtySent))) continue; n += (await selisihTransfer(db, t)).filter((b) => b.materialId === materialId && b.sisa > 0).length; }
  return n;
}

export { satuanCatatanPer };

/**
 * Beri tiap baris pergerakan SATUAN ASALNYA: `satuanCatat` + `material.unit` = satuan saat dicatat (bukan satuan master sekarang), `material.satuanMaster` = satuan master sekarang.
 * Baris harus membawa materialId, unitAtEntry, dan material.{unit}. Baca-saja; mengembalikan salinan.
 */
export async function labelSatuanBaris(db, rows) {
  const satuanDari = await satuanCatatanPer(db, rows);
  return rows.map((r) => { const u = satuanDari(r); return { ...r, satuanCatat: u, ...(r.material ? { material: { ...r.material, satuanMaster: r.material.unit, unit: u ?? r.material.unit } } : {}) }; });
}

/**
 * Harga referensi (Material.referenceUnitCost, snapshot Agustus) dinyatakan per satuan ASAL (satuan_lama transisi pertama). Mengembalikan fungsi baris → boolean: true bila referensi itu sah dipakai
 * untuk baris pergerakan tersebut (bahan tanpa transisi, atau baris yang dicatat dalam satuan referensi). Baca-saja.
 */
export async function referensiSahPer(db, rows) {
  const ids = [...new Set(rows.map((r) => r.materialId))]; if (!ids.length) return () => true;
  const ts = await db.materialUnitTransition.findMany({ where: { materialId: { in: ids } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { materialId: true, fromUnit: true } });
  if (!ts.length) return () => true;
  const pertama = new Map(); for (const t of ts) if (!pertama.has(t.materialId)) pertama.set(t.materialId, t.fromUnit);
  const satuanDari = await satuanCatatanPer(db, rows);
  return (r) => !pertama.has(r.materialId) || satuanDari(r) === pertama.get(r.materialId);
}

/** Riwayat satuan satu bahan: periode per satuan (jumlah pergerakan, saldo per satuan, awal/akhir), dokumen transisi, dan pemeriksaan konsistensi. Baca-saja. */
export async function riwayatSatuan(db, materialId) {
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const m = await db.material.findUnique({ where: { id: materialId }, select: { id: true, code: true, name: true, unit: true } }); wajib(m, "bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
  const rows = await db.stockMovement.findMany({ where: { materialId }, select: { id: true, materialId: true, type: true, qty: true, createdAt: true, unitAtEntry: true, unitTransitionId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const transisi = await db.materialUnitTransition.findMany({ where: { materialId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const satuanDari = await satuanCatatanPer(db, rows);
  const per = new Map();
  for (const r of rows) { const u = satuanDari(r); const p = per.get(u) ?? { satuan: u, jumlahPergerakan: 0, saldo: 0, pertama: null, terakhir: null }; p.jumlahPergerakan += 1; p.saldo = r4(p.saldo + Number(r.qty)); p.pertama = p.pertama ?? r.createdAt.toISOString(); p.terakhir = r.createdAt.toISOString(); per.set(u, p); }
  const periode = [...per.values()].map((p) => ({ ...p, saatIni: p.satuan === m.unit }));
  const saldo = r4(rows.reduce((a, x) => a + Number(x.qty), 0));
  const lain = periode.filter((p) => !p.saatIni).reduce((a, p) => a + p.saldo, 0);
  return { materialId, kode: m.code, nama: m.name, satuanSekarang: m.unit, saldoSekarang: saldo, periode,
    transisi: transisi.map((t) => ({ id: t.id, dari: t.fromUnit, ke: t.toUnit, saldoLama: Number(t.balanceOld), saldoBaru: Number(t.balanceNew), waktu: t.createdAt.toISOString(), kewajibanTerbuka: t.openObligations, cakupan: (t.openObligations ?? []).length ? "PARSIAL" : "TUNTAS_SATUAN_BARU", sumber: t.source })),
    konsisten: Math.abs(lain) < 1e-6 };
}

/** Transisi terakhir per bahan (untuk laporan Nilai Persediaan). Baca-saja. */
export async function transisiTerakhirPer(db) {
  const rows = await db.materialUnitTransition.findMany({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return new Map(rows.map((t) => [t.materialId, { id: t.id, dari: t.fromUnit, ke: t.toUnit, saldoLama: Number(t.balanceOld), saldoBaru: Number(t.balanceNew), tanggal: wibTgl(t.createdAt), kewajibanTerbuka: t.openObligations ?? [], parsial: (t.openObligations ?? []).length > 0 }]));
}
