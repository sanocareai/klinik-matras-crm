// AI Studio MVP 2 — panel Copilot di Inbox. Pola proyek: fungsi murni dieksekusi dari modul; kontrak tampilan lewat text-scan sumber.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { usulanCrm, gabungBubble, nasibDraft, peringatan } from "../src/features/inbox/components/ChatWindow/copilotLogic.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baca = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("usulanCrm: hanya kota, tag keluhan, catatan; kota yang sama tidak diusulkan", () => {
  const u = usulanCrm({ domisili: "Bekasi", keluhan: "pinggang pegal", ukuran: "160", beratBadan: [85, 55], umurKasur: "8 tahun", posisiTidur: null }, { city: "Depok" });
  assert.deepEqual(u.map((x) => x.kunci), ["city", "tag", "note"]);
  assert.equal(u[2].nilai, "Ukuran: 160 · BB: 85 kg & 55 kg · Umur kasur: 8 tahun");
  assert.deepEqual(usulanCrm({ domisili: "bekasi " }, { city: "Bekasi" }), []);
  assert.deepEqual(usulanCrm({}, null), []);
  assert.ok(!usulanCrm({ pipelineStage: "TRANSACTION", domisili: "Bogor" }).some((x) => x.kunci === "pipelineStage"));
});

test("gabungBubble & nasibDraft", () => {
  assert.equal(gabungBubble(["Halo Kak ", "", "Ukurannya berapa?"]), "Halo Kak\n\nUkurannya berapa?");
  assert.equal(nasibDraft("Halo Kak\n\nUkurannya berapa?", "Halo Kak Ukurannya  berapa?"), "USED_AS_IS");
  assert.equal(nasibDraft("Halo Kak", "Halo Bu"), "USED_EDITED");
});

test("peringatan: hanya cek yang gagal", () => {
  assert.deepEqual(peringatan([{ lulus: true, pesan: "ok" }, { lulus: false, pesan: "Harga terlalu cepat" }]), ["Harga terlalu cepat"]);
  assert.deepEqual(peringatan(undefined), []);
});

test("kontrak: panel tidak mengirim sendiri kecuali lewat jalur kirim Composer, akses lewat /copilot/akses", () => {
  const panel = baca("src/features/inbox/components/ChatWindow/CopilotPanel.jsx");
  const composer = baca("src/features/inbox/components/ChatWindow/Composer.jsx");
  assert.doesNotMatch(panel, /api\.sendMessage/);
  assert.match(composer, /studioCopilotAkses/);
  assert.match(composer, /studioCopilotOutcome/);
  // Akun non-pilot tetap memakai Saran AI lama.
  assert.match(composer, /SuggestReplyPopover/);
});
