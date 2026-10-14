// MANIFEST BARANG (sisi aplikasi driver) — membaca `job.manifest` yang dibangun SERVER dari unit tertaut ke job (backend lib/domain/deliveryManifest.js).
// Layar TIDAK menghitung ulang dari ringkasan order: angka stop/unit/jenis produk sama dengan web, pesan grup WA, dan sheet rute. Tanpa harga.
// File ini MURNI (tanpa import RN) supaya bisa diuji `node --test`.

export const manifestOf = (job) => job?.manifest ?? null;

/** "3× Kasur Sorong 3in1 Custom — 100 × 200 cm" (+ spesifikasi bila ada). */
export function teksBaris(b) {
  const inti = `${b.qty}× ${b.nama}`;
  const rincian = [b.ukuran, b.spesifikasi].filter(Boolean).join(" · ");
  return rincian ? `${inti} — ${rincian}` : inti;
}

/** Satu baris pendek untuk chip kartu: baris pertama + "+N jenis lain". null bila manifest belum ada. */
export function produkRingkasKartu(job) {
  const m = manifestOf(job);
  if (!m || !m.baris?.length) return null;
  const pertama = teksBaris(m.baris[0]);
  return m.baris.length > 1 ? `${pertama} +${m.baris.length - 1} jenis lain` : pertama;
}

/** Label penjual untuk order PKR ("Dijual oleh Kemal"). null bila bukan PKR — pemanggil jatuh ke label lama. BUKAN Sales lead. */
export function labelPenjualPkr(job) {
  const s = manifestOf(job)?.sumber;
  return s?.penjual ? `Dijual oleh ${s.penjual}` : null;
}

/** Semua unit manifest (rata): [{ id, kode, label, dimuat }]. */
export function unitManifest(job) {
  return (manifestOf(job)?.baris ?? []).flatMap((b) => (b.unit ?? []).map((u) => ({ ...u, nama: b.nama })));
}

/**
 * Kumpulan unit yang sedang menunggu sinkron di antrean offline untuk job ini: dari item { action:"unit-load", jobId, payload:{ unitIds?, semua? } }.
 * Mengembalikan { semua: boolean, unitIds: Set } — dipakai supaya checklist tetap terlihat tercentang walau jaringan putus.
 */
export function muatTertunda(queue, jobId) {
  const out = { semua: false, unitIds: new Set() };
  for (const it of queue ?? []) {
    if (it?.jobId !== jobId || it.action !== "unit-load" || it.blocked) continue;
    if (it.payload?.semua) out.semua = true;
    for (const id of it.payload?.unitIds ?? []) out.unitIds.add(id);
  }
  return out;
}

/** Progres muat EFEKTIF = konfirmasi server ∪ antrean offline. { total, dimuat, tertunda, lengkap, label, belum:[{id,label}] }. */
export function progresMuatEfektif(job, queue = []) {
  const m = manifestOf(job);
  if (!m) return null;
  const unit = unitManifest(job);
  const tertunda = muatTertunda(queue, job.id);
  let tertundaCount = 0;
  const belum = [];
  let dimuat = 0;
  for (const u of unit) {
    if (u.dimuat) { dimuat += 1; continue; }
    if (tertunda.semua || tertunda.unitIds.has(u.id)) { dimuat += 1; tertundaCount += 1; continue; }
    belum.push({ id: u.id, label: u.label });
  }
  const total = unit.length;
  const lengkap = total > 0 && dimuat === total;
  return {
    total, dimuat, tertunda: tertundaCount, lengkap, belum,
    label: `Barang dimuat ${dimuat}/${total} unit${tertundaCount > 0 ? " (menunggu sinkron)" : ""}`,
  };
}

const STATUS_MUAT = ["SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];
/** Konfirmasi muat hanya untuk job PENGIRIMAN yang masih berjalan dan punya unit tertaut. */
export const bolehKonfirmasiMuat = (job) => job?.type === "DELIVERY" && STATUS_MUAT.includes(job.status) && (manifestOf(job)?.muat?.total ?? 0) > 0;

/**
 * Keputusan tombol "Tandai Selesai":
 *   - gerbang tidak ditegakkan untuk klien ini → boleh (checklist hanya informasi)
 *   - semua unit terkonfirmasi (server/antrean) → boleh
 *   - ada unit belum + alasan pengecualian ≥ 5 huruf → boleh (dikirim sebagai pengecualianUnit, diaudit server)
 *   - selain itu → tidak boleh, dengan alasan yang bisa dibaca
 */
export function izinSelesai({ job, queue = [], gerbangAktif = false, alasan = "" }) {
  if (job?.type !== "DELIVERY" || !gerbangAktif) return { boleh: true, pakaiPengecualian: false };
  const p = progresMuatEfektif(job, queue);
  if (!p || p.total === 0 || p.lengkap) return { boleh: true, pakaiPengecualian: false, progres: p };
  const a = String(alasan ?? "").trim().replace(/\s+/g, " ");
  if (a.length >= 5) return { boleh: true, pakaiPengecualian: true, alasan: a, progres: p };
  return {
    boleh: false, pakaiPengecualian: false, progres: p,
    pesan: `${p.label}. Konfirmasi semua unit dimuat (${p.belum.map((u) => u.label).join(", ")}) atau tulis alasan pengecualian minimal 5 huruf.`,
  };
}
