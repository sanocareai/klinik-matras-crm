import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api.js";
import { KUNCI_BATCH_AKTIF, SALURAN, STATUS_AKTIF, gabungStatus, intervalPolling } from "./postingHistorisModel.js";

// Status batch = milik SERVER. Hook ini hanya menampilkannya dan menjaga agar semua tab/jendela melihat hal yang sama:
//  • refresh / tutup tab / tab baru → ambil lagi dari server (daftar batch → batch aktif); tidak ada status yang disimpan di browser selain "batch mana yang terakhir dilihat".
//  • polling hanya saat tab terlihat (2,5 dtk bila ada batch aktif, 15 dtk idle), mundur eksponensial saat koneksi putus; status terakhir tetap tampil dan ditandai basi.
//  • tab lain diberi tahu lewat BroadcastChannel (+ event storage sebagai cadangan) agar langsung menyegarkan, bukan menunggu polling.
//  • aksi tulis dijaga ref (klik ganda dalam satu tab) dan idempotensi server (hash rencana = id batch; tab/orang lain yang menekan bersamaan mendapat batch yang SAMA).
const bacaId = () => { try { return localStorage.getItem(KUNCI_BATCH_AKTIF) || null; } catch { return null; } };
const simpanId = (id) => { try { if (id) localStorage.setItem(KUNCI_BATCH_AKTIF, id); } catch { /* penyimpanan diblokir: tanpa kehilangan fungsi */ } };

export function useBatchPostingHistoris({ aktif = true } = {}) {
  const [s, setS] = useState({ daftar: [], status: null, aktifId: null, memuat: true, galat: null, gagalBeruntun: 0, diperbaruiPada: null });
  const ref = useRef(s); ref.current = s;
  const timer = useRef(null); const kanal = useRef(null); const terbang = useRef(false); const hidup = useRef(true); const aksiRef = useRef(false); const hitungan = useRef(0);
  const [sibuk, setSibuk] = useState(false);

  const jadwal = useCallback(() => {
    clearTimeout(timer.current);
    if (!hidup.current || !aktif) return;
    const ms = intervalPolling({ status: ref.current.status?.status, tersembunyi: typeof document !== "undefined" && document.hidden, gagalBeruntun: ref.current.gagalBeruntun });
    if (ms == null) return; // tab tersembunyi: berhenti; visibilitychange memulai lagi
    timer.current = setTimeout(() => { ambil(); }, ms); // eslint-disable-line no-use-before-define
  }, [aktif]); // eslint-disable-line react-hooks/exhaustive-deps

  const ambil = useCallback(async ({ daftarJuga = false } = {}) => {
    if (terbang.current) return; terbang.current = true; hitungan.current += 1;
    try {
      const sekarang = ref.current;
      let daftar = sekarang.daftar; let id = sekarang.aktifId ?? bacaId();
      // daftar batch diambil bila belum ada batch terpilih, status terakhir tidak aktif, tiap ke-6 polling, atau diminta (mis. tab baru fokus)
      if (daftarJuga || !id || !STATUS_AKTIF.includes(sekarang.status?.status) || hitungan.current % 6 === 0) {
        daftar = (await api.daftarBatchPostingHistoris()).batch || [];
        const berjalan = daftar.find((b) => STATUS_AKTIF.includes(b.status));
        id = berjalan ? berjalan.batchId : (id && daftar.some((b) => b.batchId === id) ? id : (daftar[0]?.batchId ?? null));
      }
      const st = id ? await api.getBatchPostingHistoris(id) : null;
      if (!hidup.current) return;
      if (id) simpanId(id);
      setS({ daftar, status: st, aktifId: id, memuat: false, galat: null, gagalBeruntun: 0, diperbaruiPada: Date.now() });
    } catch (e) {
      if (!hidup.current) return;
      setS((p) => ({ ...p, status: gabungStatus(p.status, null), memuat: false, galat: e, gagalBeruntun: p.gagalBeruntun + 1 }));
    } finally { terbang.current = false; jadwal(); }
  }, [jadwal]);

  const beritahu = useCallback((id) => { try { kanal.current?.postMessage({ jenis: "segarkan", id }); } catch { /* kanal tertutup */ } simpanId(id); }, []);

  useEffect(() => {
    hidup.current = true; if (!aktif) return undefined;
    try { kanal.current = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(SALURAN) : null; } catch { kanal.current = null; }
    if (kanal.current) kanal.current.onmessage = (e) => { if (e?.data?.jenis === "segarkan") { if (e.data.id) setS((p) => ({ ...p, aktifId: e.data.id })); ambil({ daftarJuga: true }); } };
    const saatTerlihat = () => { if (!document.hidden) ambil({ daftarJuga: true }); else clearTimeout(timer.current); };
    const saatOnline = () => ambil({ daftarJuga: true });
    const saatStorage = (e) => { if (e.key === KUNCI_BATCH_AKTIF) ambil({ daftarJuga: true }); };
    document.addEventListener("visibilitychange", saatTerlihat); window.addEventListener("online", saatOnline); window.addEventListener("storage", saatStorage);
    ambil({ daftarJuga: true });
    return () => { hidup.current = false; clearTimeout(timer.current); document.removeEventListener("visibilitychange", saatTerlihat); window.removeEventListener("online", saatOnline); window.removeEventListener("storage", saatStorage); try { kanal.current?.close(); } catch { /* sudah tertutup */ } kanal.current = null; };
  }, [aktif, ambil]);

  async function jalankan(fn) {
    if (aksiRef.current) return null; // klik ganda dalam tab ini
    aksiRef.current = true; setSibuk(true);
    try {
      const hasil = await fn(); beritahu(hasil?.batchId); await ambil({ daftarJuga: true });
      // status server berubah sesaat SETELAH balasan (pekerja baru menulis sewa): segarkan lagi cepat agar tombol/label tidak tertinggal 2,5 dtk
      for (const ms of [700, 2000]) setTimeout(() => { if (hidup.current && !document.hidden) ambil(); }, ms);
      return hasil;
    }
    finally { aksiRef.current = false; setSibuk(false); }
  }
  const mulai = (data) => jalankan(() => api.mulaiBatchPostingHistoris(data));
  const lanjut = (id) => jalankan(() => api.lanjutBatchPostingHistoris(id));
  const hentikan = (id) => jalankan(() => api.hentikanBatchPostingHistoris(id));

  return { ...s, sibuk, ambil: () => ambil({ daftarJuga: true }), mulai, lanjut, hentikan };
}
