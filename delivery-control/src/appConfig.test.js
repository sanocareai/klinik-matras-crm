// Menjaga pemisahan dua aplikasi: identitas, izin, dan EAS TIDAK boleh saling bocor.
// Tes ini membaca konfigurasi Driver produksi (driver-mobile/app.json, read-only) dan
// membandingkannya dengan konfigurasi Control. Tidak mengubah apa pun di Driver.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const control = require("../app.config.js")({ config: {} });
const driver = JSON.parse(readFileSync(path.join(here, "../../driver-mobile/app.json"), "utf8")).expo;
const eas = JSON.parse(readFileSync(path.join(here, "../eas.json"), "utf8"));
const driverEas = JSON.parse(readFileSync(path.join(here, "../../driver-mobile/eas.json"), "utf8"));

const LOKASI = [
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.ACCESS_BACKGROUND_LOCATION",
  "android.permission.FOREGROUND_SERVICE_LOCATION",
];

test("package ID dan slug berbeda dari Sano Driver", () => {
  assert.equal(driver.android.package, "com.klinikmatras.drivermobile");
  assert.equal(control.android.package, "com.klinikmatras.deliverycontrol");
  assert.notEqual(control.slug, driver.slug);
  assert.notEqual(control.name, driver.name);
});

test("Control TIDAK meminta izin lokasi/background: tidak ada plugin lokasi, semua izin lokasi diblokir", () => {
  const plugins = control.plugins.map((p) => (Array.isArray(p) ? p[0] : p));
  assert.equal(plugins.includes("expo-location"), false);
  assert.equal(plugins.includes("expo-task-manager"), false);
  assert.equal((control.android.permissions || []).some((p) => LOKASI.includes(p)), false);
  for (const p of LOKASI) assert.ok(control.android.blockedPermissions.includes(p), `${p} harus diblokir`);
});

test("Driver tetap meminta izin lokasi seperti sebelumnya (tidak tersentuh)", () => {
  for (const p of LOKASI) assert.ok(driver.android.permissions.includes(p), p);
  assert.equal(driver.android.versionCode, 6);
});

test("EAS project & channel terpisah; project ID Driver tidak dipakai", () => {
  const driverProject = driver.extra.eas.projectId;
  assert.equal(control.extra?.eas?.projectId === driverProject, false);
  for (const ch of Object.values(eas.build).map((b) => b.channel)) assert.match(ch, /^control-/);
  const driverChannels = new Set(Object.values(driverEas.build).map((b) => b.channel));
  for (const ch of Object.values(eas.build).map((b) => b.channel)) assert.equal(driverChannels.has(ch), false, ch);
});

test("runtimeVersion memakai kebijakan appVersion (OTA hanya ke build versi sama)", () => {
  assert.deepEqual(control.runtimeVersion, { policy: "appVersion" });
});
