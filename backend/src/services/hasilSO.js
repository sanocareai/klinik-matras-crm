// HASIL SO PER BAHAN — pencatatan BERIZIN dan DIAUDIT atas hasil hitung fisik yang TIDAK bisa/ belum menjadi pergerakan stok (Nov 2026). Tidak menulis stok, harga, valuasi, jurnal, PSA, GR, maupun fin_settings.
//   Dua jenis:
//     PENGAMATAN_SATUAN — fisik terukur dalam SATUAN LAIN dari satuan stok (mis. 13,5 ROLL padahal stok METER). Tidak dikonversi, tidak menghasilkan nilai; laporan menampilkannya sebagai "terukur dalam ROLL, belum terukur dalam METER".
//     NOL_DIKONFIRMASI  — fisik nol dikonfirmasi pada SO tetapi belum tercatat sebagai hasil SO di ledger. BUKAN "saldo sistem sudah sesuai"; tidak membuat ADJUSTMENT (nol maupun lainnya) dan tidak menambah ledger.
//   Penyimpanan = jejak aktivitas (activity_events, entity "hasil_so_bahan", per bahan), APPEND-ONLY: koreksi = peristiwa baru yang menunjuk peristiwa sebelumnya; tidak ada ubah/hapus. Sumber, tanggal SO, pelaku (akun login), satuan,
//   jumlah, alasan, dan riwayat koreksi semuanya ada di metadata + actor + waktu. Izin tulis = inventory:write (peran yang sudah ada; tidak ada peran baru). Idempoten lewat Idempotency-Key; serentak diserialkan per bahan.
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export class HasilSOError extends Error { constructor(message, statusCode = 400, code = null) { super(message); this.statusCode = statusCode; this.code = code; } }
const wajib = (c, m, code, status = 400) => { if (!c) throw new HasilSOError(m, status, code); };
export const JENIS = Object.freeze({ PENGAMATAN_SATUAN: "PENGAMATAN_SATUAN", NOL_DIKONFIRMASI: "NOL_DIKONFIRMASI" });
export const BATAS_BARIS = 300;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const r4 = (v) => Math.round(Number(v) * 10000) / 10000;
const wibTgl = (d) => new Date(new Date(d).getTime() + 7 * 3600_000).toISOString().slice(0, 10);
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

function bacaBaris(b, bahan) {
  wajib(UUID.test(String(b?.materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  wajib(Object.values(JENIS).includes(b.jenis), "jenis hasil SO tidak dikenal (PENGAMATAN_SATUAN atau NOL_DIKONFIRMASI)", "JENIS_TIDAK_VALID");
  wajib(/^\d{4}-\d{2}-\d{2}$/.test(String(b.soTanggal ?? "")) && !Number.isNaN(Date.parse(`${b.soTanggal}T00:00:00Z`)), "tanggal SO wajib (YYYY-MM-DD)", "TANGGAL_SO_WAJIB");
  wajib(String(b.soTanggal) <= wibTgl(new Date()), "tanggal SO tidak boleh di masa depan", "TANGGAL_SO_MASA_DEPAN");
  let soWaktu = null; if (b.soWaktu !== undefined && b.soWaktu !== null && String(b.soWaktu).trim() !== "") {
    wajib(/(Z|[+-]\d{2}:?\d{2})$/i.test(String(b.soWaktu).trim()) && Number.isFinite(Date.parse(String(b.soWaktu))), "jam SO harus lengkap dengan zona waktu (mis. 2026-11-04T18:00:00+07:00) atau dikosongkan — jam tidak ditebak", "JAM_SO_TIDAK_VALID");
    soWaktu = new Date(b.soWaktu).toISOString(); wajib(wibTgl(soWaktu) === String(b.soTanggal) || String(b.soTanggal) === new Date(soWaktu).toISOString().slice(0, 10), "jam SO tidak sesuai dengan tanggal SO", "JAM_TIDAK_SESUAI_TANGGAL"); }
  const sumber = norm(b.sumber); wajib(sumber.length >= 3 && sumber.length <= 300, "sumber wajib (3–300 karakter, mis. nama berkas/dokumen SO dan sel)", "SUMBER_WAJIB");
  const alasan = norm(b.alasan); wajib(alasan.length >= 10 && alasan.length <= 500, "alasan wajib (10–500 karakter)", "ALASAN_WAJIB");
  const jumlah = Number(b.jumlah); wajib(b.jumlah !== undefined && b.jumlah !== null && String(b.jumlah).trim() !== "" && Number.isFinite(jumlah) && jumlah >= 0 && jumlah <= 10_000_000 && Math.abs(r4(jumlah) - jumlah) < 1e-9, "jumlah harus angka ≥ 0 dengan maksimum 4 desimal", "JUMLAH_TIDAK_VALID");
  let satuan = norm(b.satuan).toUpperCase();
  if (b.jenis === JENIS.NOL_DIKONFIRMASI) { wajib(jumlah === 0, "hasil nol dikonfirmasi harus berjumlah 0", "JUMLAH_HARUS_NOL"); satuan = bahan.unit; }
  else { wajib(satuan.length >= 1 && satuan.length <= 20, "satuan pengamatan wajib (mis. ROLL)", "SATUAN_WAJIB"); wajib(satuan !== String(bahan.unit).toUpperCase(), `satuan pengamatan sama dengan satuan stok (${bahan.unit}): catat sebagai Koreksi Saldo, bukan pengamatan`, "SATUAN_SAMA_DENGAN_STOK", 422); wajib(jumlah > 0, "jumlah pengamatan harus lebih dari 0 (nol dicatat sebagai NOL_DIKONFIRMASI)", "JUMLAH_PENGAMATAN_NOL"); }
  return { jenis: b.jenis, jumlah: r4(jumlah), satuan, soTanggal: String(b.soTanggal), soWaktu, sumber, alasan };
}
const kunciSatu = (kunci, materialId) => `${kunci}:${materialId}`;
const mapEvent = (e, nama) => ({ id: e.id, jenis: e.metadata?.jenis, jumlah: Number(e.metadata?.jumlah), satuan: e.metadata?.satuan, soTanggal: e.metadata?.soTanggal, soWaktu: e.metadata?.soWaktu ?? null, sumber: e.metadata?.sumber, alasan: e.metadata?.alasan, satuanStok: e.metadata?.satuanStok, saldoLedgerSaatDicatat: e.metadata?.saldoLedgerSaatDicatat ?? null,
  menggantikanId: e.metadata?.menggantikanId ?? null, koreksi: e.eventType === EVENT_TYPES.SO_HASIL_DIKOREKSI, pelaku: { id: e.actorId, nama: nama?.get(e.actorId) ?? null }, dicatatPada: e.createdAt });

/**
 * Catat hasil SO untuk satu atau banyak bahan (satu transaksi: semua atau tidak sama sekali).
 * @param masukan { baris:[{materialId, jenis, jumlah, satuan, soTanggal, soWaktu?, sumber, alasan, menggantikanId?}], default?:{soTanggal,soWaktu,sumber,alasan} }
 */
export async function catatHasilSO(prisma, user, masukan, kunciMentah) {
  wajib(user?.id, "Pelaku wajib ada", "PELAKU_WAJIB", 401);
  const kunci = String(kunciMentah ?? "").trim(); wajib(kunci.length >= 8 && kunci.length <= 100, "Idempotency-Key wajib (8–100 karakter)", "KUNCI_WAJIB", 428);
  const daftar = Array.isArray(masukan?.baris) ? masukan.baris : []; wajib(daftar.length >= 1 && daftar.length <= BATAS_BARIS, `baris wajib 1–${BATAS_BARIS}`, "BARIS_TIDAK_VALID");
  const dasar = masukan?.default ?? {}; const ids = daftar.map((b) => b?.materialId); wajib(new Set(ids).size === ids.length, "bahan yang sama muncul lebih dari sekali dalam satu permintaan", "BAHAN_GANDA");
  return prisma.$transaction(async (tx) => {
    const hasil = [];
    for (const mentah of [...daftar].sort((a, b) => String(a.materialId).localeCompare(String(b.materialId)))) {
      const b = { ...dasar, ...mentah }; wajib(UUID.test(String(b.materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", `hasil_so:${b.materialId}`);
      const bahan = await tx.material.findUnique({ where: { id: b.materialId }, select: { id: true, code: true, unit: true, active: true } }); wajib(bahan, "bahan tidak ditemukan", "BAHAN_TIDAK_ADA", 404);
      const isi = bacaBaris(b, bahan); const kunciBaris = kunciSatu(kunci, bahan.id);
      const sama = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.HASIL_SO_BAHAN, entityId: bahan.id, metadata: { path: ["idempotencyKey"], equals: kunciBaris } } });
      if (sama) { const m = sama.metadata ?? {}; wajib(m.jenis === isi.jenis && Number(m.jumlah) === isi.jumlah && m.satuan === isi.satuan && m.soTanggal === isi.soTanggal, "Idempotency-Key ini sudah dipakai untuk isi yang berbeda", "KUNCI_DIPAKAI_LAIN", 409); hasil.push({ ...mapEvent(sama), materialId: bahan.id, kode: bahan.code, ulang: true }); continue; }
      const terkini = await tx.activityEvent.findFirst({ where: { entityType: ENTITY_TYPES.HASIL_SO_BAHAN, entityId: bahan.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
      if (terkini) wajib(b.menggantikanId && b.menggantikanId === terkini.id, "Bahan ini sudah punya hasil SO tercatat. Koreksi wajib menunjuk catatan terkini (menggantikanId) — riwayat lama tidak dihapus.", "SUDAH_ADA_HASIL_SO", 409);
      else wajib(!b.menggantikanId, "tidak ada hasil SO sebelumnya untuk dikoreksi", "TIDAK_ADA_YANG_DIKOREKSI", 409);
      const [{ saldo }] = await tx.$queryRaw`SELECT COALESCE(SUM(qty), 0)::float AS saldo FROM stock_movements WHERE material_id = ${bahan.id}::uuid`;
      const e = await recordActivity(tx, { entityType: ENTITY_TYPES.HASIL_SO_BAHAN, entityId: bahan.id, eventType: terkini ? EVENT_TYPES.SO_HASIL_DIKOREKSI : EVENT_TYPES.SO_HASIL_DICATAT, actorId: user.id,
        metadata: { ...isi, kode: bahan.code, satuanStok: bahan.unit, saldoLedgerSaatDicatat: r4(saldo), idempotencyKey: kunciBaris, menggantikanId: terkini?.id ?? null, versi: 1 } });
      hasil.push({ ...mapEvent(e), materialId: bahan.id, kode: bahan.code, ulang: false });
    }
    return { jumlah: hasil.length, baru: hasil.filter((h) => !h.ulang).length, ulang: hasil.filter((h) => h.ulang).length, hasil };
  }, { timeout: 60_000, maxWait: 15_000 });
}

/** Hasil SO TERKINI per bahan (Map materialId → catatan). Baca-saja. `materialIds` null = semua. */
export async function hasilSOTerkini(db, materialIds = null) {
  const where = { entityType: ENTITY_TYPES.HASIL_SO_BAHAN, ...(materialIds ? { entityId: { in: materialIds } } : {}) };
  const rows = await db.activityEvent.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const hitung = new Map(); const terkini = new Map(); for (const e of rows) { hitung.set(e.entityId, (hitung.get(e.entityId) ?? 0) + 1); terkini.set(e.entityId, e); }
  const aktor = [...new Set([...terkini.values()].map((e) => e.actorId).filter(Boolean))];
  const nama = aktor.length ? new Map((await db.user.findMany({ where: { id: { in: aktor } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();
  return new Map([...terkini].map(([id, e]) => [id, { ...mapEvent(e, nama), revisi: hitung.get(id) }]));
}

/** Riwayat lengkap satu bahan (lama → baru), termasuk koreksi. Baca-saja. */
export async function riwayatHasilSO(db, materialId) {
  wajib(UUID.test(String(materialId ?? "")), "bahan tidak valid", "BAHAN_TIDAK_VALID");
  const rows = await db.activityEvent.findMany({ where: { entityType: ENTITY_TYPES.HASIL_SO_BAHAN, entityId: materialId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const aktor = [...new Set(rows.map((e) => e.actorId).filter(Boolean))]; const nama = aktor.length ? new Map((await db.user.findMany({ where: { id: { in: aktor } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map();
  return rows.map((e, i) => ({ ...mapEvent(e, nama), urutan: i + 1, terkini: i === rows.length - 1 }));
}
