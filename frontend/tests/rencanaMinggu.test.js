// Rencana Produksi (kalender mingguan) — model murni + pengawatan komponen. Server tetap penentu aturan jadwal/izin; di sini dijaga yang rawan salah di layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SUMBER, TABS, aksiUtama, isLibur, badgeBahan, bacaUrl, keputusanLepas, labelHari, labelMinggu, labelTanggal, mondayOf, pesanGagalJadwal, shiftKey, sisaMeja, slotBawaan, teksAktivasiV2, tulisUrl, validKey, keputusanLepasMeja, pilihanMeja, badgePosisi, alasanHariTidakBisa, TAB_BAWAAN,
} from "../src/features/production/rencana/rencanaModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const day = (date, o = {}) => ({ date, isWeekend: new Date(`${date}T00:00:00Z`).getUTCDay() === 0, kapasitas: 12, terencana: 0, stations: ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"].map((code) => ({ code, count: 0, capacity: 3 })), ...o });
const minggu = (days) => ({ today: "2026-10-22", start: "2026-10-19", end: "2026-10-25", days });

test("tanggal WIB: Senin minggu, geser hari, label singkat", () => {
  assert.equal(mondayOf("2026-10-22"), "2026-10-19"); assert.equal(mondayOf("2026-10-25"), "2026-10-19"); assert.equal(mondayOf("2026-10-26"), "2026-10-26");
  assert.equal(shiftKey("2026-10-31", 1), "2026-11-01"); assert.equal(labelHari("2026-10-22"), "Kam 22 Okt"); assert.equal(labelTanggal("2026-10-22"), "22 Okt 2026");
  assert.equal(labelMinggu("2026-10-19"), "19–25 Okt 2026"); assert.equal(labelMinggu("2026-10-26"), "26 Okt – 1 Nov 2026");
  assert.ok(validKey("2026-02-28") && !validKey("2026-13-01") && !validKey("besok") && !validKey(null));
});

test("slot bawaan: hari pertama (mulai hari ini, lewati Minggu dan hari penuh) + meja pertama yang masih punya tempat", () => {
  const days = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"].map((d) => day(d));
  assert.deepEqual(slotBawaan(minggu(days)), { date: "2026-10-22", station: "TABLE_1" });
  days[3].stations[0].count = 3; assert.deepEqual(slotBawaan(minggu(days)), { date: "2026-10-22", station: "TABLE_2" }, "meja penuh dilewati");
  for (const s of days[3].stations) s.count = 3; assert.deepEqual(slotBawaan(minggu(days)), { date: "2026-10-23", station: "TABLE_1" }, "hari penuh dilewati");
  for (const d of days.slice(3, 6)) for (const s of d.stations) s.count = 3; assert.deepEqual(slotBawaan(minggu(days)), { date: "2026-10-22", station: "" }, "Minggu tidak dipilih otomatis; minggu penuh = pengguna memilih sendiri");
  assert.equal(sisaMeja(minggu(days), "2026-10-22", "TABLE_1"), 0); assert.equal(sisaMeja(minggu(days), "2026-12-01", "TABLE_1"), null);
});

test("tindakan utama kartu: satu tombol; V2 = buka ruang kerja; hanya-lihat tidak dapat menjadwalkan; belum diterima = 'lebih awal'", () => {
  const izin = { jadwalkan: true };
  assert.equal(aksiUtama({ sumber: "V2" }, izin).kind, "BUKA"); assert.equal(aksiUtama({ jalur: "V2" }, izin).kind, "BUKA");
  assert.deepEqual(aksiUtama({ sumber: "ADMIN" }, izin), { kind: "PILIH_MEJA", label: "Pindahkan" }); assert.equal(aksiUtama({ jadwal: { sumber: "ADMIN" } }, izin).label, "Pindahkan");
  assert.deepEqual(aksiUtama({ diterima: true }, izin), { kind: "PILIH_MEJA", label: "Pilih meja" }); assert.deepEqual(aksiUtama({ diterima: false }, izin), { kind: "PILIH_MEJA", label: "Pilih meja" }, "unit belum tiba: aksi sama (cukup berlabel Belum tiba)");
  assert.equal(aksiUtama({ perluKeputusan: true }, izin).kind, "KEPUTUSAN");
  assert.equal(aksiUtama({ diterima: true }, {}).kind, "BUKA", "tanpa izin menjadwalkan: hanya membuka ruang kerja");
  assert.equal(aksiUtama({ sumber: "ADMIN" }, {}).kind, "BUKA");
});

test("seret-lepas ke HARI: pindah langsung (meja sama bila ada tempat; tanpa meja = hanya tanggal); V2/lewat/Minggu/meja penuh ditolak dengan alasan; hari sama diabaikan; TANPA formulir", () => {
  const days = ["2026-10-22", "2026-10-23"].map((d) => day(d));
  const adm = { sumber: "ADMIN", unitId: "u1", jadwal: { sumber: "ADMIN", tanggal: "2026-10-22", meja: "TABLE_2" } };
  assert.deepEqual(keputusanLepas({ item: adm, targetDate: "2026-10-23", minggu: minggu(days) }), { aksi: "PINDAH", tanggal: "2026-10-23", meja: "TABLE_2" });
  assert.equal(keputusanLepas({ item: adm, targetDate: "2026-10-22", minggu: minggu(days) }).aksi, "ABAIKAN");
  days[1].stations[1].count = 3; const penuh = keputusanLepas({ item: adm, targetDate: "2026-10-23", minggu: minggu(days) }); assert.equal(penuh.aksi, "TOLAK"); assert.match(penuh.pesan, /Meja 2 sudah penuh pada Jum 23 Okt/);
  assert.equal(keputusanLepas({ item: { sumber: "V2", unitId: "u2" }, targetDate: "2026-10-23", minggu: minggu(days) }).aksi, "TOLAK");
  assert.deepEqual(keputusanLepas({ item: { unitId: "u3", jadwal: null }, targetDate: "2026-10-23", minggu: minggu(days) }), { aksi: "PINDAH", tanggal: "2026-10-23", meja: null }, "unit baru dari antrean: langsung hanya tanggal, tanpa formulir");
  assert.match(keputusanLepas({ item: { unitId: "u3", jadwal: null }, targetDate: "2026-10-21", minggu: minggu(days) }).pesan, /sudah lewat/); assert.match(keputusanLepas({ item: { unitId: "u3", jadwal: null }, targetDate: "2026-10-25", minggu: minggu(days) }).pesan, /Minggu libur/);
  assert.ok(!Object.values(keputusanLepas({ item: adm, targetDate: "2026-10-23", minggu: minggu(days) })).includes("FORMULIR"));
  assert.equal(keputusanLepas({ item: null, targetDate: "2026-10-23", minggu: minggu(days) }).aksi, "ABAIKAN");
});

test("URL: keadaan minggu/hari/tab/cari/urut ditulis hanya bila berbeda dari bawaan dan dibaca aman (nilai liar jatuh ke bawaan)", () => {
  const today = "2026-10-22";
  assert.equal(tulisUrl({ start: "2026-10-19", hari: today, tab: "BELUM", q: "", sort: "PRIORITAS" }, { today }), "");
  const s = tulisUrl({ start: "2026-10-26", hari: "2026-10-27", tab: "KEPUTUSAN", q: "Sari", sort: "TARGET" }, { today });
  assert.deepEqual(bacaUrl(s, { today }), { start: "2026-10-26", hari: "2026-10-27", tab: "KEPUTUSAN", q: "Sari", sort: "TARGET" });
  assert.deepEqual(bacaUrl("?tab=LIAR&hari=bukan&sort=X&minggu=2026-99-99", { today }), { start: "2026-10-19", hari: today, tab: "BELUM", q: "", sort: "PRIORITAS" }, "hari bawaan = hari ini; antrean bawaan = satu antrean Belum dijadwalkan");
  assert.equal(TABS.map((t) => t.key).join(), "BELUM,TERJADWAL,KEPUTUSAN", "SATU antrean untuk unit layak (siap + menunggu tiba digabung)");
  assert.equal(bacaUrl("?tab=SIAP", { today }).tab, "BELUM"); assert.equal(bacaUrl("?tab=MENUNGGU_TIBA", { today }).tab, "BELUM", "alamat tersimpan dari versi lama tetap berfungsi"); assert.equal(TAB_BAWAAN, "BELUM");
});

test("teks dampak: Rencana Admin = hanya jadwal; aktivasi V2 WAJIB menyebut Run dan alur Meja/QC dibuka; pesan galat ramah", () => {
  assert.match(SUMBER.ADMIN.dampak, /Tidak membuka Run, tahap, QC, penerimaan, atau pemakaian bahan/); assert.match(SUMBER.V2.dampak, /Run, alur Meja\/QC/);
  for (const diterima of [true, false]) { const t = teksAktivasiV2({ diterima }); assert.match(t, /MEMBUKA Run/); assert.match(t, /Meja\/QC/); assert.match(t, /diambil alih rencana Meja/); }
  assert.match(teksAktivasiV2({ diterima: false }), /menunggu konfirmasi kedatangan/); assert.match(teksAktivasiV2({ diterima: true }), /langsung berjalan/);
  assert.match(pesanGagalJadwal({ code: "PLAN_STATION_FULL" }), /penuh/); assert.match(pesanGagalJadwal({ code: "JADWAL_REVISI_BASI" }), /baru saja diubah/); assert.match(pesanGagalJadwal({ code: "UNIT_V2_OWNED" }), /Papan Meja/);
  assert.deepEqual([badgeBahan({ key: "LENGKAP" }).tone, badgeBahan({ key: "KURANG" }).tone, badgeBahan({ key: "TIDAK_ADA_RENCANA" }).tone], ["green", "red", "neutral"], "rencana bahan OPSIONAL: tidak diwarnai peringatan");
  assert.deepEqual(badgePosisi(false), { tone: "orange", text: "Belum tiba" }); assert.deepEqual(badgePosisi(true), { tone: "green", text: "Di workshop" });
});

test("pengawatan: rute baru memakai kalender mingguan, Papan V2 lama tetap ada; aktivasi berkonfirmasi terpisah; tidak ada panggilan Run/QC/penerimaan dari halaman ini; shell bertab", () => {
  const reg = src("routes", "pageRegistry.jsx");
  assert.match(reg, /path: "\/bengkel\/rencana-produksi", render: \(\) => <DemoPage><ProductionRencanaMinggu \/>/); assert.match(reg, /path: "\/bengkel\/rencana-produksi\/papan-v2", render: \(\) => <DemoPage><ProductionRencanaWorkspace \/>/);
  const page = src("pages", "bengkel", "ProductionRencanaMinggu.jsx");
  assert.match(page, /replaceActivePath/); assert.doesNotMatch(page, /setSearchParams\s*\(|setParams\s*\(/, "shell bertab: query lewat replaceActivePath");
  assert.match(page, /createPortal/, "pesan/undo di atas banner pasang aplikasi");
  for (const dilarang of ["confirmProductionV2UnitArrival", "catatPenerimaanWorkshop", "postStatusKerjaManual", "putRencanaBahan", "planProductionV2Unit", "createProductionPlan"]) assert.ok(!page.includes(dilarang), `halaman jadwal tidak boleh memanggil ${dilarang}`);
  const akt = src("features", "production", "rencana", "AktivasiV2Modal.jsx");
  assert.match(akt, /activateUnit: true/); assert.match(akt, /aktivasi-paham/); assert.match(akt, /disabled=\{!bisa\}/);
  const kartu = src("features", "production", "rencana", "KartuUnit.jsx"); assert.match(kartu, /draggable=\{\(draggable && !pending\) \|\| undefined\}/); assert.match(kartu, /aria-label=\{`Tindakan lain untuk/);
  const modal = src("features", "production", "rencana", "JadwalModal.jsx"); assert.match(modal, /jadwalkanUnit/); assert.match(modal, /expectedRevision: revisi/); assert.match(modal, /kunci\.current = null/, "kunci idempotensi diganti hanya setelah sukses/revisi basi (klik ulang = kunci sama)");
});

test("kapasitas Minggu: Minggu libur (isLibur), slot bawaan melewati hari libur walau kosong; pesan galat hari libur", () => {
  assert.equal(isLibur("2026-10-25"), true); assert.equal(isLibur("2026-10-24"), false); assert.equal(isLibur("bukan"), false);
  const days = ["2026-10-24", "2026-10-25", "2026-10-26"].map((d) => ({ date: d, hariKerja: new Date(`${d}T00:00:00Z`).getUTCDay() !== 0, stations: ["TABLE_1"].map((code) => ({ code, count: 0, capacity: new Date(`${d}T00:00:00Z`).getUTCDay() === 0 ? 0 : 3 })) }));
  days[0].stations[0].count = 3;
  assert.deepEqual(slotBawaan({ today: "2026-10-24", days }), { date: "2026-10-26", station: "TABLE_1" }, "Sabtu penuh, Minggu libur dilewati → Senin");
  assert.equal(sisaMeja({ days }, "2026-10-25", "TABLE_1"), 0, "meja hari libur tanpa tempat");
  assert.match(pesanGagalJadwal({ code: "JADWAL_HARI_LIBUR" }), /Minggu libur/);
});

test("pengawatan: kepala ringkas untuk HP (menu tambahan memuat Muat ulang/Export/Papan Meja/Corner), tautan Papan Meja + Corner di desktop, papan lama punya tautan kembali; kontras gelap lewat rencana.css", () => {
  const page = src("pages", "bengkel", "ProductionRencanaMinggu.jsx");
  assert.match(page, /useSempit/); assert.match(page, /data-testid="header-mobile"/); assert.match(page, /MenuHalaman/);
  for (const label of ["Muat ulang", "Export Excel", "Papan Meja (harian)", "Corner"]) assert.ok(page.includes(`label: "${label}"`), `menu HP: ${label}`);
  assert.match(page, /tampilan=corner/); assert.match(page, /data-testid="link-corner"/); assert.match(page, /data-testid="link-papan-meja"/);
  assert.match(page, /minggu\.ringkasan\.slotKerja/, "ringkasan minggu dari server (hari kerja saja)");
  const lama = src("pages", "bengkel", "ProductionRencanaWorkspace.jsx"); assert.match(lama, /data-testid="link-jadwal-mingguan"/); assert.match(lama, /searchParams\.get\("tampilan"\) === "corner"/);
  const css = src("features", "production", "rencana", "rencana.css"); for (const k of ["rc-cta", "rc-sek", "rc-b-accent", "rc-b-red", "rc-tab-on"]) assert.ok(css.includes(k), k); assert.match(css, /\[data-theme="dark"\]/);
  const kal = src("features", "production", "rencana", "RencanaKalender.jsx"); assert.match(kal, /data-libur=/); assert.match(kal, /Libur/); assert.doesNotMatch(kal, /opacity-70/, "hari lampau tidak diredupkan (kontras)");
  assert.match(src("features", "production", "rencana", "KartuUnit.jsx"), /createPortal/, "menu kartu lewat portal (tidak tertutup kartu lain)");
});

test("penempatan: keputusan lepas/pilih MEJA — satu unit, beberapa unit bersama (semua atau tidak sama sekali), hari lewat/Minggu, V2, sudah di meja itu", () => {
  const days = ["2026-10-22", "2026-10-23", "2026-10-25"].map((d) => day(d)); const m = minggu(days);
  const u = (id, jadwal = null, extra = {}) => ({ unitId: id, unitCode: id.toUpperCase(), jadwal, ...extra });
  assert.deepEqual(keputusanLepasMeja({ items: [u("a")], date: "2026-10-22", meja: "TABLE_1", minggu: m }), { aksi: "SIMPAN", items: [u("a")], tanggal: "2026-10-22", meja: "TABLE_1" });
  assert.equal(keputusanLepasMeja({ items: [u("a", { sumber: "ADMIN", tanggal: "2026-10-22", meja: "TABLE_1" })], date: "2026-10-22", meja: "TABLE_1", minggu: m }).aksi, "ABAIKAN", "sudah di meja itu");
  days[0].stations[0].count = 2; // Meja 1 sisa 1
  const dua = keputusanLepasMeja({ items: [u("a"), u("b")], date: "2026-10-22", meja: "TABLE_1", minggu: minggu(days) });
  assert.equal(dua.aksi, "TOLAK"); assert.match(dua.pesan, /hanya punya 1 tempat kosong/); assert.match(dua.pesan, /Tidak ada yang disimpan/, "tidak setengah tersimpan: dijelaskan");
  assert.equal(keputusanLepasMeja({ items: [u("a"), u("b")], date: "2026-10-22", meja: "TABLE_2", minggu: minggu(days) }).aksi, "SIMPAN", "meja lain muat dua unit");
  days[0].stations[0].count = 3; assert.match(keputusanLepasMeja({ items: [u("a")], date: "2026-10-22", meja: "TABLE_1", minggu: minggu(days) }).pesan, /sudah penuh/);
  assert.match(keputusanLepasMeja({ items: [u("a")], date: "2026-10-21", meja: "TABLE_1", minggu: m }).pesan, /sudah lewat/); assert.match(keputusanLepasMeja({ items: [u("a")], date: "2026-10-25", meja: "TABLE_1", minggu: m }).pesan, /Minggu libur/);
  assert.match(keputusanLepasMeja({ items: [u("a", null, { sumber: "V2" })], date: "2026-10-22", meja: "TABLE_1", minggu: m }).pesan, /Papan Meja/);
  assert.equal(keputusanLepasMeja({ items: [], date: "2026-10-22", meja: "TABLE_1", minggu: m }).aksi, "ABAIKAN");
  assert.equal(alasanHariTidakBisa("2026-10-22", m), null);
  const pil = pilihanMeja(minggu(days), "2026-10-22", { jumlah: 2 }); assert.deepEqual(pil.map((p) => [p.code, p.sisa, p.muat]), [["TABLE_1", 0, false], ["TABLE_2", 3, true], ["TABLE_3", 3, true], ["TABLE_4", 3, true]]);
  assert.equal(pilihanMeja(minggu(days), "2026-10-22", { sudahDi: "TABLE_1" })[0].sisa, 1, "meja tempat unit sekarang berada dihitung lowong untuk dirinya");
  assert.equal(pilihanMeja(minggu(days), "2026-12-01")[0].sisa, null, "hari di luar minggu termuat: server yang memutuskan");
});

test("pengawatan: seret/Pilih meja memakai SATU jalur simpan (jadwalkanUnit / jadwalkanBatch); indikator Menyimpan; Urungkan unit & batch; pemilih meja dapat diakses keyboard; tanpa modal pada seret-lepas", () => {
  const page = src("pages", "bengkel", "ProductionRencanaMinggu.jsx");
  assert.match(page, /api\.jadwalkanUnit/); assert.match(page, /api\.jadwalkanBatch/); assert.match(page, /api\.undoJadwalBatch/); assert.match(page, /api\.undoJadwalUnit/);
  assert.match(page, /tone: "busy"/); assert.match(page, /Menyimpan/); assert.match(page, /pendingIds/); assert.match(page, /data-testid="seleksi-bar"/); assert.match(page, /PILIH_MEJA/);
  const lepas = page.slice(page.indexOf("function lepasKeHari"), page.indexOf("const toggle"));
  assert.doesNotMatch(lepas, /setModal/, "seret-lepas tidak membuka modal tanggal/target/PIC/rencana bahan");
  const pm = src("features", "production", "rencana", "PilihMeja.jsx"); assert.match(pm, /role="dialog"/); assert.match(pm, /key === "Escape"/); assert.match(pm, /\.focus\(\)/, "fokus ke meja pertama saat dibuka"); assert.match(pm, /min-h-\[44px\]/, "target sentuh 44px"); assert.match(pm, /data-meja="AUTO"/);
  const kartu = src("features", "production", "rencana", "KartuUnit.jsx"); assert.match(kartu, /data-testid="kartu-pilih"/); assert.match(kartu, /kartu-unit-order/); assert.match(kartu, /kartu-menyimpan/);
  const api = src("api.js"); assert.match(api, /jadwalkanBatch:/); assert.match(api, /undoJadwalBatch:/);
  assert.doesNotMatch(page, /\bhttps?:\/\//);
});
