import test from "node:test";
import assert from "node:assert/strict";
import { pasangkanPesanGaleri } from "../src/utils/pasangPesanGaleriGanda.js";

const T = (detik) => new Date(Date.UTC(2026, 9, 1, 15, 47, 0) + detik * 1000);
const hantu = (id, detik, o = {}) => ({ id, conversationId: "c1", direction: "OUTBOUND", content: "Konsep kasur sehat", mediaType: "image", createdAt: T(detik), externalId: null, ...o });
const gema = (id, detik, o = {}) => ({ id, conversationId: "c1", direction: "OUTBOUND", content: "Konsep kasur sehat", mediaType: "image", createdAt: T(detik), externalId: "WA-" + id, sentById: null, mediaUrl: "/uploads/" + id + ".jpg", ...o });
const ids = (r) => r.pasangan.map((p) => `${p.hantu.id}>${p.gema.id}`).sort();

test("pasangan normal: gema datang ~0,5 dtk setelah hantu dibuat", () => {
  assert.deepEqual(ids(pasangkanPesanGaleri([hantu("H1", 0)], [gema("G1", 0.46)])), ["H1>G1"]);
});

test("gema bisa lebih dulu dari hantu (selisih dihitung absolut)", () => {
  assert.deepEqual(ids(pasangkanPesanGaleri([hantu("H1", 1.3)], [gema("G1", 0)])), ["H1>G1"]);
});

test("KASUS NYATA: foto berbeda dalam 90 dtk TIDAK boleh dipasangkan (caption beda)", () => {
  const r = pasangkanPesanGaleri([hantu("H1", 96, { content: "*GARANSI PREMIUM 20 TAHUN*" })], [gema("G1", 0)]);
  assert.equal(r.pasangan.length, 0); assert.equal(r.tanpaPasangan.length, 1);
});

test("caption sama tapi selisih waktu > batas (5 dtk): tidak dipasangkan", () => {
  assert.equal(pasangkanPesanGaleri([hantu("H1", 0)], [gema("G1", 6)]).pasangan.length, 0);
});

test("satu-ke-satu: dua hantu berurutan + dua gema → tiap hantu ke gema terdekatnya", () => {
  const r = pasangkanPesanGaleri([hantu("H1", 0), hantu("H2", 2)], [gema("G1", 0.5), gema("G2", 2.5)]);
  assert.deepEqual(ids(r), ["H1>G1", "H2>G2"]);
});

test("satu gema tidak dipakai dua hantu; hantu kedua dibiarkan (tanpa pasangan)", () => {
  const r = pasangkanPesanGaleri([hantu("H1", 0), hantu("H2", 3)], [gema("G1", 0.4)]);
  assert.deepEqual(ids(r), ["H1>G1"]); assert.deepEqual(r.tanpaPasangan.map((h) => h.id), ["H2"]);
});

test("gema yang sudah punya pengirim / tanpa externalId / arah masuk / percakapan lain / jenis lain diabaikan", () => {
  const h = [hantu("H1", 0)];
  for (const g of [gema("G", 0.4, { sentById: "u1" }), gema("G", 0.4, { externalId: null }), gema("G", 0.4, { direction: "INBOUND" }),
    gema("G", 0.4, { conversationId: "c2" }), gema("G", 0.4, { mediaType: "video" }), gema("G", 0.4, { mediaUrl: null })]) {
    assert.equal(pasangkanPesanGaleri(h, [g]).pasangan.length, 0, JSON.stringify(g));
  }
});

test("caption dibandingkan setelah trim; null dan string kosong dianggap sama", () => {
  assert.equal(pasangkanPesanGaleri([hantu("H1", 0, { content: " abc \n" })], [gema("G1", 0.4, { content: "abc" })]).pasangan.length, 1);
  assert.equal(pasangkanPesanGaleri([hantu("H1", 0, { content: null })], [gema("G1", 0.4, { content: "" })]).pasangan.length, 1);
});
