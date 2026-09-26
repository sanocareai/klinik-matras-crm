// Jaring regresi murah untuk UI (tidak ada harness render): memastikan modul Biaya Armada
// tidak punya tombol palsu, aksi sensitif dijaga izin dari server, semua mutation memakai
// Idempotency-Key, dan teks yang tampil berbahasa Indonesia.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const baca = (f) => readFileSync(path.join(dir, f), "utf8");
const layar = ["screens/BiayaArmadaScreen.js", "screens/BiayaDetailScreen.js", "screens/BiayaFormScreen.js"];

test("setiap <Btn> di layar Biaya Armada punya onPress (tidak ada tombol palsu)", () => {
  for (const f of layar) {
    const src = baca(f);
    const tombol = src.match(/<Btn\b[\s\S]*?\/>/g) || [];
    assert.ok(tombol.length > 0, f);
    for (const b of tombol) assert.match(b, /onPress=/, `${f}: ${b.slice(0, 60)}`);
  }
});

test("aksi di detail hanya muncul lewat allowedActions (izin server + status), bukan nama role", () => {
  const src = baca("screens/BiayaDetailScreen.js");
  assert.match(src, /allowedActions\(/);
  for (const k of ["aksi.edit", "aksi.ajukan", "aksi.tarik", "aksi.batalkan", "aksi.mintaRevisi", "aksi.setujui", "aksi.tolak"]) assert.match(src, new RegExp(k.replace(".", "\\.")), k);
  assert.doesNotMatch(src, /role\s*===|roles\.includes|"ADMIN"|"OWNER"/, "tidak menebak dari nama role");
});

test("semua aksi mutation memakai kunci idempotensi (newIdempotencyKey) dan alasan wajib untuk batalkan/revisi/tolak", () => {
  const detail = baca("screens/BiayaDetailScreen.js");
  assert.match(detail, /newIdempotencyKey/);
  for (const m of ["ajukan", "tarik", "batalkan", "mintaRevisi", "setujui", "tolak"]) assert.match(detail, new RegExp(`biayaArmadaApi\\.${m}\\(`), m);
  for (const aksi of ["batalkan", "revisi", "tolak"]) {
    const blok = detail.match(new RegExp(`aksi === "${aksi}"[\\s\\S]*?onConfirm`))?.[0] || "";
    assert.match(blok, /\breason\b/, `${aksi} wajib alasan`);
  }
  assert.match(baca("screens/BiayaFormScreen.js"), /newIdempotencyKey/);
});

test("daftar: loading, error+coba lagi, kosong, dan paginasi (Muat lebih banyak) tersedia", () => {
  const src = baca("screens/BiayaArmadaScreen.js");
  for (const teks of ["ActivityIndicator", "Coba lagi", "Belum ada pengajuan", "Muat lebih banyak", "adaLagi", "RefreshControl"]) assert.match(src, new RegExp(teks), teks);
});

test("form: draf lokal, foto struk, odometer dari config server, validasi sebelum kirim", () => {
  const src = baca("screens/BiayaFormScreen.js");
  for (const teks of ["Simpan draf lokal", "Potret struk", "metadataFieldsFor", "validateDraft", "Coba lagi"]) assert.match(src, new RegExp(teks), teks);
  assert.doesNotMatch(src, /launchImageLibrary|MediaLibrary/, "hanya kamera (tanpa izin galeri)");
});

test("timeline audit dan status pembayaran ditampilkan; teks berbahasa Indonesia", () => {
  const src = baca("screens/BiayaDetailScreen.js");
  for (const teks of ["describeAudit", "Status pembayaran", "Riwayat", "Foto struk", "Minta revisi"]) assert.match(src, new RegExp(teks), teks);
  for (const f of layar) assert.doesNotMatch(baca(f), /\b(Loading|Submit|Cancel|Approve|Reject)\b(?!\w)/, `${f}: teks Inggris`);
});

test("Home: setiap modul punya layar terdaftar dan digerbang capability server; tidak ada label Segera", () => {
  const src = baca("screens/HomeScreen.js");
  const app = readFileSync(path.join(dir, "../App.js"), "utf8");
  assert.doesNotMatch(src, /SEGERA|Segera/);
  assert.match(src, /disabled=\{!m\.ready\}/);
  assert.match(src, /ready: !!modules\[m\.cap\]/);
  const layarModul = [...src.matchAll(/screen: "(\w+)"/g)].map((m) => m[1]);
  assert.ok(layarModul.length >= 7);
  for (const nama of layarModul) assert.match(app, new RegExp(`name="${nama}"`), `layar ${nama} terdaftar`);
  for (const [nama, cap] of [["Dashboard", "dashboard"], ["Kru", "drivers"], ["Rute", "routes"], ["Tracking", "tracking"], ["Masalah", "issues"], ["Performa", "performance"]]) {
    assert.match(app, new RegExp(`modules\\.${cap} && <Stack\\.Screen name="${nama}"`), `${nama} digerbang ${cap}`);
  }
});

test("modul operasional: baca lewat operasionalApi, satu-satunya mutation (reschedule) memakai kunci idempotensi, tanpa izin lokasi", () => {
  const ops = ["DashboardScreen", "KruScreen", "KruDetailScreen", "RuteScreen", "RuteDetailScreen", "TrackingScreen", "MasalahScreen", "MasalahDetailScreen", "PerformaScreen"];
  for (const f of ops) {
    const src = baca(`screens/${f}.js`);
    assert.match(src, /operasionalApi\./, f);
    assert.doesNotMatch(src, /expo-location|getCurrentPosition|requestForegroundPermissions/, `${f}: tanpa lokasi HP`);
    assert.doesNotMatch(src, /client\.request\(/, `${f}: tanpa endpoint ad-hoc`);
  }
  const detail = baca("screens/MasalahDetailScreen.js");
  assert.match(detail, /operasionalApi\.reschedule\(job\.id, body, kunci\.current\)/);
  assert.match(detail, /newIdempotencyKey/);
  assert.match(detail, /modules\.reschedule && job\.status === "FAILED"/);
  for (const f of ops) assert.doesNotMatch(baca(`screens/${f}.js`), /\b(Loading|Submit|Cancel|Retry|Error)\b(?!\w)/, `${f}: teks Inggris`);
});

test("navigasi bawah hanya berisi tujuan yang punya layar", () => {
  const nav = baca("BottomNav.js");
  const tujuan = [...nav.matchAll(/name: "(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(tujuan, ["Home", "BiayaArmada"]);
});

test("ringkasan hanya membaca endpoint daftar yang ada (tanpa mutation)", () => {
  const src = baca("ringkasan.js");
  assert.match(src, /biayaArmadaApi\.list\(/);
  assert.doesNotMatch(src, /biayaArmadaApi\.(create|update|ajukan|tarik|batalkan|mintaRevisi|setujui|tolak)\(/);
});

test("foto struk dibuka lewat URL bertanda-tangan berumur pendek (bukan header Bearer / path penyimpanan), dengan ulang otomatis dan tombol Coba lagi", () => {
  const foto = baca("FotoStruk.js");
  assert.match(foto, /signMedia\(/);
  assert.match(foto, /onError/);
  assert.match(foto, /Coba lagi/);
  assert.doesNotMatch(foto, /Authorization|Bearer/);
  const detail = baca("screens/BiayaDetailScreen.js");
  assert.match(detail, /<FotoStruk /);
  assert.doesNotMatch(detail, /Authorization|getToken\(\)/);
});

test("Biaya Armada: verifikasi bukti dan bayar hanya lewat allowedActions, memakai kunci idempotensi, rekening dari server", () => {
  const detail = baca("screens/BiayaDetailScreen.js");
  for (const k of ["aksi.verifikasiBukti", "aksi.bayar"]) assert.match(detail, new RegExp(k.replace(".", "\.")), k);
  assert.match(detail, /biayaArmadaApi\.verifikasiBukti\(finId, k\)/);
  assert.match(detail, /biayaArmadaApi\.bayar\(finId, body, k\)/);
  const bayar = baca("BayarModal.js");
  assert.match(bayar, /biayaArmadaApi\.rekeningKas\(\)/);
  assert.doesNotMatch(bayar, /accounts:\s*\[/, "tidak ada rekening statis");
  const form = baca("screens/BiayaFormScreen.js");
  assert.match(form, /UANG_MUKA_OPERASIONAL/);
  assert.match(form, /biayaArmadaApi\.uangMukaAktif\(\)/);
});
