// Aturan bukti atribusi Fase 1: klik saja bukan bukti, teks website milik website.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bukanKlikManusia } from "../src/services/leadAttribution.js";
import {
  saringTemplateIklan, gabungTeksTombolWebsite, cocokkanTemplateIklan, TEKS_TOMBOL_WEBSITE_TETAP,
} from "../src/services/templateIklan.js";

const webhook = readFileSync(new URL("../src/routes/webhooks.js", import.meta.url), "utf8");

test("webhook tidak lagi mencari klik global 15 menit", () => {
  assert.ok(!webhook.includes("15 * 60 * 1000"));
  assert.ok(!/recentClick/.test(webhook));
});

test("teks tombol website dicek sebelum template iklan", () => {
  assert.ok(webhook.indexOf("ambilTeksTombolWebsite()") < webhook.indexOf("ambilTemplateIklanAktif()"));
});

test("teks website keluar dari template Meta, teks iklan tetap", () => {
  const hasil = saringTemplateIklan([
    "halo sano, saya tertarik konsultasi",
    "halo sano, saya tertarik konsultasi gratis",
    "halo sano, saya lihat iklannya dan ingin konsultasi",
    "minta estimasi harga dan proses pengerjaan",
  ]);
  assert.deepEqual(hasil, ["halo sano, saya lihat iklannya dan ingin konsultasi", "minta estimasi harga dan proses pengerjaan"]);
});

test("teks tetap dikenali walau data kosong, varian tambahan ikut cocok", () => {
  const daftar = gabungTeksTombolWebsite([]);
  assert.deepEqual(daftar, TEKS_TOMBOL_WEBSITE_TETAP);
  assert.ok(cocokkanTemplateIklan("Halo Sano, saya tertarik konsultasi gratis", daftar));
  assert.equal(cocokkanTemplateIklan("Halo Sano, saya lihat di TikTok", daftar), null);
});

test("penyaring klik: bot dibuang, peramban & WebView TikTok dihitung", () => {
  for (const ua of ["", null, "facebookexternalhit/1.1", "Mozilla/5.0 (compatible; Bytespider)", "Googlebot/2.1", "curl/8.0", "WhatsApp/2.23", "HeadlessChrome/120"]) {
    assert.equal(bukanKlikManusia("GET", ua), true, String(ua));
  }
  assert.equal(bukanKlikManusia("HEAD", "Mozilla/5.0"), true);
  for (const ua of [
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 musical_ly_33 BytedanceWebview/d8a21c6",
  ]) assert.equal(bukanKlikManusia("GET", ua), false, ua);
});
