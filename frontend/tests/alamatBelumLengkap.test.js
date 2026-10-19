// Peringatan "alamat belum lengkap" di Route Planner (19 Okt 2026): kelengkapan data TIDAK menahan penjadwalan, tetapi harus terlihat jelas di kartu job dan di ringkasan rute.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alamatBelumLengkap, STATUS_JOB_AKTIF } from "../src/features/armada/alamatLengkap.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baca = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

const job = (over = {}) => ({ type: "DELIVERY", status: "ASSIGNED", addressText: null, lat: null, lng: null, order: { locationUrl: null }, ...over });

test("alamatBelumLengkap: hanya job DELIVERY aktif tanpa teks alamat, koordinat, dan link Maps", () => {
  assert.equal(alamatBelumLengkap(job()), true);
  assert.equal(alamatBelumLengkap(job({ addressText: "   " })), true, "alamat spasi saja = kosong");
  assert.equal(alamatBelumLengkap(job({ addressText: "Jl. Gambir Anom 28" })), false);
  assert.equal(alamatBelumLengkap(job({ lat: -6.9, lng: 107.6 })), false);
  assert.equal(alamatBelumLengkap(job({ order: { locationUrl: "https://maps.app.goo.gl/x" } })), false);
  assert.equal(alamatBelumLengkap(job({ units: [{ unit: { order: { locationUrl: "https://maps.app.goo.gl/x" } } }], order: undefined })), false, "link dari order unit juga dihitung");
});

test("alamatBelumLengkap: tidak berlaku untuk PICKUP, job selesai/gagal, atau data kosong", () => {
  assert.equal(alamatBelumLengkap(job({ type: "PICKUP" })), false);
  assert.equal(alamatBelumLengkap(job({ status: "COMPLETED" })), false);
  assert.equal(alamatBelumLengkap(job({ status: "FAILED" })), false);
  assert.equal(alamatBelumLengkap(null), false);
  assert.equal(alamatBelumLengkap(undefined), false);
});

test("UI: lencana per kartu (Route Planner + job belum masuk rute) dan ringkasan per rute terpasang, sebagai PERINGATAN (tidak mematikan tombol Terbitkan)", () => {
  assert.match(baca("src/features/armada/components/JobBadges.jsx"), /export function AlamatBelumLengkapBadge/);
  assert.match(baca("src/features/armada/components/RouteCard.jsx"), /<AlamatBelumLengkapBadge job=\{j\} \/>/);
  assert.match(baca("src/features/armada/components/UnroutedJobsPanel.jsx"), /<AlamatBelumLengkapBadge job=\{j\} \/>/);
  const rc = baca("src/features/armada/components/RouteCard.jsx");
  assert.match(rc, /data-testid="rute-butuh-alamat"/);
  assert.match(rc, /Rute butuh kelengkapan alamat/);
  // tombol Terbitkan tidak bergantung pada kelengkapan alamat
  const tombol = rc.slice(rc.indexOf("onClick={() => jalankan(() => onPublish(route))}") - 400, rc.indexOf("onClick={() => jalankan(() => onPublish(route))}") + 400);
  assert.doesNotMatch(tombol, /alamatBelumLengkap/);
});

test("konsistensi: daftar status aktif sama dengan ACTIVE_STATUSES di jobStatus.js dan jobStatus.js mengekspor ulang helper yang sama", () => {
  const js = baca("src/features/armada/jobStatus.js");
  const m = js.match(/export const ACTIVE_STATUSES = (\[[^\]]*\]);/);
  assert.deepEqual(JSON.parse(m[1]), STATUS_JOB_AKTIF);
  assert.match(js, /export \{ alamatBelumLengkap \} from "\.\/alamatLengkap\.js";/);
});
