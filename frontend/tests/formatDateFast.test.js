import test from "node:test";
import assert from "node:assert/strict";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import "dayjs/locale/id.js";
import { formatJam, formatTanggal, formatTanggalPendek, formatTanggalJam, hariSejak, wibParts } from "../src/utils/formatDate.js";

dayjs.extend(utc); dayjs.extend(timezone); dayjs.locale("id");
const ref = (v, f) => dayjs(v).tz("Asia/Jakarta").format(f);

// Sampel acak deterministik + kasus tepi (pergantian hari/bulan/tahun WIB, akhir tahun, kabisat).
let seed = 42; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const samples = [
  "2026-12-31T16:59:59.999Z", "2026-12-31T17:00:00.000Z", "2024-02-28T17:00:00Z", "2024-02-29T16:59:00Z",
  "2026-01-01T00:00:00Z", "2026-09-20T05:36:52Z", "2026-09-20T05:36:52+07:00", "2026-09-20T12:36:52.123456+0700",
  ...Array.from({ length: 400 }, () => new Date(Date.UTC(2020, 0, 1) + Math.floor(rnd() * 8 * 365 * 86400000)).toISOString()),
];

test("format WIB jalur cepat IDENTIK dengan dayjs.tz untuk ISO, Date, dan epoch", () => {
  for (const s of samples) for (const v of [s, new Date(s), Date.parse(s)]) {
    assert.equal(formatJam(v), ref(v, "HH.mm"), `jam ${s}`);
    assert.equal(formatTanggal(v), ref(v, "D MMM YYYY"), `tanggal ${s}`);
    assert.equal(formatTanggalPendek(v), ref(v, "D MMM"), `pendek ${s}`);
    assert.equal(formatTanggalJam(v), ref(v, "D MMM YYYY, HH.mm"), `tgljam ${s}`);
  }
});

test("hariSejak & formatConvTimestamp: selisih hari kalender WIB sama dengan implementasi dayjs", () => {
  const now = dayjs().tz("Asia/Jakarta");
  for (let i = 0; i < 40; i++) {
    const t = new Date(Date.now() - Math.floor(rnd() * 20 * 86400000)).toISOString();
    const expected = now.startOf("day").diff(dayjs(t).tz("Asia/Jakarta").startOf("day"), "day");
    assert.equal(hariSejak(t), expected, t);
  }
});

test("input tidak valid / non-ISO tetap aman lewat jalur lama", () => {
  assert.equal(formatJam(null), "—");
  assert.equal(formatJam("bukan tanggal"), "—");
  assert.equal(formatTanggal(""), "—");
  assert.equal(wibParts("2026-09-20"), null, "tanggal tanpa zona tidak lewat jalur cepat");
  assert.equal(formatTanggal("2026-09-20"), ref("2026-09-20", "D MMM YYYY"));
});

test("jalur cepat jauh lebih murah dari dayjs.tz", () => {
  const N = 20000; const iso = "2026-09-20T05:36:52.000Z";
  let t0 = performance.now(); for (let i = 0; i < N; i++) formatJam(iso); const fast = performance.now() - t0;
  t0 = performance.now(); for (let i = 0; i < N; i++) ref(iso, "HH.mm"); const slow = performance.now() - t0;
  assert.ok(fast * 5 < slow, `fast=${fast.toFixed(1)}ms slow=${slow.toFixed(1)}ms`);
});
