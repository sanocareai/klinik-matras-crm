// Logika jalur produksi sebuah unit — INTI aturan "routing adalah data,
// bukan kode" (docs/sano-hub/CLAUDE.md, D-003).
//
// Fungsi MURNI — tidak menyentuh database, tidak tahu Prisma. Diberi data
// (tahap INTAKE/FINISH global + modul MODULE milik layanan unit), kembalikan
// urutan tahap yang harus dilalui unit itu. TIDAK PERNAH menyebut kode tahap
// tertentu (`'fit_test'`, `'teardown'`, dst) — kalau butuh perilaku khusus
// per tahap, itu dibaca dari flag (requiresPhoto, requiresQc), bukan dari
// perbandingan nama.

/**
 * Susun jalur lengkap tahap untuk sebuah unit.
 *
 * Urutan: SELURUH tahap INTAKE (berlaku untuk semua unit) → tahap MODULE
 * milik layanan unit ini SAJA, dalam urutan yang didefinisikan katalog
 * layanan (bukan routing_stages.sequence — itu cuma urutan fisik umum
 * fondasi→lapisan→kain, katalog yang menentukan urutan SEBENARNYA per
 * layanan) → SELURUH tahap FINISH.
 *
 * @param {object[]} intakeStages - semua RoutingStage phase=INTAKE, urut sequence
 * @param {object[]} serviceModuleStages - RoutingStage phase=MODULE milik
 *   layanan unit ini, SUDAH diurutkan sesuai ServiceCatalogModule.sequence
 * @param {object[]} finishStages - semua RoutingStage phase=FINISH, urut sequence
 * @returns {object[]} array RoutingStage, urutan penuh jalur produksi
 */
export function buildUnitPath(intakeStages, serviceModuleStages, finishStages) {
  return [
    ...[...intakeStages].sort((a, b) => a.sequence - b.sequence),
    ...serviceModuleStages,
    ...[...finishStages].sort((a, b) => a.sequence - b.sequence),
  ];
}

/**
 * Tahap SETELAH currentStageId di sebuah jalur. null kalau currentStageId
 * adalah tahap TERAKHIR (unit selesai seluruh routing) atau tidak ditemukan.
 */
export function getNextStage(path, currentStageId) {
  if (!currentStageId) return path[0] ?? null;
  const idx = path.findIndex((s) => s.id === currentStageId);
  if (idx === -1) return null; // currentStageId bukan bagian jalur ini (lini/layanan berubah)
  return path[idx + 1] ?? null;
}

/**
 * true kalau stageId adalah tahap TERAKHIR di jalur — menyelesaikannya berarti
 * seluruh routing unit selesai (unit siap kirim).
 */
export function isLastStage(path, stageId) {
  const last = path[path.length - 1];
  return !!last && last.id === stageId;
}

/**
 * true kalau stageId adalah tahap INTAKE TERAKHIR — menyelesaikannya berarti
 * unit akan masuk fase MODULE, yang TIDAK BISA dihitung tanpa layanan
 * ditetapkan (D-008: lini/modul ditentukan di Uji Fondasi/Diagnosa, bukan
 * saat sales input order).
 *
 * Dihitung dari FASE + urutan, BUKAN dari nama kode tahap ("diagnosis") —
 * kalau urutan INTAKE berubah di masa depan (tahap ditambah/dipindah), fungsi
 * ini tetap benar tanpa perlu diubah (D-003).
 */
export function isLastIntakeStage(path, stageId) {
  const intakeStages = path.filter((s) => s.phase === "INTAKE");
  const last = intakeStages[intakeStages.length - 1];
  return !!last && last.id === stageId;
}

/**
 * Cari tahap MODULE "lapisan" (comfort layer) di jalur sebuah unit — dipakai
 * QC gagal (ROUTING.md §4): "balik ke modul lapisan, dihitung rework".
 *
 * TIDAK menebak dari nama kode — cari lewat sequence 20 (posisi lapisan
 * secara fisik, lihat ROUTING.md §2: fondasi=10, lapisan=20, kain=30) di
 * ANTARA tahap-tahap MODULE unit ini. Kalau layanan unit tidak mengandung
 * modul lapisan sama sekali (mis. Service Fondasi murni), kembalikan null —
 * pemanggil harus menangani kasus itu secara eksplisit, bukan menebak.
 */
export function findComfortLayerModule(path) {
  const modules = path.filter((s) => s.phase === "MODULE");
  return modules.find((s) => s.sequence === 20) ?? null;
}
