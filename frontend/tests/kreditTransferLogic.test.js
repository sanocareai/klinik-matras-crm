// Dialog keputusan kredit closing saat transfer (keputusan Owner 11 Okt 2026, opsi B) — logika murni dijalankan sungguhan.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { pilihanAwal, jumlahIkut, validasiKeputusan, buatPayloadTransfer, ringkasanKeputusan } from "../src/features/inbox/kreditTransferLogic.js";

const orders = [
  { id: "a", orderNumber: "RES-1", sarankanIkut: true },
  { id: "b", orderNumber: "RES-2", sarankanIkut: false },
  { id: "c", orderNumber: "RES-3", sarankanIkut: true },
];

test("pilihan awal: belum lunas ikut, lunas tetap; penerima non-Sales → semua tetap", () => {
  assert.deepEqual(pilihanAwal(orders, true), { a: true, b: false, c: true });
  assert.deepEqual(pilihanAwal(orders, false), { a: false, b: false, c: false });
  assert.deepEqual(pilihanAwal(undefined, true), {});
});

test("alasan wajib hanya bila ada yang ikut dan penerima Sales", () => {
  assert.match(validasiKeputusan({ pilihan: { a: true }, alasan: "  ", penerimaSales: true }), /alasan/i);
  assert.equal(validasiKeputusan({ pilihan: { a: true }, alasan: "Fadlan closing", penerimaSales: true }), null);
  assert.equal(validasiKeputusan({ pilihan: { a: false, b: false }, alasan: "", penerimaSales: true }), null);
  assert.equal(validasiKeputusan({ pilihan: { a: true }, alasan: "", penerimaSales: false }), null);
});

test("payload: setiap order dikirim eksplisit; non-Sales tidak pernah mengirim ikut=true", () => {
  const p = buatPayloadTransfer({ userId: "u1", orders, pilihan: { a: true, b: false, c: true }, alasan: " ok ", penerimaSales: true });
  assert.deepEqual(p, { assignedToId: "u1", keputusanOrder: [{ orderId: "a", ikut: true }, { orderId: "b", ikut: false }, { orderId: "c", ikut: true }], alasanOrder: "ok" });
  const q = buatPayloadTransfer({ userId: "adm", orders, pilihan: { a: true, b: true, c: true }, alasan: "", penerimaSales: false });
  assert.ok(q.keputusanOrder.every((k) => k.ikut === false));
});

test("ringkasan", () => {
  assert.equal(ringkasanKeputusan({ orders, pilihan: { a: true, b: false, c: true }, penerimaSales: true, namaPenerima: "Fadlan" }), "2 order ikut ke Fadlan, 1 order tetap di pemegang lama");
  assert.equal(ringkasanKeputusan({ orders, pilihan: { a: true }, penerimaSales: false, namaPenerima: "Novi" }), "0 order ikut ke Novi, 3 order tetap di pemegang lama");
  assert.equal(ringkasanKeputusan({ orders: [], pilihan: {}, penerimaSales: true, namaPenerima: "X" }), "");
  assert.equal(jumlahIkut({ a: true, b: false }), 1);
});

test("PARITAS: salinan mobile identik dengan web (kecuali komentar)", () => {
  const baca = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.equal(baca("../../mobile/src/lib/kreditTransfer.js"), baca("../src/features/inbox/kreditTransferLogic.js"));
});

test("PEMASANGAN: popover meminta order terdampak sebelum transfer dan mengirim payload keputusan", () => {
  const s = fs.readFileSync(new URL("../src/features/inbox/components/ConversationList/TransferPickerPopover.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(s, /api\.getOrderTerdampakTransfer\(conversationId, user\.id\)/);
  assert.match(s, /buatPayloadTransfer\(\{ userId: user\.id, orders, pilihan, alasan, penerimaSales \}\)/);
  assert.match(s, /if \(!info\.orders\?\.length\) \{ await kirimTransfer\(\{ assignedToId: user\.id \}\); return; \}/);
});
