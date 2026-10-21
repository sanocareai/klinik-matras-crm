// Rencana Produksi (kalender mingguan) — logika MURNI (tanpa React/DOM): tanggal WIB, tab antrean, slot bawaan, keputusan seret-lepas, tindakan utama kartu, keadaan URL.
// Aturan jadwal sebenarnya ada di server (lib/domain/productionRencanaAdmin.js); fungsi di sini hanya membantu tampilan dan TIDAK menjadi sumber kebenaran.

export const HARI_PENDEK = Object.freeze(["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]);
const BULAN = Object.freeze(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
const DAY_MS = 86_400_000;

export const shiftKey = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
export const mondayOf = (key) => { const d = new Date(`${key}T00:00:00Z`).getUTCDay(); return shiftKey(key, d === 0 ? -6 : 1 - d); };
export const todayWib = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const validKey = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k) && !Number.isNaN(Date.parse(`${k}T00:00:00Z`));
/** "2026-10-22" -> "Kam 22 Okt" */
export function labelHari(key) { if (!validKey(key)) return "—"; const d = new Date(`${key}T00:00:00Z`); return `${HARI_PENDEK[d.getUTCDay()]} ${d.getUTCDate()} ${BULAN[d.getUTCMonth()]}`; }
/** "2026-10-22" -> "22 Okt 2026" */
export function labelTanggal(key) { if (!validKey(key)) return "—"; const d = new Date(`${key}T00:00:00Z`); return `${d.getUTCDate()} ${BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
export function labelMinggu(startKey) {
  const da = new Date(`${startKey}T00:00:00Z`); const db = new Date(`${shiftKey(startKey, 6)}T00:00:00Z`);
  return da.getUTCMonth() === db.getUTCMonth()
    ? `${da.getUTCDate()}–${db.getUTCDate()} ${BULAN[db.getUTCMonth()]} ${db.getUTCFullYear()}`
    : `${da.getUTCDate()} ${BULAN[da.getUTCMonth()]} – ${db.getUTCDate()} ${BULAN[db.getUTCMonth()]} ${db.getUTCFullYear()}`;
}

export const TABS = Object.freeze([
  { key: "SIAP", label: "Siap dijadwalkan", hint: "Sudah diterima di workshop, belum punya jadwal." },
  { key: "KEPUTUSAN", label: "Butuh keputusan", hint: "Ada hambatan konkret yang perlu diputuskan manusia." },
  { key: "MENUNGGU_TIBA", label: "Menunggu unit tiba", hint: "Belum diterima di workshop; boleh dijadwalkan lebih awal." },
  { key: "TERJADWAL", label: "Terjadwal", hint: "Sudah punya tanggal (Rencana Admin atau Pelaksanaan Meja)." },
]);
export const SORTS = Object.freeze([{ key: "PRIORITAS", label: "Prioritas" }, { key: "TARGET", label: "Target terdekat" }, { key: "TERLAMA", label: "Terlama" }]);

export const SUMBER = Object.freeze({
  ADMIN: { label: "Rencana Admin", singkat: "Admin", dampak: "Hanya jadwal. Tidak membuka Run, tahap, QC, penerimaan, atau pemakaian bahan." },
  V2: { label: "Pelaksanaan Meja", singkat: "Meja", dampak: "Pekerjaan Meja sudah dibuka: Run, alur Meja/QC dan PIC berjalan dari jadwal ini." },
});

/** Sisa slot satu meja pada satu hari dari data minggu (null bila hari/meja tak dikenal). */
export function sisaMeja(minggu, date, code) {
  const hari = minggu?.days?.find((d) => d.date === date); const s = hari?.stations?.find((x) => x.code === code);
  return s ? Math.max(s.capacity - s.count, 0) : null;
}
export function sisaHari(minggu, date) { const d = minggu?.days?.find((x) => x.date === date); return d ? Math.max(d.kapasitas - d.terencana, 0) : null; }

/**
 * Slot bawaan untuk jadwal baru: hari pertama dari HARI INI (lewati Minggu dan hari yang sudah penuh) dan meja pertama yang masih punya tempat.
 * `exclude` = slot milik unit itu sendiri (tidak dihitung terisi). Kosong bila minggu ini penuh (pengguna memilih sendiri).
 */
export function slotBawaan(minggu, { fromKey = null, exclude = null } = {}) {
  const today = minggu?.today; const mulai = fromKey && fromKey > today ? fromKey : today;
  for (const d of minggu?.days || []) {
    if (d.date < mulai || d.isWeekend) continue;
    const st = d.stations.find((s) => s.count - (exclude && exclude.date === d.date && exclude.station === s.code ? 1 : 0) < s.capacity);
    if (st) return { date: d.date, station: st.code };
  }
  return { date: mulai, station: "" };
}

/** Tindakan utama SATU kartu (satu tombol): server menentukan jalur (ADMIN/V2) dan alasan; UI hanya memetakan ke label. */
export function aksiUtama(item, izin = {}) {
  if (item.sumber === "V2" || item.jalur === "V2") return { kind: "BUKA", label: "Buka ruang kerja" };
  if (!izin.jadwalkan) return { kind: "BUKA", label: "Buka ruang kerja" };
  if (item.sumber === "ADMIN" || item.jadwal) return { kind: "PINDAH", label: "Pindahkan" };
  if (item.perluKeputusan) return { kind: "KEPUTUSAN", label: "Lihat keputusan" };
  return { kind: "JADWALKAN", label: item.diterima === false ? "Jadwalkan lebih awal" : "Jadwalkan" };
}

/** Ringkas kesiapan bahan dan posisi fisik (jujur: tidak menebak). */
export function badgeBahan(bahan) {
  if (!bahan) return { tone: "neutral", text: "Bahan —" };
  if (bahan.key === "LENGKAP") return { tone: "green", text: "Bahan lengkap" };
  if (bahan.key === "KURANG") return { tone: "red", text: "Stok kurang" };
  return { tone: "orange", text: "Tanpa rencana bahan" };
}
export const badgePosisi = (diterima, label) => (diterima ? { tone: "green", text: "Di workshop" } : { tone: "neutral", text: label || "Belum diterima" });

/** Keputusan seret-lepas: unit terjadwal Admin dilepas pada hari lain = pindah tanggal (meja sama bila masih ada tempat; selain itu buka formulir). Jadwal V2 tidak bisa diseret. */
export function keputusanLepas({ item, targetDate, minggu }) {
  if (!item || !targetDate) return { aksi: "ABAIKAN" };
  if (item.sumber === "V2" || item.jadwal?.sumber === "V2") return { aksi: "TOLAK", pesan: "Jadwal Pelaksanaan Meja diatur dari Papan Meja, bukan diseret di sini." };
  if (item.jadwal && item.jadwal.tanggal === targetDate) return { aksi: "ABAIKAN" };
  const meja = item.jadwal?.meja || item.meja || null;
  if (item.jadwal && meja && (sisaMeja(minggu, targetDate, meja) ?? 0) > 0) return { aksi: "PINDAH", tanggal: targetDate, meja };
  return { aksi: "FORMULIR", tanggal: targetDate };
}

/** Keadaan URL (tahan refresh + tombol kembali): minggu, hari terpilih, tab, pencarian, urutan. */
export function bacaUrl(search, { today = todayWib() } = {}) {
  const p = new URLSearchParams(search || "");
  const hari = validKey(p.get("hari")) ? p.get("hari") : today;
  const start = validKey(p.get("minggu")) ? mondayOf(p.get("minggu")) : mondayOf(hari);
  const tab = TABS.some((t) => t.key === p.get("tab")) ? p.get("tab") : "SIAP";
  return { start, hari, tab, q: (p.get("q") || "").slice(0, 80), sort: SORTS.some((s) => s.key === p.get("sort")) ? p.get("sort") : "PRIORITAS" };
}
export function tulisUrl({ start, hari, tab, q, sort }, { today = todayWib() } = {}) {
  const p = new URLSearchParams();
  if (start && start !== mondayOf(today)) p.set("minggu", start);
  if (hari && hari !== today) p.set("hari", hari);
  if (tab && tab !== "SIAP") p.set("tab", tab);
  if (q) p.set("q", q);
  if (sort && sort !== "PRIORITAS") p.set("sort", sort);
  const s = p.toString(); return s ? `?${s}` : "";
}

/** Teks konfirmasi aktivasi Pelaksanaan Meja (HARUS menjelaskan bahwa Run dan alur Meja/QC dibuka). */
export function teksAktivasiV2({ diterima }) {
  return `Mengaktifkan Pelaksanaan Meja MEMBUKA Run untuk unit ini dan alur Meja/QC (tahap, PIC, QC, serah-terima). ${diterima ? "Unit sudah tercatat diterima di workshop, jadi kedatangannya memakai catatan itu dan Run langsung berjalan." : "Unit belum tercatat diterima di workshop, jadi Run menunggu konfirmasi kedatangan oleh petugas."} Jadwal Rencana Admin unit ini akan diambil alih rencana Meja. Tercatat atas nama Anda.`;
}
export function pesanGagalJadwal(e) {
  const c = e?.code || e?.body?.code;
  if (c === "PLAN_STATION_FULL") return "Meja itu sudah penuh pada hari tersebut. Pilih meja atau hari lain.";
  if (c === "JADWAL_REVISI_BASI") return "Jadwal unit ini baru saja diubah orang lain. Daftar sudah dimuat ulang — periksa lalu coba lagi.";
  if (c === "JADWAL_UNIT_BERUBAH") return "Prioritas/target unit ini baru saja diubah orang lain. Muat ulang lalu coba lagi.";
  if (c === "UNIT_V2_OWNED") return "Unit ini sudah dikelola Pelaksanaan Meja — jadwalnya diatur dari Papan Meja.";
  return e?.message || "Jadwal gagal disimpan.";
}
