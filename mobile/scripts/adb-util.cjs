// Helper adb bersama (benchmark & probe tab).
const { execSync } = require("child_process");
const fs = require("fs");
const ADB = process.env.ADB || "C:/Users/rudya/AppData/Local/Android/Sdk/platform-tools/adb.exe";
const PKG = "com.sanomatrassehat.salesapp";
const sh = (c, o = {}) => execSync(`"${ADB}" ${c}`, { encoding: "utf8", maxBuffer: 1e8, ...o });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Pusat tab (px, layar 1080×2400): Home, Chats, Pelanggan, Order, Profil.
const TABS = ["Home", "Chats", "Pelanggan", "Order", "Profil"];
const X = [152, 347, 542, 738, 932];
const Y = 2262;
const tap = (name) => sh(`shell input tap ${X[TABS.indexOf(name)]} ${Y}`);

function ui() { try { sh("shell uiautomator dump /sdcard/u.xml"); return sh("exec-out cat /sdcard/u.xml"); } catch { return ""; } }
function waitFor(text, ms = 90000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (ui().includes(text)) return true; sleep(1500); } return false; }

function launch() {
  sh(`shell am force-stop ${PKG}`);
  sleep(1500);
  sh(`shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  sleep(6000);
  const x = ui();
  if (x.includes("Development servers") || x.includes("DEVELOPMENT SERVERS")) {
    const m = x.match(/text="SANO Messenger"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (m) sh(`shell input tap ${(+m[1] + +m[3]) / 2 | 0} ${(+m[2] + +m[4]) / 2 | 0}`);
    sleep(8000);
  }
  // App memulihkan tab terakhir (state navigasi tersimpan), jadi Home belum tentu tampil: tunggu bundel selesai,
  // tutup menu developer bila muncul ("Continue"), lalu paksa mulai dari Home.
  sleep(25000);
  for (let i = 0; i < 4; i++) {
    const u = ui();
    const b = u.match(/text="Continue"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (b) sh(`shell input tap ${(+b[1] + +b[3]) / 2 | 0} ${(+b[2] + +b[4]) / 2 | 0}`); else break;
    sleep(1500);
  }
  tap("Home");
  sleep(4000);
  return true;
}


// Peluncuran build RILIS tanpa uiautomator: `uiautomator dump` mengaktifkan layanan aksesibilitas, dan selama aktif React Native
// membangun pohon aksesibilitas di setiap perubahan UI → perpindahan tab ±5x lebih lambat (artefak pengukuran, bukan perilaku
// pengguna nyata). Karena itu benchmark TIDAK BOLEH memanggil ui() sebelum/selama pengukuran.
function launchRelease({ waitMs = 30000 } = {}) {
  sh(`shell am force-stop ${PKG}`);
  sleep(1500);
  sh(`shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`);
  sleep(waitMs);
  tap("Home");
  sleep(4000);
  return true;
}

module.exports = { sh, sleep, ui, waitFor, launch, launchRelease, tap, TABS, X, Y, PKG, ADB };
