// Rencana Produksi (kalender mingguan) — logika MURNI (tanpa React/DOM): tanggal WIB, tab antrean, slot bawaan, keputusan seret-lepas, tindakan utama kartu, keadaan URL.
// Aturan jadwal sebenarnya ada di server (lib/domain/productionRencanaAdmin.js); fungsi di sini hanya membantu tampilan dan TIDAK menjadi sumber kebenaran.

export const HARI_PENDEK = Object.freeze(["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"]);
const BULAN = Object.freeze(["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]);
const DAY_MS = 86_400_000;

export const shiftKey = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
export const mondayOf = (key) => { const d = new Date(`${key}T00:00:00Z`).getUTCDay(); return shiftKey(key, d === 0 ? -6 : 1 - d); };
export const todayWib = (now = new Date()) => new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
export const isLibur = (key) => validKey(key) && new Date(`${key}T00:00:00Z`).getUTCDay() === 0; // Minggu = libur (satu aturan dengan server: lib/domain/productionRencanaAdmin.js HARI_LIBUR)
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

// SATU antrean untuk semua unit aktif yang layak dijadwalkan (BELUM). Unit yang belum tiba tetap di sini dan hanya diberi label "Belum tiba".
export const TABS = Object.freeze([
  { key: "BELUM", label: "Belum dijadwalkan", hint: "Semua unit aktif yang layak dijadwalkan. Unit yang belum tiba boleh direncanakan (berlabel Belum tiba)." },
  { key: "TERJADWAL", label: "Terjadwal", hint: "Sudah punya tanggal (Rencana Admin atau Pelaksanaan Meja)." },
  { key: "KEPUTUSAN", label: "Butuh keputusan", hint: "Ada hambatan konkret yang perlu diputuskan manusia." },
]);
export const TAB_BAWAAN = "BELUM";
export const TAB_LAMA = Object.freeze({ SIAP: "BELUM", MENUNGGU_TIBA: "BELUM" }); // alamat tersimpan dari versi sebelumnya tetap berfungsi
export const KODE_MEJA = Object.freeze(["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"]);
export const mejaTeks = (c) => (c ? `Meja ${String(c).replace("TABLE_", "")}` : "Tanpa meja");
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
    if (d.date < mulai || d.hariKerja === false || d.isWeekend) continue;
    const st = d.stations.find((s) => s.count - (exclude && exclude.date === d.date && exclude.station === s.code ? 1 : 0) < s.capacity);
    if (st) return { date: d.date, station: st.code };
  }
  return { date: mulai, station: "" };
}

/** Tindakan utama SATU kartu (satu tombol): server menentukan jalur (ADMIN/V2) dan alasan; UI hanya memetakan ke label. */
export function aksiUtama(item, izin = {}) {
  if (item.sumber === "V2" || item.jalur === "V2") return { kind: "BUKA", label: "Buka ruang kerja" };
  if (!izin.jadwalkan) return { kind: "BUKA", label: "Buka ruang kerja" };
  if (item.sumber === "ADMIN" || item.jadwal) return { kind: "PILIH_MEJA", label: "Pindahkan" };
  if (item.perluKeputusan) return { kind: "KEPUTUSAN", label: "Lihat keputusan" };
  return { kind: "PILIH_MEJA", label: "Pilih meja" }; // alternatif seret untuk HP dan keyboard: layanan yang sama, satu ketukan
}

/** Ringkas kesiapan bahan dan posisi fisik (jujur: tidak menebak). */
export function badgeBahan(bahan) {
  if (!bahan) return { tone: "neutral", text: "Bahan —" };
  if (bahan.key === "LENGKAP") return { tone: "green", text: "Bahan lengkap" };
  if (bahan.key === "KURANG") return { tone: "red", text: "Stok kurang" };
  return { tone: "neutral", text: "Tanpa rencana bahan" }; // rencana bahan OPSIONAL untuk menjadwalkan: tidak diwarnai peringatan
}
export const badgePosisi = (diterima) => (diterima ? { tone: "green", text: "Di workshop" } : { tone: "orange", text: "Belum tiba" });

/**
 * Keputusan LEPAS di sel HARI (kalender mingguan). Tidak ada formulir: hasilnya PINDAH (langsung menyimpan), ABAIKAN (tidak ada perubahan), atau TOLAK (kartu tetap di tempatnya + alasan singkat).
 * Unit dengan meja: meja sama dipertahankan bila masih ada tempat, selain itu ditolak (tidak menebak meja lain). Unit tanpa meja: hanya tanggal. Jadwal Pelaksanaan Meja tidak bisa diseret.
 */
export function keputusanLepas({ item, targetDate, minggu }) {
  if (!item || !targetDate) return { aksi: "ABAIKAN" };
  if (item.sumber === "V2" || item.jadwal?.sumber === "V2" || item.jalur === "V2") return { aksi: "TOLAK", pesan: "Jadwal Pelaksanaan Meja diatur dari Papan Meja, bukan diseret di sini." };
  const bukan = alasanHariTidakBisa(targetDate, minggu); if (bukan) return { aksi: "TOLAK", pesan: bukan };
  if (item.jadwal && item.jadwal.tanggal === targetDate) return { aksi: "ABAIKAN" };
  const meja = item.jadwal?.meja || item.meja || null;
  if (!meja) return { aksi: "PINDAH", tanggal: targetDate, meja: null };
  if ((sisaMeja(minggu, targetDate, meja) ?? 1) > 0) return { aksi: "PINDAH", tanggal: targetDate, meja };
  return { aksi: "TOLAK", pesan: `${mejaTeks(meja)} sudah penuh pada ${labelHari(targetDate)}. Seret ke meja lain pada hari itu.` };
}

/** Alasan singkat hari tidak bisa dijadwalkan (null = boleh): lewat, Minggu libur. Server tetap penentu; ini hanya menghindari perjalanan sia-sia. */
export function alasanHariTidakBisa(date, minggu) {
  const today = minggu?.today;
  if (today && validKey(date) && date < today) return "Tanggal itu sudah lewat. Pilih hari ini atau sesudahnya.";
  if (isLibur(date)) return "Hari Minggu libur (bukan hari kerja rutin). Pilih Senin sampai Sabtu.";
  return null;
}

/**
 * Keputusan LEPAS/PILIH di MEJA pada hari `date` untuk satu atau beberapa unit. Penempatan bersama: semua unit ke meja yang sama, SEMUA atau tidak sama sekali —
 * bila sisa tempat < jumlah unit yang BELUM ada di meja itu, ditolak dengan penjelasan (tidak setengah tersimpan).
 */
export function keputusanLepasMeja({ items, date, meja, minggu }) {
  const daftar = (items || []).filter(Boolean); if (!daftar.length || !date) return { aksi: "ABAIKAN" };
  if (daftar.some((it) => it.sumber === "V2" || it.jadwal?.sumber === "V2" || it.jalur === "V2")) return { aksi: "TOLAK", pesan: "Jadwal Pelaksanaan Meja diatur dari Papan Meja, bukan diseret di sini." };
  const bukan = alasanHariTidakBisa(date, minggu); if (bukan) return { aksi: "TOLAK", pesan: bukan };
  const perlu = daftar.filter((it) => !(it.jadwal?.tanggal === date && (it.jadwal?.meja || null) === (meja || null)));
  if (!perlu.length) return { aksi: "ABAIKAN" };
  if (meja) {
    const sisa = sisaMeja(minggu, date, meja);
    if (sisa != null && sisa < perlu.length) return { aksi: "TOLAK", pesan: perlu.length === 1 ? `${mejaTeks(meja)} sudah penuh pada ${labelHari(date)}. Pilih meja atau hari lain.` : `${mejaTeks(meja)} hanya punya ${sisa} tempat kosong pada ${labelHari(date)} untuk ${perlu.length} unit. Tidak ada yang disimpan — pilih meja lain atau kurangi unit.` };
  }
  return { aksi: "SIMPAN", items: perlu, tanggal: date, meja: meja || null };
}

/** Daftar pilihan meja untuk satu hari (pemilih meja HP/keyboard): sisa tempat per meja; `jumlah` = unit yang akan ditempatkan, `sudahDi` = meja tempat unit tunggal itu sekarang berada (dihitung ikut lowong). */
export function pilihanMeja(minggu, date, { jumlah = 1, sudahDi = null } = {}) {
  return KODE_MEJA.map((code) => { const raw = sisaMeja(minggu, date, code); const sisa = raw == null ? null : raw + (sudahDi === code ? 1 : 0); return { code, label: mejaTeks(code), sisa, muat: sisa == null ? true : sisa >= jumlah }; });
}

/** Keadaan URL (tahan refresh + tombol kembali): minggu, hari terpilih, tab, pencarian, urutan. */
export function bacaUrl(search, { today = todayWib() } = {}) {
  const p = new URLSearchParams(search || "");
  const hari = validKey(p.get("hari")) ? p.get("hari") : today;
  const start = validKey(p.get("minggu")) ? mondayOf(p.get("minggu")) : mondayOf(hari);
  const mentah = TAB_LAMA[p.get("tab")] || p.get("tab"); const tab = TABS.some((t) => t.key === mentah) ? mentah : TAB_BAWAAN;
  return { start, hari, tab, q: (p.get("q") || "").slice(0, 80), sort: SORTS.some((s) => s.key === p.get("sort")) ? p.get("sort") : "PRIORITAS" };
}
export function tulisUrl({ start, hari, tab, q, sort }, { today = todayWib() } = {}) {
  const p = new URLSearchParams();
  if (start && start !== mondayOf(today)) p.set("minggu", start);
  if (hari && hari !== today) p.set("hari", hari);
  if (tab && tab !== TAB_BAWAAN) p.set("tab", tab);
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
  if (c === "JADWAL_HARI_LIBUR") return "Hari Minggu libur (bukan hari kerja rutin). Pilih Senin sampai Sabtu.";
  if (c === "JADWAL_TANGGAL_LEWAT") return "Tanggal itu sudah lewat. Pilih hari ini atau sesudahnya.";
  if (c === "PLAN_STATION_FULL") return e?.message && /Tidak ada yang disimpan/.test(e.message) ? e.message : "Meja itu sudah penuh pada hari tersebut. Pilih meja atau hari lain.";
  if (c === "JADWAL_SUDAH_DI_RENCANA_MEJA") return e?.message || "Unit ini sudah punya jadwal di rencana Meja. Ubah dari Papan Meja.";
  if (c === "JADWAL_UNDO_TIDAK_BISA") return e?.message || "Tidak bisa diurungkan: jadwal sudah berubah sesudahnya.";
  if (c === "JADWAL_REVISI_BASI") return "Jadwal unit ini baru saja diubah orang lain. Daftar sudah dimuat ulang — periksa lalu coba lagi.";
  if (c === "JADWAL_UNIT_BERUBAH") return "Prioritas/target unit ini baru saja diubah orang lain. Muat ulang lalu coba lagi.";
  if (c === "UNIT_V2_OWNED") return "Unit ini sudah dikelola Pelaksanaan Meja — jadwalnya diatur dari Papan Meja.";
  return e?.message || "Jadwal gagal disimpan.";
}
