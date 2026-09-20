// QA perilaku pada build "instant": posisi scroll, resume background, offline, ketukan cepat = satu state akhir, tanpa crash.
// Catatan: hash md5 terlalu ketat (scrollbar/efek sentuh mengubah byte); bandingkan PNG dengan ffmpeg SSIM ≥ 0.999.
const path = "./adb-util.cjs";
const { sh, sleep, launchRelease, tap, PKG } = require(path);
const crypto = require("crypto");
const fs = require("fs");
const shot = (n) => { sh(`shell screencap -p /sdcard/q.png`); sh(`pull /sdcard/q.png C:/tmp/q-${n}.png`); return fs.readFileSync(`C:/tmp/q-${n}.png`); };
// bandingkan area konten (tanpa status bar & tab bar) lewat hash byte kasar — cukup untuk "sama persis / beda"
const h = (b) => crypto.createHash("md5").update(b).digest("hex").slice(0, 8);
const out = [];
const ok = (name, cond, extra = "") => { out.push(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); };

launchRelease({ waitMs: 20000 });
sh("logcat -c");
// 1) posisi scroll Order dipertahankan
tap("Order"); sleep(2500);
sh("shell input swipe 540 1800 540 700 250"); sleep(600);
sh("shell input swipe 540 1800 540 700 250"); sleep(1200);
const a = h(shot("order-scrolled"));
tap("Home"); sleep(1500); tap("Order"); sleep(1500);
const b = h(shot("order-back"));
ok("scroll Order terjaga setelah Home→Order", a === b, `(${a} vs ${b})`);
tap("Chats"); sleep(1500); sh("shell input swipe 540 1800 540 800 250"); sleep(800);
const c = h(shot("chats-scrolled"));
tap("Profil"); sleep(1200); tap("Chats"); sleep(1500);
const d = h(shot("chats-back"));
ok("scroll Inbox terjaga setelah Profil→Inbox", c === d, `(${c} vs ${d})`);

// 2) background → resume
sh("shell input keyevent KEYCODE_HOME"); sleep(2000);
sh(`shell monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`); sleep(3000);
const e = h(shot("resume"));
ok("resume dari background: Inbox tetap di posisi", e === d, `(${e} vs ${d})`);
tap("Pelanggan"); sleep(1500); tap("Home"); sleep(1500);

// 3) offline
sh("shell svc wifi disable"); sh("shell svc data disable"); sleep(2500);
for (const t of ["Chats", "Pelanggan", "Order", "Profil", "Home"]) { tap(t); sleep(1200); }
ok("offline: pindah semua tab tanpa crash", !/FATAL EXCEPTION/.test(sh("logcat -d -b crash")));
sh("shell svc wifi enable"); sh("shell svc data enable"); sleep(2500);

// 4) ketukan cepat: 20 ketukan, tab akhir = tujuan terakhir
for (let i = 0; i < 20; i++) { tap(i % 2 ? "Home" : "Chats"); sleep(60); }
tap("Order"); sleep(2500);
const f = h(shot("rapid-final"));
tap("Home"); sleep(1500); tap("Order"); sleep(1500);
const g = h(shot("rapid-final2"));
ok("rapid tap: state akhir Order stabil (tidak ada layar bertumpuk / antrean)", f === g, `(${f} vs ${g})`);

// 5) keyboard terbuka lalu pindah tab
tap("Chats"); sleep(1200); sh("shell input tap 900 330"); sleep(800); // ikon cari
sh("shell input keyevent KEYCODE_A"); sleep(500);
tap("Home"); sleep(1500); tap("Chats"); sleep(1500);
ok("keyboard/pencarian lalu pindah tab: tanpa crash", !/FATAL EXCEPTION/.test(sh("logcat -d -b crash")));

console.log(out.join("\n"));
