const { sh, sleep, launch, launchRelease, tap } = require("./adb-util.cjs");
const seq = (process.argv[2] || "Home,Chats,Home,Order,Home,Profil,Home,Chats,Order").split(",");
if (process.argv.includes("--launch")) launch(); if (process.argv.includes("--launch-release")) launchRelease();
sh("logcat -c");
for (const t of seq) { tap(t); sleep(Number(process.env.GAP || 3500)); }
const t = sh("logcat -d -s ReactNativeJS:V");
for (const m of t.matchAll(/TABPERF (\{.*\})/g)) console.log(m[1]);
