import { api } from "@/api.js";
import { berurutan } from "../../marketingData.js";

/** Unduh Excel Marketing dari server. Melempar galat bila gagal; pemanggil yang menampilkannya. */
export async function unduhEksporMarketing(params) {
  const { blob, namaFile } = await berurutan(() => api.eksporMarketingExcel(params));
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u; a.download = namaFile; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(u);
}
