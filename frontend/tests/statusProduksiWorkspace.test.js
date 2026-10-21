// Ruang Kerja Status Produksi (frontend): model murni + pengawatan komponen. Server tetap penentu data/izin; di sini dijaga yang rawan salah di layar.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAGIAN_KEYS, LIST_PATH, badgeTarget, bacaGulir, bacaKeadaan, bagianUntukAksi, jalurUnit, kelompokkanPipeline, ringkasanPosisi, simpanGulir, tanggalSingkat, teksTahapMeja, tulisKeadaan,
} from "../src/features/production/workspace/workListModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const NOW = new Date("2026-10-21T05:00:00Z");

test("keadaan layar dan URL: nilai bawaan tidak ditulis; nilai tak dikenal jatuh ke bawaan; bolak-balik stabil", () => {
  assert.equal(tulisKeadaan({}).toString(), "");
  const k = { tampilan: "pipeline", scope: "riwayat", q: "Budi", filter: "LEWAT_TARGET", sort: "TARGET", buka: "ord-1" };
  assert.deepEqual(bacaKeadaan(tulisKeadaan(k)), { ...k, unit: null, bagian: "ringkasan" });
  assert.deepEqual(bacaKeadaan(new URLSearchParams("filter=ASAL&sort=X&tampilan=lain&bagian=zzz")), { tampilan: "daftar", scope: "aktif", q: "", filter: "SEMUA", sort: "PERHATIAN", buka: null, unit: null, bagian: "ringkasan" });
  assert.equal(bacaKeadaan(new URLSearchParams(`q=${"x".repeat(200)}`)).q.length, 80);
  assert.equal(tulisKeadaan({ unit: "u1", bagian: "bahan" }).get("bagian"), "bahan");
  assert.equal(tulisKeadaan({ bagian: "bahan" }).get("bagian"), null, "bagian hanya ditulis bersama unit");
});

test("jalur ruang kerja unit: rute tersendiri (Back browser bekerja); bagian valid saja", () => {
  assert.equal(jalurUnit("u1"), `${LIST_PATH}/unit/u1`);
  assert.equal(jalurUnit("u1", "bahan"), `${LIST_PATH}/unit/u1?bagian=bahan`);
  assert.deepEqual(BAGIAN_KEYS, ["ringkasan", "pekerjaan", "bahan", "dokumentasi", "riwayat"]);
  assert.equal(bagianUntukAksi("SET_TARGET"), "pekerjaan"); assert.equal(bagianUntukAksi("PLAN_MATERIAL"), "bahan"); assert.equal(bagianUntukAksi("RECORD_MATERIAL"), "bahan");
  assert.equal(bagianUntukAksi("CONFIRM_ARRIVAL"), "ringkasan"); assert.equal(bagianUntukAksi("NONE"), "ringkasan");
});

test("rincian posisi/kerja order: apa adanya, tidak digabung menjadi label palsu", () => {
  assert.equal(ringkasanPosisi([]), "—");
  assert.equal(ringkasanPosisi([{ label: "Di workshop", jumlah: 1 }]), "Di workshop");
  assert.equal(ringkasanPosisi([{ label: "Di workshop", jumlah: 3 }]), "3 unit · Di workshop");
  assert.equal(ringkasanPosisi([{ label: "Di workshop", jumlah: 2 }, { label: "Menunggu dijemput", jumlah: 1 }]), "2 Di workshop · 1 Menunggu dijemput");
});

test("tahap Meja jujur: tanpa pekerjaan di alur Meja = Belum di alur Meja; menunggu diterima tidak menyebut tahap", () => {
  assert.deepEqual(teksTahapMeja(null), { teks: "Belum di alur Meja", ada: false });
  assert.match(teksTahapMeja({ status: "PENDING_ARRIVAL" }).teks, /Menunggu unit diterima/);
  assert.equal(teksTahapMeja({ status: "ACTIVE", tahap: "Pengerjaan", meja: "TABLE_2" }).teks, "Pengerjaan · Meja 2");
});

test("badge target: lewat/hari ini/besok/tanggal (WIB); tanpa target jujur; selesai tidak merah", () => {
  assert.equal(badgeTarget(null).teks, "Belum ada target");
  assert.equal(badgeTarget("2026-10-18T10:00:00Z", { now: NOW }).teks, "Lewat 3 hari"); assert.equal(badgeTarget("2026-10-18T10:00:00Z", { now: NOW }).nada, "red");
  assert.equal(badgeTarget("2026-10-21T10:00:00Z", { now: NOW }).teks, "Hari ini"); assert.equal(badgeTarget("2026-10-22T10:00:00Z", { now: NOW }).teks, "Besok");
  assert.equal(badgeTarget("2026-10-28T10:00:00Z", { now: NOW }).teks, "28 Okt"); assert.equal(badgeTarget("2026-10-10T10:00:00Z", { now: NOW, selesai: true }).nada, "neutral");
  assert.equal(tanggalSingkat("2027-01-05T00:00:00Z", NOW), "5 Jan 2027");
});

test("pipeline dikelompokkan: tanpa lajur kosong; unit Terkirim/Dibatalkan bukan tahap aktif; unit tanpa alur Meja punya lajur sendiri", () => {
  const it = (id, status) => ({ runId: id, unit: { id, unitCode: id, status } });
  const kolom = [
    { key: "DALAM_PERJALANAN", label: "Dalam Perjalanan", items: [it("a", "RECEIVED"), it("b", "DELIVERED")] }, { key: "TIBA_BELUM_MULAI", label: "Tiba / Belum Mulai", items: [it("c", "RECEIVED")] },
    { key: "BONGKAR", label: "Bongkar", items: [] }, { key: "FONDASI", label: "Fondasi", items: [it("d", "IN_PRODUCTION")] }, { key: "SIAP_KIRIM", label: "Siap Kirim", items: [] },
    { key: "BARU_ASING", label: "Kolom Baru", items: [it("e", "RECEIVED")] },
  ];
  const r = kelompokkanPipeline(kolom, [{ id: "x", unitCode: "x" }]);
  assert.deepEqual(r.lajur.map((l) => l.key), ["MENUJU", "PENGERJAAN", "LAIN", "BELUM_MEJA"]);
  assert.deepEqual(r.lajur[0].items.map((i) => i.unit.unitCode), ["a", "c"]); assert.deepEqual(r.tertinggal.map((i) => i.unit.unitCode), ["b"]); assert.equal(r.jumlah, 5);
  assert.equal(kelompokkanPipeline([], []).lajur.length, 0);
});

test("posisi gulir: sessionStorage, kedaluwarsa, tahan penyimpanan rusak atau tidak tersedia", () => {
  const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
  simpanGulir({ y: 420, tanda: "q=a" }, st); assert.equal(bacaGulir(st).y, 420);
  assert.equal(bacaGulir(st, { now: Date.now() + 31 * 60_000 }), null, "kedaluwarsa");
  mem.set("sp-workspace-gulir", "{rusak"); assert.equal(bacaGulir(st), null);
  assert.doesNotThrow(() => simpanGulir({ y: 1 }, { setItem() { throw new Error("penuh"); } })); assert.equal(bacaGulir(null), null);
});

test("pengawatan: rute daftar + ruang kerja unit; deep link lama dialihkan; URL memuat keadaan; fokus, ARIA, reduced motion; tanpa istilah teknis", () => {
  const reg = src("routes", "pageRegistry.jsx");
  assert.ok(reg.includes('path: "/bengkel/production-v2", render: () => <DemoPage><ProductionStatusPage />')); assert.ok(reg.includes('path: "/bengkel/production-v2/unit/:unitId"'));
  const hal = src("pages", "bengkel", "ProductionStatusPage.jsx");
  for (const k of ["replaceActivePath", 'sp.get("unit")', "openInActiveTab(jalurUnit", "simpanGulir", "pulihkan"]) assert.ok(hal.includes(k), k);
  const daftar = src("features", "production", "workspace", "StatusWorkList.jsx");
  for (const k of ["aria-expanded={terbuka}", "aria-controls={idPanel}", "motion-reduce:", "motion-safe:animate", "getProductionWorkList", 'role="tablist" aria-label="Antrean"', "pintasan-${bagian}"]) assert.ok(daftar.includes(k), k);
  for (const k of ["pekerjaan", "bahan", "dokumentasi", "riwayat"]) assert.ok(daftar.includes(`bagian: "${k}"`), k);
  const ruang = src("features", "production", "workspace", "UnitWorkspace.jsx");
  for (const k of ["sticky", 'role="tablist"', "ArrowRight", "judulRef.current.focus", "confirmProductionV2UnitArrival", "penjelasanTertahan"]) assert.ok(ruang.includes(k), k);
  const dok = src("features", "production", "workspace", "DokumentasiSection.jsx");
  assert.ok(dok.includes("submitProductionV2Documentation")); assert.ok(dok.includes("Tidak menyelesaikan tahap, tidak meluluskan QC, dan tidak membuat bukti serah ke Gudang")); assert.ok(dok.includes("kirimRef.current"));
  const marker = src("features", "production", "workspace", "StatusMarkers.jsx");
  for (const j of ["Order Sales", "Posisi", "Kerja", "Tahap Meja"]) assert.ok(marker.includes(`label: "${j}"`), j);
  const layar = [daftar, ruang, dok, marker, hal].join("\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const teks = [...layar.matchAll(/>([^<>{}]{6,})</g)].map((m) => m[1]).concat([...layar.matchAll(/"([^"\n]{14,})"/g)].map((m) => m[1])).join(" ");
  assert.doesNotMatch(teks, /\b(Run|cohort|custody|handoff|Kerja V1)\b/i);
  assert.ok(src("api.js").includes("getProductionWorkList")); assert.ok(src("api.js").includes("getUnitRuangKerja")); assert.ok(src("components", "Topbar.jsx").includes("Ruang Kerja Unit"));
});

test("editor rencana bahan: satu permintaan per niat (klik ganda tidak menimpa pesan sukses dengan galat tersembunyi)", () => {
  const ed = src("features", "production", "MaterialPlanEditor.jsx");
  assert.ok(ed.includes("const kirimRef = useRef(false)")); assert.ok(ed.includes("if (kirimRef.current ||")); assert.ok(ed.includes("finally { kirimRef.current = false; }"));
});
