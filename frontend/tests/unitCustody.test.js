// Logika murni halaman Antrean Penerimaan Unit (Warehouse V2 P1–P2). Lihat src/features/warehouse/unitCustody.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_LOCATION_TYPES, CUSTODY_TABS, directionLabel, emptyStateCopy, isCustodyDecisionPending,
  locationsAllowedForDirection, statusBadgeFor,
} from "../src/features/warehouse/unitCustody.js";

test("tab: Menunggu/Diterima/Ditolak/Riwayat, dalam urutan itu", () => {
  assert.deepEqual(CUSTODY_TABS.map((t) => t.key), ["OFFERED", "ACCEPTED", "REJECTED", "HISTORY"]);
  assert.deepEqual(CUSTODY_TABS.map((t) => t.label), ["Menunggu", "Diterima", "Ditolak", "Riwayat"]);
});

test("statusBadgeFor: setiap status punya label Indonesia; status tak dikenal jatuh ke netral", () => {
  assert.deepEqual(statusBadgeFor("OFFERED"), { variant: "warning", label: "Menunggu" });
  assert.deepEqual(statusBadgeFor("ACCEPTED"), { variant: "success", label: "Diterima" });
  assert.deepEqual(statusBadgeFor("REJECTED"), { variant: "danger", label: "Ditolak" });
  assert.equal(statusBadgeFor("SUPERSEDED").variant, "neutral");
  assert.deepEqual(statusBadgeFor("APA_SAJA"), { variant: "neutral", label: "APA_SAJA" });
  assert.equal(statusBadgeFor(undefined).label, "—");
});

test("isCustodyDecisionPending: hanya OFFERED yang menampilkan aksi Terima/Tolak", () => {
  assert.equal(isCustodyDecisionPending("OFFERED"), true);
  for (const status of ["ACCEPTED", "REJECTED", "CANCELLED", "SUPERSEDED", undefined]) {
    assert.equal(isCustodyDecisionPending(status), false, status);
  }
});

test("locationsAllowedForDirection: hanya lokasi aktif dengan tipe yang sesuai arah; client tidak bisa mengirim teks bebas", () => {
  const locations = [
    { id: "1", active: true, locationType: "RECEIVING_AREA" },
    { id: "2", active: false, locationType: "RECEIVING_AREA" },
    { id: "3", active: true, locationType: "DISPATCH_AREA" },
    { id: "4", active: true, locationType: "RAW_MATERIAL_AREA" },
    { id: "5", active: true, locationType: "RETURN_AREA" },
  ];
  assert.deepEqual(locationsAllowedForDirection(locations, "INBOUND").map((l) => l.id), ["1"]);
  assert.deepEqual(locationsAllowedForDirection(locations, "RETURN").map((l) => l.id), ["3", "5"]);
  assert.deepEqual(locationsAllowedForDirection(null, "INBOUND"), []);
  assert.deepEqual(locationsAllowedForDirection(locations, "TIDAK_DIKENAL"), []);
  // Daftar arah yang diperbolehkan cermin backend (ALLOWED_LOCATION_TYPES) — dua-duanya harus disesuaikan bersama.
  assert.deepEqual([...ALLOWED_LOCATION_TYPES.INBOUND], ["RECEIVING_AREA", "WIP_AREA", "QUARANTINE_AREA"]);
  assert.deepEqual([...ALLOWED_LOCATION_TYPES.RETURN], ["RETURN_AREA", "FINISHED_GOODS_AREA", "DISPATCH_AREA", "QUARANTINE_AREA"]);
});

test("directionLabel: INBOUND/RETURN berbahasa Indonesia; nilai lain ditampilkan apa adanya", () => {
  assert.equal(directionLabel("INBOUND"), "Masuk dari Pickup");
  assert.equal(directionLabel("RETURN"), "Kembali (Gagal Kirim)");
  assert.equal(directionLabel("LAINNYA"), "LAINNYA");
  assert.equal(directionLabel(undefined), "—");
});

test("emptyStateCopy: reader OFF menjelaskan fitur canary (bukan pesan error), bukan 'tidak ada data'", () => {
  const off = emptyStateCopy({ readerMode: "OFF", tabKey: "OFFERED" });
  assert.equal(off.belumAktif, true);
  assert.match(off.title, /belum diaktifkan/i);
  assert.match(off.description, /canary|Admin/i);
});

test("emptyStateCopy: reader aktif tapi tab kosong -> pesan netral menyebut nama tab", () => {
  const cohort = emptyStateCopy({ readerMode: "COHORT", tabKey: "ACCEPTED" });
  assert.equal(cohort.belumAktif, false);
  assert.match(cohort.title, /diterima/i);
  const global = emptyStateCopy({ readerMode: "GLOBAL", tabKey: "HISTORY" });
  assert.equal(global.belumAktif, false);
  assert.match(global.title, /riwayat/i);
});
