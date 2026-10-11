// Kasus nyata 11 Okt 2026 (Risel → Alya): daftar HP harus menampilkan pemegang SEKARANG, bukan pembalas pertama.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { labelPemegang } from "../src/lib/labelPemegang.js";
import { useConversationStore } from "../src/store/conversationStore.js";

const risel = { id: "u-risel", name: "Risel" };
const alya = { id: "u-alya", name: "Alya" };

test("KASUS RISEL → ALYA: pemegang sekarang jadi badge utama, Risel tampil sebagai 1st", () => {
  assert.deepEqual(labelPemegang({ assignedTo: alya, firstResponder: risel }), { utama: "Alya", pertama: "Risel" });
});

test("pemegang = pembalas pertama: hanya satu badge (tanpa '1st' ganda)", () => {
  assert.deepEqual(labelPemegang({ assignedTo: risel, firstResponder: risel }), { utama: "Risel", pertama: null });
});

test("belum ada pemegang tapi ada pembalas pertama: tidak tampak seperti pemegang", () => {
  assert.deepEqual(labelPemegang({ assignedTo: null, firstResponder: risel }), { utama: null, pertama: "Risel" });
});

test("tanpa keduanya / data kosong tidak error", () => {
  assert.deepEqual(labelPemegang({}), { utama: null, pertama: null });
  assert.deepEqual(labelPemegang(undefined), { utama: null, pertama: null });
});

test("event conversation:update yang membawa assignedTo mengganti pemegang di store (tanpa muat ulang)", () => {
  useConversationStore.setState({
    conversationsById: { c1: { id: "c1", assignedToId: risel.id, assignedTo: risel, firstResponder: risel, lastMessageAt: "2026-10-09T01:00:00Z" } },
    conversationOrder: ["c1"],
  });
  useConversationStore.getState().upsertConversation({ id: "c1", assignedToId: alya.id, assignedTo: alya, canTakeOver: false, lastMessageAt: "2026-10-09T01:00:00Z" });
  const c = useConversationStore.getState().conversationsById.c1;
  assert.deepEqual(labelPemegang(c), { utama: "Alya", pertama: "Risel" });
  assert.equal(c.assignedToId, alya.id);
});

test("PEMASANGAN: item daftar memakai labelPemegang dan tidak lagi menampilkan firstResponder polos", () => {
  const s = fs.readFileSync(new URL("../src/components/ConversationItem.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(s, /labelPemegang\(c\)/);
  assert.match(s, /\{label\.utama && <Text style=\{styles\.pemegangBadge\}/);
  assert.doesNotMatch(s, /\{c\.firstResponder && <Text style=\{styles\.firstResponderBadge\}>\{c\.firstResponder\.name\}/);
});

import { bolehMenerimaTransfer, labelPeranTransfer } from "../src/lib/targetTransfer.js";

test("TARGET TRANSFER: hanya Sales/Admin aktif; Driver/Helper/Produksi & akun nonaktif tidak muncul", () => {
  const u = (o) => ({ id: "x", active: true, ...o });
  assert.equal(bolehMenerimaTransfer(u({ roles: ["SALES"] })), true);
  assert.equal(bolehMenerimaTransfer(u({ roles: ["ADMIN", "FINANCE", "OWNER"] })), true);
  assert.equal(bolehMenerimaTransfer(u({ role: "SALES" })), true, "jatuh ke role lama bila roles kosong");
  assert.equal(bolehMenerimaTransfer(u({ roles: ["DRIVER", "HELPER"] })), false);
  assert.equal(bolehMenerimaTransfer(u({ roles: ["PRODUCTION_LEAD"] })), false);
  assert.equal(bolehMenerimaTransfer(u({ roles: ["SALES"], active: false })), false);
  assert.equal(bolehMenerimaTransfer(null), false);
});

test("label peran memakai roles (multi-role), bukan field role lama", () => {
  assert.equal(labelPeranTransfer({ role: "SALES", roles: ["SALES", "ADMIN"] }), "Admin");
  assert.equal(labelPeranTransfer({ role: "ADMIN", roles: ["SALES"] }), "Sales");
});

test("PEMASANGAN: TransferModal memfilter daftar dan memakai helper label", () => {
  const s = fs.readFileSync(new URL("../src/components/TransferModal.js", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(s, /\.filter\(bolehMenerimaTransfer\)/);
  assert.match(s, /labelPeranTransfer\(u\)/);
  assert.doesNotMatch(s, /u\.role === "ADMIN"/);
});
