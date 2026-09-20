// Mode performa: "auto" | "lite" | "full" (Otomatis / Ringan / Penuh).
// Hasil akhir ditandai di <html data-perf="lite|full">; CSS (styles/tokens.css,
// blok "PERF LITE") mematikan blur/glass, bayangan berat, dan animasi dekoratif.
// Pilihan user disimpan di localStorage["perf-mode"] (kosong = auto).
//
// Otomatis SENGAJA konservatif untuk Android/PWA (tempat GPU/CPU paling
// terbatas & baterai paling terasa): turun ke Ringan kecuali perangkat jelas
// kuat (RAM >= 8 GB dan >= 8 core) dan tidak hemat data/baterai lemah. Selain
// itu governor FPS menurunkan ke Ringan di tengah sesi bila scroll terukur
// patah-patah (proxy perangkat berat/memanas) — tidak pernah naik otomatis
// lagi (mencegah bolak-balik), user bisa memaksa Penuh kapan saja.

export const PERF_KEY = "perf-mode";
export const PERF_DEGRADED_KEY = "perf-auto-degraded";
export const PERF_EVENT = "perf-mode-change";

// Murni & bisa dites.
export function decideMode({
  pref = "auto", deviceMemory, hardwareConcurrency, saveData,
  isAndroid = false, isStandalone = false, batteryLow = false, degraded = false,
} = {}) {
  if (pref === "lite") return "lite";
  if (pref === "full") return "full";
  if (saveData || batteryLow || degraded) return "lite";
  const mem = typeof deviceMemory === "number" && deviceMemory > 0 ? deviceMemory : null;
  const cores = typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 ? hardwareConcurrency : null;
  if ((mem !== null && mem <= 4) || (cores !== null && cores <= 4)) return "lite";
  if (isAndroid || isStandalone) {
    // Android/PWA: Penuh hanya untuk perangkat yang jelas kuat.
    return mem !== null && cores !== null && mem >= 8 && cores >= 8 ? "full" : "lite";
  }
  return "full";
}

// Governor FPS (murni): terima selisih waktu antar frame selama scroll/interaksi.
// Turun ke Ringan bila cukup sampel dan persentil-75 frame > thresholdMs.
export function createFpsGovernor({ minSamples = 90, thresholdMs = 28, onDegrade } = {}) {
  const samples = [];
  let done = false;
  return {
    push(dt) {
      if (done || !(dt > 0) || dt > 1000) return; // abaikan jeda (tab background dsb.)
      samples.push(dt);
      if (samples.length < minSamples) return;
      const sorted = [...samples].sort((a, b) => a - b);
      const p75 = sorted[Math.floor(sorted.length * 0.75)];
      if (p75 > thresholdMs) { done = true; onDegrade?.(p75); }
      else samples.splice(0, samples.length - minSamples); // jendela bergulir
    },
    get degraded() { return done; },
  };
}

export function getPref() {
  try {
    const v = localStorage.getItem(PERF_KEY);
    return v === "lite" || v === "full" ? v : "auto";
  } catch { return "auto"; }
}

export function setPref(pref) {
  try {
    if (pref === "auto") { localStorage.removeItem(PERF_KEY); } else { localStorage.setItem(PERF_KEY, pref); }
    if (pref !== "auto") localStorage.removeItem(PERF_DEGRADED_KEY); // pilihan eksplisit menang, reset hasil governor
  } catch { /* storage diblokir */ }
  applyPerfMode();
  try { window.dispatchEvent(new Event(PERF_EVENT)); } catch { /* non-browser */ }
}

export function getResolvedMode() {
  return document.documentElement.dataset.perf === "lite" ? "lite" : "full";
}

let batteryLow = false;
let monitorStarted = false;

export function applyPerfMode() {
  try {
    const nav = navigator;
    let degraded = false;
    try { degraded = localStorage.getItem(PERF_DEGRADED_KEY) === "1"; } catch { /* diblokir */ }
    const mode = decideMode({
      pref: getPref(),
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      saveData: nav.connection?.saveData,
      isAndroid: /Android/i.test(nav.userAgent || ""),
      isStandalone: !!(window.matchMedia?.("(display-mode: standalone)").matches || window.Capacitor),
      batteryLow,
      degraded,
    });
    document.documentElement.dataset.perf = mode;
    return mode;
  } catch { return "full"; /* lingkungan non-browser */ }
}

// Pantau (murah, hanya aktif saat user scroll) + baterai. Panggil sekali setelah render pertama.
export function startPerfMonitor() {
  if (monitorStarted || typeof window === "undefined") return;
  monitorStarted = true;

  // Baterai lemah & tidak sedang mengisi → Ringan (hanya efektif untuk pref "auto").
  try {
    navigator.getBattery?.().then((b) => {
      const update = () => { const low = !b.charging && b.level <= 0.2; if (low !== batteryLow) { batteryLow = low; applyPerfMode(); } };
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});
  } catch { /* API tidak ada */ }

  // Governor FPS: sampel frame HANYA selama scroll (rAF berhenti 250 ms setelah scroll berhenti).
  if (getPref() !== "auto" || document.documentElement.dataset.perf === "lite") return;
  const gov = createFpsGovernor({
    onDegrade: () => {
      try { localStorage.setItem(PERF_DEGRADED_KEY, "1"); } catch { /* diblokir */ }
      applyPerfMode();
      window.removeEventListener("scroll", onScroll, true);
    },
  });
  let raf = 0, last = 0, idleTimer = 0;
  function frame(t) { if (last) gov.push(t - last); last = t; raf = requestAnimationFrame(frame); }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function onScroll() {
    if (getPref() !== "auto") return;
    if (!raf) raf = requestAnimationFrame(frame);
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, 250);
  }
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
}
