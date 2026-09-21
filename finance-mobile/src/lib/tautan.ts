// TAUTAN DARI NOTIFIKASI → rute layar. Data notifikasi berasal dari luar aplikasi, jadi TIDAK dipercaya: hanya `data.path` yang cocok dengan daftar putih
// di bawah yang dibuka (pola ketat, id dibatasi karakter dan panjang). Selain itu → null (tidak ada navigasi). Tidak ada nominal/nama di data.

export type RuteTautan =
  | { pathname: "/persetujuan/[jenis]/[id]"; params: { jenis: string; id: string } }
  | { pathname: "/pembayaran/[id]"; params: { id: string } }
  | { pathname: "/pembayaran" }
  | { pathname: "/tx/[modul]/[id]"; params: { modul: string; id: string } }
  | { pathname: "/tx/[modul]"; params: { modul: string } };

const ID = "[A-Za-z0-9_-]{1,64}";
const MODUL = "pengeluaran|pembelian|kasbon|pemasukan|piutang|refund|supplier|tagihan|pembayaran-supplier";

export function petaTautan(data: unknown): RuteTautan | null {
  if (!data || typeof data !== "object") return null;
  const path = (data as Record<string, unknown>).path;
  if (typeof path !== "string" || path.length > 200) return null;
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^/persetujuan/(expense|purchase|bill|refund)/(${ID})$`).exec(path))) return { pathname: "/persetujuan/[jenis]/[id]", params: { jenis: m[1] as string, id: m[2] as string } };
  if ((m = new RegExp(`^/pembayaran/(${ID})$`).exec(path))) return { pathname: "/pembayaran/[id]", params: { id: m[1] as string } };
  if (path === "/pembayaran") return { pathname: "/pembayaran" };
  if ((m = new RegExp(`^/tx/(${MODUL})/(${ID})$`).exec(path))) return { pathname: "/tx/[modul]/[id]", params: { modul: m[1] as string, id: m[2] as string } };
  if ((m = new RegExp(`^/tx/(${MODUL})$`).exec(path))) return { pathname: "/tx/[modul]", params: { modul: m[1] as string } };
  return null;
}

/** Tautan menunggu: disimpan sampai pengguna sudah masuk DAN kunci aplikasi terbuka, lalu dibuka sekali. */
let tertunda: RuteTautan | null = null;
const pendengar = new Set<() => void>();
export const tundaTautan = (r: RuteTautan | null) => { tertunda = r; pendengar.forEach((f) => f()); };
export const langgananTautan = (f: () => void) => { pendengar.add(f); return () => { pendengar.delete(f); }; };
export const ambilTautanTertunda = (): RuteTautan | null => { const r = tertunda; tertunda = null; return r; };
export const adaTautanTertunda = () => tertunda != null;
