// Rekam layar perangkat selama rangkaian perpindahan tab (sebelum/sesudah). node scripts/tab-record.cjs <nama> 
const { sh, sleep, tap } = require("./adb-util.cjs");
const fs = require("fs");
const name = process.argv[2] || "rec";
sh("shell rm -f /sdcard/tabrec.mp4");
const { spawn } = require("child_process");
const rec = spawn(process.env.ADB || "C:/Users/rudya/AppData/Local/Android/Sdk/platform-tools/adb.exe", ["shell", "screenrecord", "--size", "540x1200", "--bit-rate", "3000000", "--time-limit", "28", "/sdcard/tabrec.mp4"], { stdio: "ignore" });
sleep(1500);
for (const t of ["Chats", "Home", "Pelanggan", "Order", "Profil", "Home", "Chats", "Order", "Home"]) { tap(t); sleep(1700); }
for (let i = 0; i < 8; i++) { tap(i % 2 ? "Home" : "Chats"); sleep(120); } // ketukan cepat
sleep(3000);
rec.kill();
sleep(1500);
sh(`pull /sdcard/tabrec.mp4 C:/tmp/${name}.mp4`);
console.log("saved", `C:/tmp/${name}.mp4`, fs.statSync(`C:/tmp/${name}.mp4`).size);
