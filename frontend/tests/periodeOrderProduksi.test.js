// Periode Order Produksi memakai pemilih rentang tanggal STANDAR app (DateRangePicker yang sama dengan Order CRM) — model murni + pengawatan (tanpa DOM).
// Perilaku Batal/Terapkan ada di DateRangePicker (draft lokal, onChange hanya saat Terapkan) dan dijaga oleh tes pengawatan di bawah (komponen tidak diubah, page hanya menerima onChange).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERIODE_BAWAAN, paramPeriode, periodeDariUrl, periodeKeUrl, periodeSemuaWaktu } from "../src/features/production/orderProduksiModel.js";
import { makeCustomRange, makeRange } from "../src/lib/dateRange.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("bawaan = Semua waktu: tanpa parameter tanggal ke server dan tanpa kunci periode di URL", () => {
  assert.equal(PERIODE_BAWAAN, "all_time");
  const r = periodeDariUrl(new URLSearchParams(""));
  assert.equal(r.preset, "all_time"); assert.equal(r.from, null); assert.equal(r.to, null);
  assert.deepEqual(paramPeriode(r), {}, "Semua waktu tidak mengirim dari/sampai");
  assert.deepEqual(paramPeriode(periodeSemuaWaktu()), {});
  assert.equal(periodeKeUrl(new URLSearchParams(""), r).toString(), "", "periode bawaan tidak ditulis ke URL");
});

test("preset standar: dipilih -> ditulis ke URL -> dibaca kembali sama (tahan refresh); parameter API = tanggal WIB inklusif", () => {
  for (const id of ["today", "yesterday", "last_7_days", "last_14_days", "last_30_days", "this_month", "last_month", "last_3_months", "this_year"]) {
    const r = makeRange(id);
    const url = periodeKeUrl(new URLSearchParams(""), r);
    assert.equal(url.get("preset"), id, id);
    const balik = periodeDariUrl(url);
    assert.equal(balik.preset, id, id); assert.equal(balik.from, r.from, id); assert.equal(balik.to, r.to, id);
    assert.deepEqual(paramPeriode(balik), { dari: r.from, sampai: r.to }, id);
    assert.match(paramPeriode(balik).dari, /^\d{4}-\d{2}-\d{2}$/); assert.match(paramPeriode(balik).sampai, /^\d{4}-\d{2}-\d{2}$/);
  }
  const h = makeRange("today"); assert.equal(h.from, h.to, "Hari ini = satu hari kalender (server menyertakan seluruh hari itu)");
});

test("preset berparameter (N hari hingga hari ini) menyimpan n di URL", () => {
  const r = makeRange("n_days_to_today", { n: 45 });
  const url = periodeKeUrl(new URLSearchParams(""), r);
  assert.equal(url.get("n"), "45");
  const balik = periodeDariUrl(url); assert.equal(balik.preset, "n_days_to_today"); assert.equal(balik.n, 45); assert.equal(balik.from, r.from);
});

test("rentang manual: preset=custom&dari&sampai; terbalik ditukar (bukan galat diam-diam); tanggal tidak valid jatuh ke Semua waktu", () => {
  const r = makeCustomRange("2026-10-01", "2026-10-15");
  const url = periodeKeUrl(new URLSearchParams(""), r);
  assert.equal(url.get("preset"), "custom"); assert.equal(url.get("dari"), "2026-10-01"); assert.equal(url.get("sampai"), "2026-10-15");
  assert.deepEqual(paramPeriode(periodeDariUrl(url)), { dari: "2026-10-01", sampai: "2026-10-15" });
  assert.deepEqual(paramPeriode(makeCustomRange("2026-10-20", "2026-10-05")), { dari: "2026-10-05", sampai: "2026-10-20" }, "terbalik ditukar");
  assert.equal(makeCustomRange("2026-10-07", "2026-10-07").from, "2026-10-07", "satu hari valid");
  for (const q of ["preset=custom&dari=abc&sampai=2026-10-10", "preset=custom&dari=2026-10-01", "preset=tidak_ada", "preset=custom&dari=2026-13-45x&sampai=2026-10-10", "preset=custom&dari=2026-13-45&sampai=2026-14-01"]) {
    const x = periodeDariUrl(new URLSearchParams(q)); assert.equal(x.preset, "all_time", q); assert.deepEqual(paramPeriode(x), {}, q);
  }
});

test("reset ke Semua waktu membuang kunci periode tetapi mempertahankan kunci lain (?tab=, ?unit=, ?q=)", () => {
  const awal = periodeKeUrl(new URLSearchParams("tab=riwayat&unit=U1&q=RES-1"), makeRange("last_7_days"));
  assert.equal(awal.get("tab"), "riwayat"); assert.equal(awal.get("unit"), "U1"); assert.equal(awal.get("q"), "RES-1"); assert.equal(awal.get("preset"), "last_7_days");
  const reset = periodeKeUrl(awal, periodeSemuaWaktu());
  for (const k of ["preset", "dari", "sampai", "n"]) assert.equal(reset.has(k), false, k);
  assert.equal(reset.get("tab"), "riwayat"); assert.equal(reset.get("unit"), "U1"); assert.equal(reset.get("q"), "RES-1");
  const custom = periodeKeUrl(reset, makeCustomRange("2026-10-01", "2026-10-02")); const lagi = periodeKeUrl(custom, makeRange("last_30_days"));
  assert.equal(lagi.has("dari"), false, "berpindah dari manual ke preset tidak meninggalkan dari/sampai lama"); assert.equal(lagi.get("preset"), "last_30_days");
});

test("PENGAWATAN: komponen yang SAMA dengan Order CRM (tanpa tiruan), tanpa Bandingkan, tanpa dua input tanggal lama, satu sumber parameter untuk daftar/hitungan/pagination/Excel", () => {
  const orders = src("pages", "Orders.jsx"); const f = src("features", "production", "KelengkapanFilter.jsx"); const p = src("pages", "bengkel", "ProductionWorkOrders.jsx");
  assert.ok(/import DateRangePicker from "\.\.\/components\/DateRangePicker\.jsx"/.test(orders), "Order CRM memakai DateRangePicker");
  assert.ok(f.includes('import DateRangePicker from "@/components/DateRangePicker.jsx"'), "Order Produksi memakai komponen yang sama");
  assert.ok(f.includes("showCompare={false}"), "Bandingkan tidak ditawarkan (daftar Produksi belum mendukung)");
  assert.ok(!/type="date"/.test(f) && !/Order masuk dari|Order masuk sampai|periode-dari|periode-sampai|periode-hapus/.test(f), "dua input tanggal terpisah dihapus");
  assert.ok(!/DateRangePicker|SIMPLE_PRESETS|CalendarMonth/.test(p), "halaman tidak membuat pemilih tanggal sendiri");
  assert.ok(p.includes("useHubRange(periodeDariUrl, periodeKeUrl)") && p.includes("paramPeriode(periode)"), "periode di URL (tahan refresh)");
  assert.ok(p.includes("urut, ...rentang }") && p.includes("statusKerja: kerja || undefined, ...rentang }"), "daftar dan hitungan Kelengkapan memakai periode yang sama");
  assert.ok(p.includes("...paramDaftar, page: String(page)") && p.includes("api.eksporOrderProduksiXlsx({ displayStatus: displayParam, ...paramDaftar"), "pagination dan Excel memakai paramDaftar yang sama");
  assert.ok(p.includes("onPeriode={setPeriode}") && f.includes("onChange={onPeriode}"), "perubahan hanya lewat onChange pemilih (dikirim saat Terapkan)");
  const d = src("components", "DateRangePicker.jsx");
  assert.ok(/Batal/.test(d) && /Terapkan/.test(d) && /setDraft\(value\)/.test(d), "komponen standar: draft lokal, Batal membuang, Terapkan mengirim");
  assert.ok(f.includes("Dasar tanggal: {DASAR_PERIODE_TEKS}") && f.includes("InfoToggleButton info={infoPeriode}") && /WIB/.test(f), "dasar tanggal (unit dibuat) dan batas hari WIB dijelaskan lewat ikon info");
});
