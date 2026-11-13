// Rencana Produksi — tandai tiba & ubah ke Diproses langsung dari kartu (keputusan Owner 12 Nov 2026: Produksi tidak menunggu Armada/Sales).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aksiUtama, pickupBelumDitutup, teksHasilTiba } from "../src/features/production/rencana/rencanaModel.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("pickup belum ditutup hanya untuk unit yang masih di pelanggan / di jalan", () => {
  assert.equal(pickupBelumDitutup({ posisi: { key: "MENUNGGU_DIJEMPUT" } }), true);
  assert.equal(pickupBelumDitutup({ posisi: { key: "DALAM_PENJEMPUTAN" } }), true);
  assert.equal(pickupBelumDitutup({ posisi: { key: "SUDAH_DIJEMPUT" } }), false);
  assert.equal(pickupBelumDitutup({}), false);
});

test("teks hasil: satu unit, beberapa unit, sebagian gagal", () => {
  assert.equal(teksHasilTiba([{ ok: true, unitCode: "U1", pickupDitutup: true }]), "U1 diterima di workshop · pickup ditutup");
  assert.equal(teksHasilTiba([{ ok: true, unitCode: "U1" }]), "U1 diterima di workshop");
  assert.equal(teksHasilTiba([{ ok: true, unitCode: "U1", pickupDitutup: true }, { ok: true, unitCode: "U2" }]), "2 unit diterima di workshop · 1 pickup ditutup");
  assert.equal(teksHasilTiba([{ ok: true, unitCode: "U1" }, { ok: false, unitCode: "U2", pesan: "Lokasi belum diatur" }]), "U1 diterima di workshop. U2: Lokasi belum diatur");
  assert.equal(teksHasilTiba([{ ok: false, unitCode: "U2", pesan: "x" }]), "U2: x");
});

test("order masih Pengambilan: tombol utama 'Ubah ke Diproses' hanya untuk pemegang izin status order", () => {
  const it = { perluKeputusan: true, penghalang: "ORDER_MASIH_PENGAMBILAN" };
  assert.equal(aksiUtama(it, { jadwalkan: true, statusOrder: true }).kind, "DIPROSES");
  assert.equal(aksiUtama(it, { jadwalkan: true }).kind, "KEPUTUSAN");
  assert.equal(aksiUtama({ perluKeputusan: true, penghalang: "LAIN" }, { jadwalkan: true, statusOrder: true }).kind, "KEPUTUSAN");
});

test("seret pointer: sasaran dibaca dari data-drop (hari/meja); di luar sasaran = null", async () => {
  const { bacaSasaran } = await import("../src/features/production/rencana/useSeretPointer.js");
  const el = (v) => ({ closest: () => (v ? { getAttribute: () => v } : null) });
  assert.deepEqual(bacaSasaran(el("hari:2026-11-12")), { jenis: "hari", nilai: "2026-11-12", kunci: "hari:2026-11-12" });
  assert.deepEqual(bacaSasaran(el("meja:TABLE_2")), { jenis: "meja", nilai: "TABLE_2", kunci: "meja:TABLE_2" });
  assert.equal(bacaSasaran(el(null)), null); assert.equal(bacaSasaran(null), null);
  const kal = src("features", "production", "rencana", "RencanaKalender.jsx");
  assert.match(kal, /data-drop=\{dragAktif && !libur \? `hari:/); assert.match(kal, /data-drop=\{dragAktif && s\.capacity > 0 \? `meja:/);
  assert.doesNotMatch(kal, /onDragOver|onDrop=/, "tidak lagi HTML5 drag-and-drop (tidak jalan di HP)");
});

test("satu tab: klik kartu membuka ruang kerja unit sebagai panel di halaman ini, bukan pindah tab", () => {
  const halaman = src("pages", "bengkel", "ProductionRencanaMinggu.jsx");
  assert.match(halaman, /const bukaUnit = \(it\) => setPanelUnit/);
  assert.match(halaman, /<PanelUnit /);
  const panel = src("features", "production", "rencana", "PanelUnit.jsx");
  assert.match(panel, /<UnitWorkspace /, "komponen ruang kerja yang SAMA (tanpa salinan logika)"); assert.match(panel, /onChanged=\{onChanged\}/);
});

test("pengawatan: chip Belum tiba memicu TERIMA, halaman mengirim tutupPickup lewat api yang sama", () => {
  const kartu = src("features", "production", "rencana", "KartuUnit.jsx");
  assert.match(kartu, /data-testid="kartu-tandai-tiba"/); assert.match(kartu, /onAksi\?\.\("TERIMA"/);
  const halaman = src("pages", "bengkel", "ProductionRencanaMinggu.jsx");
  assert.match(halaman, /catatPenerimaanWorkshop\(it\.unitId, \{ fisikDiterima: true, tutupPickup: true \}\)/);
  assert.match(src("api.js"), /tutupPickup: tutupPickup === true \|\| undefined/);
});

test("pergantian tiba di tempat: Belum tiba -> Mencatat… -> Di workshop tanpa kartu meredup; gagal = chip kembali; tombol konfirmasi rata tengah", () => {
  const halaman = src("pages", "bengkel", "ProductionRencanaMinggu.jsx");
  const fn = halaman.slice(halaman.indexOf("async function tandaiTiba"), halaman.indexOf("async function ubahDiproses"));
  assert.doesNotMatch(fn, /tandaiPending/, "tandai tiba tidak memakai status Menyimpan… seluruh kartu");
  assert.match(fn, /aturTiba\(id, "mencatat"\)/); assert.match(fn, /aturTiba\(it\.unitId, "ok"\)/); assert.match(fn, /aturTiba\(it\.unitId, null\)/);
  assert.match(halaman, /<TibaKonteks\.Provider value=\{tibaStatus\}>/);
  const kartu = src("features", "production", "rencana", "KartuUnit.jsx");
  assert.match(kartu, /const diterima = item\.diterima \|\| tiba === "ok"/);
  assert.match(kartu, /diterima && f\.code === "BELUM_DITERIMA"/, "peringatan belum diterima hilang bersamaan");
  assert.match(src("features", "production", "rencana", "rencana.css"), /\.rc-konfirmasi-btn \{[^}]*justify-content: center/);
});
