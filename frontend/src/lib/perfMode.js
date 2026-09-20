// Mode ringan untuk HP lama / hemat data. Menandai <html data-perf="lite">;
// CSS di index.css (blok "PERF LITE") mematikan backdrop-filter (blur/glass —
// paling mahal di GPU HP lama) dan memangkas animasi dekoratif, tampilan
// dasar tetap sama. Override manual: localStorage "perf-mode" = "lite" | "full".

// Murni & bisa dites: putuskan lite atau full dari sinyal perangkat.
export function detectLite({ deviceMemory, hardwareConcurrency, saveData, override } = {}) {
  if (override === "lite") return true;
  if (override === "full") return false;
  if (saveData) return true;
  if (typeof deviceMemory === "number" && deviceMemory > 0 && deviceMemory <= 4) return true;
  if (typeof hardwareConcurrency === "number" && hardwareConcurrency > 0 && hardwareConcurrency <= 4) return true;
  return false;
}

export function applyPerfMode() {
  try {
    const nav = navigator;
    let override;
    try { override = localStorage.getItem("perf-mode") || undefined; } catch { /* storage diblokir */ }
    const lite = detectLite({
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      saveData: nav.connection?.saveData,
      override,
    });
    document.documentElement.dataset.perf = lite ? "lite" : "full";
  } catch { /* lingkungan non-browser */ }
}
