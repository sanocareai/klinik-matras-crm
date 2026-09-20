// Hitung jumlah native View & heap setelah mengunjungi tiap tab (dumpsys meminfo). Tanpa uiautomator.
const { sh, sleep, launchRelease, tap, PKG } = require("./adb-util.cjs");
const mem = () => { const t = sh(`shell dumpsys meminfo ${PKG}`); const g = (re) => (t.match(re) || [])[1]; return { views: +g(/Views:\s+(\d+)/), nativeMB: Math.round(+g(/Native Heap:\s+(\d+)/) / 1024), totalMB: Math.round(+g(/TOTAL PSS:\s+(\d+)/) / 1024) }; };
launchRelease({ waitMs: Number(process.env.WAIT || 20000) });
console.log("awal (Home)   ", JSON.stringify(mem()));
for (const t of ["Chats", "Pelanggan", "Order", "Profil", "Home"]) { tap(t); sleep(6000); console.log(("setelah " + t).padEnd(14), JSON.stringify(mem())); }
