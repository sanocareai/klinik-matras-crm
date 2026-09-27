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
  assert.deepEqual(tujuan, ["Home", "BiayaArmada", "Akun"]);
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

test("Live Tracking: peta hanya menampilkan posisi dari server; tanpa izin/pembacaan lokasi HP, refresh 30 detik, ada daftar fallback", () => {
  const src = baca("screens/TrackingScreen.js");
  assert.match(src, /showsUserLocation=\{false\}/);
  assert.doesNotMatch(src, /showsUserLocation=\{true\}|expo-location|getCurrentPosition|watchPosition|requestForegroundPermissions/);
  assert.match(src, /SEGARKAN_MS = 30_000/);
  assert.match(src, /operasionalApi\.tracking\(\)/);
  for (const teks of ["Daftar", "Offline", "Coba lagi", "Belum ada armada terdaftar", "Tidak ada armada terdaftar", "Memuat posisi armada", "armada terdaftar, tetapi belum ada yang mengirim posisi GPS yang valid"]) assert.match(src, new RegExp(teks), teks);
  const cfg = baca("../app.config.js");
  assert.match(cfg, /react-native-maps/);
  for (const izin of ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "ACCESS_BACKGROUND_LOCATION"]) assert.match(cfg, new RegExp(izin), `${izin} tetap diblokir`);
});

test("Akun: profil dari server (akun sama dengan web), field izin read-only, tanpa profil lokal palsu", () => {
  const src = baca("screens/ProfileScreen.js");
  const api = baca("profileApi.js");
  assert.match(api, /"\/auth\/me"/);
  assert.match(api, /"\/users\/me"/);
  assert.match(api, /method: "PATCH"/);
  assert.match(api, /\/users\/me\/avatar/);
  assert.doesNotMatch(src + api, /AsyncStorage|setItem\(/, "tidak menyimpan profil lokal");
  assert.match(src, /muatUlangSesi\(\)/, "sesi diselaraskan ulang dari server setelah simpan");
  assert.match(src, /hanya bisa diubah Admin di web/);
  // peran/divisi/izin hanya ditampilkan (Chip), tidak ada Field untuk mengubahnya
  assert.doesNotMatch(src, /<Field[^>]*(peran|role|divisi|izin)/i);
  for (const teks of ["Simpan", "Ubah", "Batal", "Keluar", "Coba lagi", "Memuat profil"]) assert.match(src, new RegExp(teks), teks);
});

test("Pengaturan: hanya menu yang berfungsi; tidak ada 'keluar semua perangkat' palsu; tema disimpan lokal; info versi dari expo-application", () => {
  const src = baca("screens/SettingsScreen.js");
  assert.doesNotMatch(src, /title="[^"]*semua perangkat/i, "tanpa tombol logout semua perangkat (server belum mendukung)");
  assert.match(src, /setTema\(m\)/);
  assert.match(src, /Application\.nativeApplicationVersion/);
  assert.match(src, /Application\.nativeBuildVersion/);
  for (const teks of ["Tampilan", "Tentang aplikasi", "Privasi", "Keluar"]) assert.match(src, new RegExp(teks), teks);
  assert.match(baca("PengaturanContext.js"), /AsyncStorage\.setItem\(KUNCI\.tema/);
});

test("Biometrik: token di SecureStore, tanpa password/PIN tersimpan, biometrik hanya pembuka dan sesi divalidasi server", () => {
  const aman = baca("secureStorage.js");
  const sesi = baca("SessionContext.js");
  const bio = baca("biometrik.js");
  const semua = aman + sesi + bio + baca("PengaturanContext.js") + baca("screens/LockScreen.js") + baca("screens/LoginScreen.js");
  assert.match(aman, /SecureStore\.setItemAsync/);
  assert.match(aman, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(baca("client.js"), /storage: storageAman/);
  assert.match(bio, /expo-local-authentication/);
  assert.match(bio, /disableDeviceFallback: true/, "tanpa PIN perangkat sebagai jalan pintas");
  // tidak ada penyimpanan kata sandi/PIN
  assert.doesNotMatch(semua, /setItem\([^)]*(password|kata ?sandi|pin)\b/i);
  // buka kunci = biometrik lolos LALU restore() ke server; gagal -> login
  assert.match(sesi, /const h = await konfirmasiBiometrik\(\)[\s\S]*sessionManager\.restore\(\)/);
  assert.match(sesi, /keLogin\(PESAN_BERAKHIR\)/);
  // buka dingin terkunci: token tidak dibaca sebelum biometrik
  assert.match(sesi, /setTerkunci\(true\); setLoading\(false\); return;/);
  assert.match(baca("../App.js"), /terkunci && !session\) return <LockScreen/);
  // pengaturan: switch biometrik + auto-lock, tetap Indonesia
  const set = baca("screens/SettingsScreen.js");
  for (const teks of ["Keamanan", "Buka dengan biometrik", "Kunci otomatis"]) assert.match(set, new RegExp(teks), teks);
  assert.match(set, /PILIHAN_AUTO_LOCK\.map/);
  assert.match(baca("screens/LockScreen.js"), /Masuk dengan kata sandi/);
});

test("Peta Control mengikuti konfigurasi driver-mobile: provider Google, basemap selalu dirender, style gelap, remount tema, fit, tanpa kunci di repo", () => {
  const src = baca("screens/TrackingScreen.js");
  const ada = (teks, pesan) => assert.ok(src.includes(teks), pesan || teks);
  ada('provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}');
  ada("initialRegion={wilayah || JAKARTA}", "wilayah bawaan saat marker 0");
  ada("customMapStyle={gelap ? MAP_STYLE_DARK : undefined}");
  ada('key={`${gelap ? "gelap" : "terang"}-${petaKey}`}', "remount saat tema berganti");
  ada("onMapLoaded");
  ada("fitToCoordinates");
  ada("kunciMarker(armada)", "fit hanya saat himpunan marker berubah");
  assert.equal(src.includes("kosong ? <StateView"), false, "peta tidak diganti StateView saat kosong");
  // style gelap identik dengan driver-mobile (salinan); driver-mobile tidak disentuh
  assert.equal(baca("lib/googleMapStyle.js"), readFileSync(path.join(dir, "../../driver-mobile/src/lib/googleMapStyle.js"), "utf8"));
  // kunci Google Maps TIDAK ada di source Control; disuntikkan lewat env
  const cfg = baca("../app.config.js");
  assert.ok(cfg.includes("process.env.GOOGLE_MAPS_ANDROID_KEY"));
  assert.doesNotMatch(cfg + src + baca("ikonFoto.js"), /AIza[0-9A-Za-z_-]{20,}/, "tidak ada kunci API di repo");
  for (const izin of ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION", "ACCESS_BACKGROUND_LOCATION"]) assert.ok(cfg.includes(izin), izin);
});

test("Foto driver: Avatar memakai foto server dengan inisial hanya fallback; layar memakai URL dari respons agregat (tanpa fetch per pengguna)", () => {
  const ui = baca("ui.js");
  assert.ok(ui.includes("export function Avatar({ name, size = 40, online, uri })"));
  assert.ok(ui.includes("onError={() => setGagal(true)}"));
  assert.ok(ui.includes("client.mediaUrl(uri)"));
  const per = { "screens/PerformaScreen.js": "o.avatarUrl", "screens/KruScreen.js": "k.avatarUrl", "screens/RuteScreen.js": "r.driver?.avatarUrl", "screens/TrackingScreen.js": "a.fotoDriver", "screens/RuteDetailScreen.js": "o?.avatarUrl" };
  for (const [f, ekspresi] of Object.entries(per)) assert.ok(baca(f).includes("uri={" + ekspresi + "}"), f);
  assert.ok(baca("screens/KruDetailScreen.js").includes("uri={avatarUrl ||"));
  assert.ok(baca("screens/KruScreen.js").includes("avatarUrl: k.avatarUrl || null"));
  // marker peta: ikon foto native (PNG agar bulat tetap transparan), bukan <Image> jaringan di dalam Marker
  assert.ok(baca("ikonFoto.js").includes("SaveFormat.PNG"));
  assert.ok(baca("screens/TrackingScreen.js").includes("icon={{ uri }}"));
  // tanpa permintaan foto per pengguna
  for (const f of ["ui.js", "screens/KruScreen.js", "screens/PerformaScreen.js", "screens/TrackingScreen.js"]) assert.doesNotMatch(baca(f), /users\/\$\{|\/users\/[^"]*avatar/, f);
});
