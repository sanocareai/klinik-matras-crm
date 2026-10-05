// Status "belum dibalas": pesan TERAKHIR berarah INBOUND. Bug 5 Okt 2026: chat yang sudah dibalas tetap muncul di tab "Belum Dibalas" di aplikasi.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { statusBelumDibalas } from "../src/utils/belumDibalas.js";

const SEKARANG = Date.parse("2026-10-05T10:00:00Z");

describe("statusBelumDibalas", () => {
  test("pesan terakhir dari pelanggan = belum dibalas, lama menunggu dihitung menit", () => {
    const r = statusBelumDibalas({ direction: "INBOUND", createdAt: new Date("2026-10-05T09:15:00Z") }, SEKARANG);
    assert.deepEqual(r, { isUnanswered: true, unansweredMinutes: 45 });
  });

  test("pesan terakhir dari kita (CRM atau diketik di HP) = sudah dibalas", () => {
    const r = statusBelumDibalas({ direction: "OUTBOUND", createdAt: new Date("2026-10-05T09:59:00Z") }, SEKARANG);
    assert.deepEqual(r, { isUnanswered: false, unansweredMinutes: null });
  });

  test("percakapan tanpa pesan = bukan belum dibalas", () => {
    assert.deepEqual(statusBelumDibalas(null, SEKARANG), { isUnanswered: false, unansweredMinutes: null });
    assert.deepEqual(statusBelumDibalas(undefined, SEKARANG), { isUnanswered: false, unansweredMinutes: null });
  });

  test("jam server sedikit mendahului: menit tidak pernah negatif", () => {
    const r = statusBelumDibalas({ direction: "INBOUND", createdAt: new Date("2026-10-05T10:00:30Z") }, SEKARANG);
    assert.equal(r.unansweredMinutes, 0);
  });

  test("createdAt berbentuk string ISO juga diterima", () => {
    assert.equal(statusBelumDibalas({ direction: "INBOUND", createdAt: "2026-10-05T09:00:00Z" }, SEKARANG).unansweredMinutes, 60);
  });
});
