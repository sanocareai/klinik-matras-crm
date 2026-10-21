// Daftar kerja Status Produksi — fungsi MURNI: perhatian utama, rollup order, filter cepat, urutan.
import test from "node:test";
import assert from "node:assert/strict";
import { ATTENTION, WORK_FILTER_KEYS, tindakanTersedia, hitungFilter, lewatTarget, lolosFilter, perhatianUnit, ringkasOrder, urutkanOrder } from "../src/lib/domain/productionWorkList.js";

const NOW = new Date("2026-10-21T05:00:00Z"); // 12.00 WIB
const unit = (over = {}) => ({
  id: over.id ?? "u1", unitCode: over.unitCode ?? "U-1", status: "RECEIVED", order: { status: "PROCESSING" }, priorityDisplay: { key: "NORMAL" },
  adopsi: { posisi: { key: "DI_WORKSHOP", label: "Di workshop" }, kerja: { key: "DIJADWALKAN", label: "Dijadwalkan" }, targetSelesai: { at: "2026-10-30T10:00:00Z" }, pic: { nama: "Rina" }, tindakan: { aksi: "START_WORK", label: "Mulai pekerjaan" }, ...(over.adopsi || {}) },
  ...Object.fromEntries(Object.entries(over).filter(([k]) => !["adopsi", "id", "unitCode"].includes(k))),
});

test("perhatian utama: urutan alasan, tingkat, dan teks jujur dari fakta tercatat", () => {
  assert.equal(perhatianUnit(unit({ priorityDisplay: { key: "COMPLAINT" } }), { now: NOW }).kode, "KOMPLAIN");
  const belum = perhatianUnit(unit({ adopsi: { posisi: { key: "SUDAH_DIJEMPUT", label: "x" } } }), { now: NOW });
  assert.deepEqual([belum.kode, belum.level], ["BELUM_DITERIMA", ATTENTION.HIGH], "dengan jalur penerimaan resmi, belum diterima selalu bisa ditindak (dengan atau tanpa alur Meja)");
  const tunda = perhatianUnit(unit({ adopsi: { kerja: { key: "TERTUNDA", label: "Tertunda", manual: { note: "kain belum datang" } } } }), { now: NOW });
  assert.equal(tunda.kode, "TERTUNDA"); assert.match(tunda.teks, /kain belum datang/);
  const lewat = perhatianUnit(unit({ adopsi: { targetSelesai: { at: "2026-10-19T10:00:00Z" } } }), { now: NOW });
  assert.equal(lewat.kode, "LEWAT_TARGET"); assert.match(lewat.teks, /19 Okt 2026/);
  assert.equal(perhatianUnit(unit({ adopsi: { kerja: { key: "MENUNGGU_QC", label: "q" } } }), { now: NOW }).level, ATTENTION.MEDIUM);
  assert.equal(perhatianUnit(unit({ adopsi: { kerja: { key: "SELESAI", label: "s" } } }), { now: NOW }).kode, "TANDAI_SIAP_KIRIM");
  assert.equal(perhatianUnit(unit({ order: { status: "PICKUP" } }), { now: NOW }).kode, "ORDER_MASIH_PENGAMBILAN");
  assert.equal(perhatianUnit(unit({ adopsi: { targetSelesai: null } }), { now: NOW }).kode, "BELUM_ADA_TARGET");
  assert.equal(perhatianUnit(unit({ adopsi: { kerja: { key: "BELUM_DIJADWALKAN", label: "b" } } }), { now: NOW }).kode, "BELUM_DIJADWALKAN");
  assert.equal(perhatianUnit(unit(), { now: NOW }), null, "unit sehat tidak butuh perhatian");
  assert.equal(perhatianUnit(unit({ status: "DELIVERED", adopsi: { posisi: { key: "SUDAH_DIJEMPUT" } } }), { now: NOW }), null, "unit terkirim tidak pernah butuh perhatian");
  assert.equal(perhatianUnit(unit({ status: "CANCELLED" }), { now: NOW }), null);
});

test("lewat target: dihitung per hari WIB; selesai/terkirim/tanpa target tidak pernah lewat", () => {
  assert.equal(lewatTarget("2026-10-21T16:30:00Z", { now: NOW, kerjaKey: "DIKERJAKAN", unitStatus: "RECEIVED" }), false, "21 Okt 23.30 WIB = hari ini");
  assert.equal(lewatTarget("2026-10-20T16:30:00Z", { now: NOW, kerjaKey: "DIKERJAKAN", unitStatus: "RECEIVED" }), true, "20 Okt 23.30 WIB = kemarin");
  assert.equal(lewatTarget("2026-10-20T10:00:00Z", { now: NOW, kerjaKey: "DIKERJAKAN", unitStatus: "RECEIVED" }), true);
  assert.equal(lewatTarget("2026-10-10T10:00:00Z", { now: NOW, kerjaKey: "SELESAI", unitStatus: "RECEIVED" }), false);
  assert.equal(lewatTarget("2026-10-10T10:00:00Z", { now: NOW, kerjaKey: "DIKERJAKAN", unitStatus: "DELIVERED" }), false);
  assert.equal(lewatTarget(null, { now: NOW }), false);
});

test("rollup order: rincian (tanpa label campuran palsu), perhatian utama dari unit paling mendesak, target terdekat, PIC unik", () => {
  const a = unit({ id: "a", unitCode: "A", adopsi: { targetSelesai: { at: "2026-10-28T10:00:00Z" } } });
  const b = unit({ id: "b", unitCode: "B", adopsi: { posisi: { key: "SUDAH_DIJEMPUT", label: "Sudah dijemput · belum diterima workshop" }, targetSelesai: { at: "2026-10-25T10:00:00Z" }, pic: { nama: "Andi" }, tindakan: { aksi: "CONFIRM_ARRIVAL" } } });
  const c = unit({ id: "c", unitCode: "C", status: "DELIVERED" });
  const r = ringkasOrder([a, b, c], { now: NOW });
  assert.equal(r.jumlahUnit, 3); assert.equal(r.jumlahAktif, 2);
  assert.deepEqual(r.posisi.map((p) => `${p.jumlah} ${p.label}`).sort(), ["1 Di workshop", "1 Sudah dijemput · belum diterima workshop"]);
  assert.equal(r.perhatian.kode, "BELUM_DITERIMA"); assert.equal(r.perhatian.unitCode, "B"); assert.equal(r.unitUtamaId, "b"); assert.equal(r.tindakan.aksi, "CONFIRM_ARRIVAL");
  assert.equal(r.targetTerdekat, "2026-10-25T10:00:00.000Z"); assert.deepEqual(r.pic.sort(), ["Andi", "Rina"]);
  const selesai = ringkasOrder([unit({ status: "DELIVERED" })], { now: NOW }); assert.equal(selesai.jumlahAktif, 0); assert.equal(selesai.perhatian, null);
});

test("filter cepat + urutan: perlu tindakan, belum diterima, belum dijadwalkan, lewat target; urut perhatian lalu target lalu terbaru", () => {
  const mk = (id, over, dibuat) => { const u = unit({ id, unitCode: id, ...over }); return { orderId: id, dibuatAt: dibuat, pelanggan: { nama: id }, units: [u], ringkas: ringkasOrder([u], { now: NOW }) }; };
  const sehat = mk("sehat", {}, "2026-10-10T00:00:00Z");
  const belum = mk("belum", { adopsi: { posisi: { key: "SUDAH_DIJEMPUT", label: "x" } } }, "2026-10-11T00:00:00Z");
  const bjadwal = mk("bjadwal", { adopsi: { kerja: { key: "BELUM_DIJADWALKAN", label: "b" }, targetSelesai: { at: "2026-10-29T10:00:00Z" } } }, "2026-10-12T00:00:00Z");
  const lewat = mk("lewat", { adopsi: { kerja: { key: "DIKERJAKAN", label: "d" }, targetSelesai: { at: "2026-10-15T10:00:00Z" } } }, "2026-10-13T00:00:00Z");
  const semua = [sehat, belum, bjadwal, lewat];
  const c = hitungFilter(semua, { now: NOW });
  assert.deepEqual(WORK_FILTER_KEYS, Object.keys(c));
  assert.deepEqual([c.SEMUA, c.PERLU_TINDAKAN, c.BELUM_DITERIMA, c.BELUM_DIJADWALKAN, c.DIKERJAKAN, c.LEWAT_TARGET], [4, 2, 1, 1, 1, 1]);
  assert.equal(lolosFilter("PERLU_TINDAKAN", sehat, { now: NOW }), false);
  assert.deepEqual(urutkanOrder(semua, "PERHATIAN").slice(0, 2).map((o) => o.orderId).sort(), ["belum", "lewat"], "tingkat tinggi di atas");
  assert.equal(urutkanOrder(semua, "PERHATIAN").at(-1).orderId, "sehat");
  assert.equal(urutkanOrder(semua, "TARGET")[0].orderId, "lewat"); assert.equal(urutkanOrder(semua, "TERBARU")[0].orderId, "lewat"); assert.equal(urutkanOrder(semua, "PELANGGAN")[0].orderId, "belum");
});

test("tindakan tersedia: dipakai apa adanya dari server (Catat diterima adalah tindakan nyata dengan penerimaan resmi)", () => {
  const ad = { tindakan: { aksi: "CONFIRM_ARRIVAL", label: "Konfirmasi unit diterima di workshop" } };
  assert.equal(tindakanTersedia(ad).aksi, "CONFIRM_ARRIVAL"); assert.equal(tindakanTersedia({ tindakan: { aksi: "START_WORK" } }).aksi, "START_WORK"); assert.equal(tindakanTersedia({}), null);
});
