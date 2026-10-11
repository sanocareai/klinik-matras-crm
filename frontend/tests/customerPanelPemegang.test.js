// Panel pelanggan web harus memuat ulang customer (senyap) saat pemegang percakapan berubah — "Pemilik Lead" ikut berubah di server.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const s = fs.readFileSync(new URL("../src/features/inbox/components/CustomerPanel/index.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("ada efek yang bergantung pada conversation.assignedToId dan memanggil getCustomer", () => {
  assert.match(s, /useEffect\(\(\) => \{[\s\S]*?pemegangSebelumnya[\s\S]*?api\.getCustomer\(customerId\)[\s\S]*?\[conversation\?\.assignedToId, customerId, conversation\?\.type\]\);/);
});

test("muat ulang senyap: tidak mengosongkan panel (tidak ada setCustomer(null) di efek pemegang) dan melewati pemuatan pertama", () => {
  const blok = s.slice(s.indexOf("const pemegangSebelumnya"), s.indexOf("if (conversation?.type === \"GROUP\") {", s.indexOf("const pemegangSebelumnya")));
  assert.doesNotMatch(blok, /setCustomer\(null\)/);
  assert.match(blok, /awal === conversation\?\.assignedToId/);
});

test("TransferPickerPopover memfilter tujuan ke Sales/Admin aktif", () => {
  const t = fs.readFileSync(new URL("../src/features/inbox/components/ConversationList/TransferPickerPopover.jsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(t, /\.filter\(bolehMenerimaTransfer\)/);
  assert.match(t, /r === "SALES" \|\| r === "ADMIN"/);
});
