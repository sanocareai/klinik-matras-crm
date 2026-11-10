import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleSlash, Columns3, Info, ListFilter, MessageSquare, Search, ShieldCheck, X } from "lucide-react";
import InfoTooltip from "@/components/ui/info-tooltip.jsx";
import { cn } from "@/lib/utils.js";
import { METRIK_URUT, urutkan, penandaPerSumber, teksSorotan, angka, formatPersen, rupiah, selBiayaSumber, selTotalBerbayar, delta, deltaTeks, DASAR_BIAYA_LABEL, BUKTI_LABEL, sementaraTeks } from "../../akuisisiLogic.js";
import { KOLOM_SUMBER, kolomPilihan, konversiTotal, leadTanpaSpam, migrasiPilihanKolom } from "../../marketingLogic.js";
import { PAKEM_KANAL, kelompokkanSumber, kategoriSumber, namaKelompok, SARING_SUMBER, saringSumber, rupiahRingkas } from "../../kanalPakem.js";
import LogoSumber from "../LogoSumber.jsx";

// Peringkat semua sumber (label CRM): tabel (kolom utama; tambahan via "Kolom lengkap"). Klien hanya menampilkan/mengurutkan angka server.
// Sumber tanpa hasil TETAP tampil (lead 0 bukan dihilangkan). Biaya organik = "tidak tersedia", bukan Rp0. Konversi UTAMA = ber-order ÷ TOTAL lead (termasuk spam); non-spam kolom terpisah.
export const TIP = {
  lead: "TOTAL lead berlabel sumber itu (label CRM): customer baru dibuat di periode. Spam ikut terhitung; lead sah = bukan spam/internal/B2B/karyawan.",
  leadTanpaSpam: "Total lead dikurangi lead yang ditandai SPAM. Baris total sama dengan dasar Conversion di Dashboard Sales CRM; New Leads Dashboard = Total lead (termasuk spam).",
  prospek: "METRIK UTAMA. Lead sah yang PERNAH dipindah ke stage PROSPECT oleh sales (riwayat transisi sejak 25 Jul 2026; lead lama tanpa riwayat dihitung bila stage-nya sekarang PROSPECT). Keputusan MANUAL sales, bukan skor otomatis dan bukan qualified lead objektif. Tidak termasuk lead yang langsung ke transaksi tanpa catatan PROSPECT.",
  prospekLanjut: "RINCIAN (definisi lama, label tersendiri). Lead sah yang pernah di stage PROSPECT, TRANSACTION, atau REVIEWED. Lebih besar dari prospek eksplisit karena memuat lead yang langsung ke transaksi tanpa catatan PROSPECT (belum dapat dipastikan sales menilainya prospek). Selisihnya ditampilkan di bawah angka.",
  biayaProspek: "Biaya sumber ÷ PROSPEK EKSPLISIT (bukan prospek-atau-lanjut). Terisi hanya bila biaya sumber lengkap setiap hari dan ada prospek eksplisit; selain itu kosong dengan alasan, bukan Rp0.",
  spam: "Persentase lead sumber ini yang ditandai SPAM. Diagnostik kualitas targeting — bukan penalti.",
  berOrder: "Customer unik dengan ≥ 1 order eligible (bukan batal/pending, bukan penjualan karyawan). Ber-order BUKAN berarti sudah membayar.",
  membayar: "Customer dengan ≥ 1 pembayaran sah di ledger. Batas bawah: pembayaran di luar sistem tidak terlihat.",
  lunas: "Customer lunas TERBUKTI LEDGER: ledger order-nya (setelah refund disetujui) menutup seluruh tagihan. Angka hitung; cakupan ledger dinilai terpisah (Kualitas data).",
  nilai: "Σ nilai order eligible kohort lead periode ini (nilai SAAT INI). Bukan uang diterima dan bukan laba.",
  uang: "Pembayaran sah di ledger dikurangi refund disetujui, kohort lead periode ini. Bukan nilai order, bukan laba.",
  spend: "Biaya sumber pada periode yang sama; terisi hanya bila lengkap setiap hari (detail Ad, entri harian, atau total rentang). Kosong ≠ Rp0. Terisi ≠ diverifikasi independen.",
  konversi: "UTAMA: customer ber-order ÷ TOTAL lead (termasuk spam); pembilang/penyebut ditampilkan. 'Sampel kecil' = < 30 lead — aturan tampilan sementara, bukan uji signifikansi.",
  konversiNonSpam: "Terpisah dari konversi utama: customer ber-order ÷ lead sah (tanpa spam/staf/karyawan).",
  cpa: "Biaya sumber ÷ customer UNIK lunas (kohort lead periode ini). Dasar: Atribusi label CRM — bukan CPA campaign. 'Sementara' bila ledger parsial atau kohort < 30 hari.",
  booked: "Booked ROAS = nilai order ÷ biaya. Belum tentu uang diterima.",
  cash: "Cash ROAS = uang diterima bersih ÷ biaya. Batas bawah bila ledger tidak lengkap.",
};

const BUKAN_BIAYA = "tidak tersedia";
/** Nilai satu sel: { t, sub, kosong, title }. Satu fungsi untuk tabel desktop dan kartu mobile (angka identik). */
export function selSumber(s, id, { banding = false, lap } = {}) {
  const organik = s.jenis === "ORGANIK" || s.jenis === "INTERNAL";
  const d = (kunci) => (banding ? deltaTeks(delta(lap, s.id, kunci)) : null);
  const biaya = (kunci) => {
    if (organik) return { t: BUKAN_BIAYA, kosong: true };
    const c = selBiayaSumber(s, kunci);
    return { t: c.teks, kosong: c.kosong, sub: c.sementara ? `sementara${c.alasan ? ` · ${c.alasan}` : ""}` : c.alasan || null };
  };
  switch (id) {
    case "lead": return { t: angka(s.lead), sub: d("lead") ? `${d("lead")} vs sebelumnya` : null };
    case "leadTanpaSpam": return { t: angka(leadTanpaSpam(s)), kosong: s.lead == null, sub: s.spam > 0 ? `−${angka(s.spam)} spam` : null, title: `${s.lead} lead dikurangi ${s.spam ?? 0} spam` };
    case "prospek": {
      const e = s.prospek?.prospekEksplisit; if (!e) return { t: "—", kosong: true };
      const q = s.prospek;
      return { t: angka(e.jumlah), kosong: false, sub: e.persenDariLeadSah == null ? "—" : `${formatPersen(e.persenDariLeadSah)} dari lead sah`, title: `Prospek eksplisit ${e.jumlah} dari ${e.penyebut} lead sah (bertanggal ${e.berTanggal}, lead lama tanpa riwayat ${e.tanpaRiwayat}). Saat ini PROSPECT: ${q.saatIniProspect}. Penilaian manual sales.` };
    }
    case "prospekLanjut": {
      const a = s.prospek?.pernahProspekAtauLanjut; if (!a) return { t: "—", kosong: true };
      const q = s.prospek;
      return { t: angka(a.jumlah), kosong: false, sub: `+${angka(q.selisihAtauLanjutMinusEksplisit)} lanjut tanpa catatan PROSPECT`, title: `Prospek atau lanjut (definisi lama) ${a.jumlah} dari ${a.penyebut} lead sah. Prospek eksplisit ${q.prospekEksplisit?.jumlah}. Langsung ke transaksi tanpa PROSPECT: ${q.langsungKeTransaksiTanpaProspect}.` };
    }
    case "biayaProspek": return biaya("costPerProspekEksplisit");
    case "spam": return { t: formatPersen(s.spamPersen?.nilai), sub: `${angka(s.spam)} lead`, title: `${s.spamPersen?.pembilang} dari ${s.spamPersen?.penyebut} lead` };
    case "berOrder": return { t: angka(s.berOrder), sub: d("berOrder") ? `${d("berOrder")} vs sebelumnya` : null };
    case "membayar": return { t: angka(s.membayar), sub: d("membayar") ? `${d("membayar")} vs sebelumnya` : null };
    case "lunas": return { t: angka(s.lunas), sub: d("lunas") ? `${d("lunas")} vs sebelumnya` : null };
    case "nilai": return { t: rupiah(s.uang?.nilaiOrderSaatIni) };
    case "uang": return { t: rupiah(s.uang?.uangBersih) };
    case "spend": return biaya("spend");
    case "konversi": return { t: formatPersen(s.konversiOrder?.nilai), kosong: s.konversiOrder?.nilai == null, sub: `${s.konversiOrder?.pembilang}/${s.konversiOrder?.penyebut}${s.sampelKecil ? " · sampel kecil" : ""}`, title: `${s.konversiOrder?.pembilang} dari ${s.konversiOrder?.penyebut} total lead (termasuk spam)` };
    case "konversiNonSpam": return { t: formatPersen(s.konversiOrderNonSpam?.nilai), kosong: s.konversiOrderNonSpam?.nilai == null, sub: `${s.konversiOrderNonSpam?.pembilang}/${s.konversiOrderNonSpam?.penyebut}` };
    case "cpa": return biaya("cpa");
    case "booked": return biaya("bookedRoas");
    case "cash": return biaya("cashRoas");
    default: return { t: "—", kosong: true };
  }
}
/** Sel baris TOTAL (semua sumber). Biaya/CPA/ROAS = total sumber berbayar dari server (pembilang dan penyebut total); organik tidak punya biaya dialokasikan. */
export function selTotal(lap, id) {
  const t = lap?.total; if (!t) return { t: "—", kosong: true };
  const bb = t.berbayar; const k = konversiTotal(t);
  const tb = (kunci) => { const c = selTotalBerbayar(bb, kunci); return { t: c.teks, kosong: c.kosong, sub: c.kosong ? c.alasan : c.sementara ? "sementara" : null }; };
  switch (id) {
    case "lead": return { t: angka(t.lead), sub: "= New Leads Dashboard", title: "Total lead termasuk spam; sama dengan New Leads di Dashboard Sales CRM untuk periode yang sama" };
    case "leadTanpaSpam": return { t: angka(leadTanpaSpam(t)), sub: "= dasar Conversion", title: `${t.lead} lead dikurangi ${t.spam ?? 0} spam; sama dengan penyebut Conversion di Dashboard Sales CRM untuk periode yang sama` };
    case "prospek": return t.prospek ? { t: angka(t.prospek.prospekEksplisit), sub: t.leadSah > 0 ? `${formatPersen(Math.round((t.prospek.prospekEksplisit / t.leadSah) * 10000) / 100)} dari lead sah` : "—", title: `Total prospek eksplisit; saat ini PROSPECT ${t.prospek.saatIniProspect}.` } : { t: "—", kosong: true };
    case "prospekLanjut": return t.prospek ? { t: angka(t.prospek.pernahProspekAtauLanjut), sub: `+${angka(t.prospek.selisihAtauLanjutMinusEksplisit)} lanjut tanpa catatan PROSPECT`, title: `Total prospek atau lanjut (definisi lama); langsung ke transaksi ${t.prospek.langsungKeTransaksiTanpaProspect}.` } : { t: "—", kosong: true };
    case "biayaProspek": return { t: "—", kosong: true, sub: "hanya per sumber" };
    case "spam": return { t: formatPersen(t.lead ? Math.round((t.spam / t.lead) * 10000) / 100 : null), sub: `${angka(t.spam)} lead` };
    case "berOrder": return { t: angka(t.berOrder) };
    case "membayar": return { t: angka(t.membayar) };
    case "lunas": return { t: angka(t.lunas) };
    case "nilai": return { t: rupiah(t.nilaiOrderSaatIni) };
    case "uang": return { t: rupiah(t.uangBersih) };
    case "spend": return tb("spend");
    case "konversi": return { t: formatPersen(k.nilai), kosong: k.nilai == null, sub: `${k.pembilang}/${k.penyebut}` };
    case "konversiNonSpam": return { t: formatPersen(k.nilaiNonSpam), kosong: k.nilaiNonSpam == null, sub: `${k.pembilang}/${k.penyebutNonSpam}` };
    case "cpa": return tb("cpa");
    case "booked": return tb("bookedRoas");
    case "cash": return tb("cashRoas");
    default: return { t: "—", kosong: true };
  }
}

// ── Tampilan (redesain Apple, 10 Nov 2026) ── hanya penyajian: angka dari selSumber/selTotal di atas, tidak dihitung ulang.
const KOLOM_UANG = new Set(["nilai", "uang", "spend", "cpa", "biayaProspek"]);
const KOLOM_BIAYA = new Set(["spend", "cpa", "booked", "cash", "biayaProspek"]);
const KUNCI_KOLOM = "mk-kolom-sumber";
const bacaKolom = () => { try { const v = JSON.parse(localStorage.getItem(KUNCI_KOLOM) || "null"); return Array.isArray(v) ? migrasiPilihanKolom(v) : null; } catch { return null; } };
const simpanKolom = (v) => { try { if (v) localStorage.setItem(KUNCI_KOLOM, JSON.stringify(v)); else localStorage.removeItem(KUNCI_KOLOM); } catch { /* penyimpanan tidak tersedia: pilihan berlaku sampai halaman ditutup */ } };
/** "Rp98.020.000" → "Rp98,02 jt" (nilai penuh tetap di title). Teks lain apa adanya. */
const ringkasUang = (t) => (/^Rp[\d.]+$/.test(t || "") ? rupiahRingkas(Number(t.slice(2).replace(/\./g, ""))) : t);

function Sel({ id, c }) {
  const bukanBiaya = c.t === BUKAN_BIAYA;
  const uang = KOLOM_UANG.has(id) && !bukanBiaya;
  const tampil = bukanBiaya ? "—" : uang ? ringkasUang(c.t) : c.t;
  const judul = [bukanBiaya ? "Biaya tidak tersedia: sumber ini tidak punya biaya iklan langsung (bukan Rp0)" : uang && tampil !== c.t ? c.t : null, c.title, c.sub].filter(Boolean).join(" · ") || undefined;
  // Chip hanya untuk status yang memang "sementara" / "belum lengkap"; alasan lain (mis. belum ada customer lunas) tetap ditulis apa adanya.
  const chip = KOLOM_BIAYA.has(id) && c.sub && !bukanBiaya ? (/sementara/i.test(c.sub) ? "Sementara" : /lengkap|hari berjalan|belum ada data/i.test(c.sub) ? "Belum lengkap" : null) : null;
  return (
    <td className={cn("mk-sel", (c.kosong || bukanBiaya) && "mk-sel--kosong")} title={judul}>
      <span className="mk-sel-nilai">{tampil}</span>
      {chip ? <span className="mk-chip mk-chip--kecil" data-nada="peringatan">{chip}</span> : c.sub && <span className="mk-sel-sub">{c.sub}</span>}
    </td>
  );
}

/** Popover kecil (Filter, Kolom). Tutup dengan klik di luar atau Escape. */
function Popover({ label, ikon: Ikon, aktif = false, testid, children }) {
  const [buka, setBuka] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!buka) return undefined;
    const luar = (e) => { if (ref.current && !ref.current.contains(e.target)) setBuka(false); };
    const esc = (e) => { if (e.key === "Escape") setBuka(false); };
    document.addEventListener("mousedown", luar); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", luar); document.removeEventListener("keydown", esc); };
  }, [buka]);
  return (
    <div className="mk-pop" ref={ref}>
      <button type="button" className={cn("mk-alat", aktif && "mk-alat--aktif")} aria-expanded={buka} aria-haspopup="dialog" onClick={() => setBuka((v) => !v)} data-testid={testid}><Ikon size={15} aria-hidden="true" /> {label}{aktif && <span className="mk-alat-titik" aria-label="aktif" />}</button>
      {buka && <div className="mk-pop-isi" role="dialog" aria-label={label}>{children}</div>}
    </div>
  );
}

// Performa sumber: satu tabel untuk semua lebar layar (gulir mendatar di dalam panel, kolom Sumber menempel). Kelompok sumber tetap terpisah — tidak ada peringkat gabungan
// sumber berbayar, internal, dan tanpa atribusi. Baris membuka rincian; tombol di dalam baris tidak ikut membuka rincian.
export default function TabelSumber({ lap, urutId, kolomMode, bandingkan, onUbah, onBuka, periodeOk, onLihatChat }) {
  const [infoId, setInfoId] = useState(null);
  const [saring, setSaring] = useState("semua");
  const [cari, setCari] = useState("");
  const [sembunyikanKosong, setSembunyikanKosong] = useState(false);
  const [pilihanKolom, setPilihanKolom] = useState(bacaKolom);
  const kolom = useMemo(() => kolomPilihan(kolomMode, pilihanKolom), [kolomMode, pilihanKolom]);
  const urut = useMemo(() => urutkan(lap?.sumber || [], urutId), [lap, urutId]);
  const tampil = useMemo(() => saringSumber(urut, { saring, cari, sembunyikanKosong }), [urut, saring, cari, sembunyikanKosong]);
  const kelompok = useMemo(() => kelompokkanSumber(tampil), [tampil]);
  const penanda = useMemo(() => penandaPerSumber(lap?.sorotan), [lap]);   // sorotan dipilih SERVER dari data (bukan hardcode)
  const lengkap = kolomMode === "lengkap";
  const tersaring = saring !== "semua" || !!cari.trim() || sembunyikanKosong;
  const labelUrut = METRIK_URUT.find((m) => m.id === urutId)?.label;
  const buka = (e, id) => { if (e.type === "click" || e.key === "Enter" || e.key === " ") { e.preventDefault(); onBuka(id); } };
  const aturKolom = (ids) => { setPilihanKolom(ids); simpanKolom(ids); if (lengkap) onUbah({ kolom: "ringkas" }); };
  const toggleKolom = (id) => { const kini = kolom.map((k) => k.id); const baru = kini.includes(id) ? kini.filter((x) => x !== id) : [...kini, id]; if (baru.length) aturKolom(baru); };
  const kolomAwal = () => { setPilihanKolom(null); simpanKolom(null); if (lengkap) onUbah({ kolom: "ringkas" }); };
  const semuaKolom = () => onUbah({ kolom: lengkap ? "ringkas" : "lengkap" });

  return (
    <section className="mk-panel mk-sumber" data-testid="tabel-sumber" aria-label="Performa sumber">
      <div className="mk-sumber-kepala">
        <div className="mk-sumber-judul">
          <h3 className="mk-panel-judul">Performa sumber
            <InfoTooltip text={`Urut menurut ${labelUrut?.toLowerCase() || "pilihan"} di dalam tiap kelompok — kelompok tidak diperingkat bersama. Sumber dengan sampel kecil (< 30 lead) tidak dibandingkan pada rasio. Klik baris untuk rincian; ikon i untuk penjelasan channel.`} />
          </h3>
          <p className="mk-sumber-deskripsi">Klik baris untuk rincian. Peringkat hanya di dalam kelompok.</p>
        </div>
        <div className="mk-sumber-kontrol">
        <div className="mk-seg" role="group" aria-label="Kelompok sumber">
          {SARING_SUMBER.map((s) => <button key={s.id} type="button" aria-pressed={saring === s.id} onClick={() => setSaring(s.id)} data-testid={`saring-sumber-${s.id}`}>{s.label}</button>)}
        </div>
        <div className="mk-toolbar">
          <label className="mk-cari">
            <Search size={15} aria-hidden="true" />
            <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari sumber…" aria-label="Cari sumber" data-testid="cari-sumber" />
          </label>
          <label className="mk-pilih">
            <span>Urutkan</span>
            <select value={urutId} onChange={(e) => onUbah({ urut: e.target.value })} aria-label="Urutkan peringkat menurut" data-testid="pilih-urut">
              {METRIK_URUT.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          <Popover label="Filter" ikon={ListFilter} aktif={sembunyikanKosong || bandingkan} testid="filter-sumber">
            <label className="mk-cek"><input type="checkbox" checked={sembunyikanKosong} onChange={(e) => setSembunyikanKosong(e.target.checked)} data-testid="sembunyikan-kosong" /> Sembunyikan sumber tanpa lead</label>
            <label className="mk-cek"><input type="checkbox" checked={!!bandingkan} aria-pressed={bandingkan} disabled={!periodeOk} onChange={() => onUbah({ banding: !bandingkan })} data-testid="toggle-banding" /> Bandingkan dengan periode sebelumnya</label>
            <p className="mk-pop-catatan">Perbandingan menambah selisih di bawah angka; definisinya tidak berubah.</p>
          </Popover>
          <Popover label="Kolom" ikon={Columns3} aktif={lengkap || !!pilihanKolom} testid="toggle-kolom">
            <div className="mk-pop-preset">
              <button type="button" className="mk-kapsul mk-kapsul--kecil" onClick={kolomAwal} data-testid="kolom-awal">Kolom awal</button>
              <button type="button" className={cn("mk-kapsul mk-kapsul--kecil", lengkap && "mk-kapsul--aktif")} aria-pressed={lengkap} onClick={semuaKolom} data-testid="kolom-lengkap">Semua kolom</button>
            </div>
            <div className="mk-pop-daftar">
              {KOLOM_SUMBER.map((k) => (
                <label key={k.id} className="mk-cek"><input type="checkbox" checked={kolom.some((x) => x.id === k.id)} onChange={() => toggleKolom(k.id)} data-testid={`kolom-${k.id}`} /> {k.label}</label>
              ))}
            </div>
          </Popover>
        </div>
        </div>
      </div>

      <div className="mk-gulir" tabIndex={0} role="region" aria-label="Tabel performa sumber; gulir mendatar untuk kolom lain">
        <table className="mk-tabel" style={{ minWidth: 300 + kolom.length * 136 }}>
          <thead>
            <tr>
              <th scope="col" className="mk-kiri">Sumber</th>
              {kolom.map((k) => <th key={k.id} scope="col"><span className="mk-th">{k.label}<InfoTooltip text={TIP[k.id]} /></span></th>)}
              <th scope="col" className="mk-panah"><span className="sr-only">Buka rincian</span></th>
            </tr>
          </thead>
          <tbody>
            {kelompok.length === 0 && <tr><td colSpan={kolom.length + 2} className="mk-tabel-kosong" data-testid="sumber-tersaring-kosong">Tidak ada sumber yang cocok dengan saringan ini.</td></tr>}
            {kelompok.map((g) => (
              <React.Fragment key={g.nama}>
                <tr className="mk-grup" data-testid={`kelompok-${g.nama}`}>
                  <th scope="colgroup" colSpan={kolom.length + 2} className="mk-kiri"><span className="mk-grup-nama">{namaKelompok(g.nama)}</span>{g.catatan && <span className="mk-grup-catatan">{g.catatan}</span>}</th>
                </tr>
                {g.baris.map((s) => {
                  const pakem = PAKEM_KANAL[s.id];
                  const terbuka = infoId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <tr className="mk-baris" tabIndex={0} onClick={(e) => buka(e, s.id)} onKeyDown={(e) => buka(e, s.id)} data-testid={`baris-sumber-${s.id}`} aria-label={`Buka rincian ${s.label}`}>
                        <th scope="row" className="mk-kiri">
                          <span className="mk-sumber-sel">
                            <LogoSumber id={s.id} size={34} />
                            <span className="mk-sumber-teks">
                              <span className="mk-sumber-nama">{s.label}
                                {pakem && <button type="button" className="mk-info" aria-expanded={terbuka} aria-label={`Penjelasan ${s.label}`} data-testid={`info-${s.id}`}
                                  onClick={(e) => { e.stopPropagation(); setInfoId(terbuka ? null : s.id); }} onKeyDown={(e) => e.stopPropagation()}><Info size={15} strokeWidth={2.2} aria-hidden="true" /></button>}
                              </span>
                              <span className="mk-sumber-kategori">{kategoriSumber(s.id)}</span>
                              {(s.sampelKecil || (penanda.get(s.id) || []).length > 0) && (
                                <span className="mk-sumber-tanda">
                                  {s.sampelKecil && <span className="mk-chip mk-chip--kecil" data-nada="netral" title="Kurang dari 30 lead: tidak dibandingkan pada rasio">Sampel kecil</span>}
                                  {/* Sorotan dipilih server; satu chip ringkas, semua sorotan lengkap di title. */}
                                  {(() => { const p = penanda.get(s.id) || []; return p.length > 0 && <span className="mk-chip mk-chip--kecil" data-nada="ok" title={p.map(teksSorotan).join(" · ")} data-testid={`sorotan-${s.id}`}>{p[0].label}{p.length > 1 ? ` +${p.length - 1}` : ""}</span>; })()}
                                </span>
                              )}
                            </span>
                          </span>
                        </th>
                        {kolom.map((k) => <Sel key={k.id} id={k.id} c={selSumber(s, k.id, { banding: bandingkan, lap })} />)}
                        <td className="mk-panah"><ChevronRight size={16} aria-hidden="true" /></td>
                      </tr>
                      {terbuka && pakem && (
                        <tr className="mk-pakem" data-testid={`pakem-${s.id}`}>
                          <td colSpan={kolom.length + 2}>
                            {/* Kartu penjelasan channel: menempel di kiri area gulir (tidak melebar sepanjang tabel). */}
                            <div className="mk-pakem-isi" role="region" aria-label={`Tentang ${s.label}`}>
                              <div className="mk-pakem-kepala">
                                <LogoSumber id={s.id} size={28} />
                                <p className="mk-pakem-nama">Tentang {s.label}</p>
                                <button type="button" className="mk-pakem-tutup" aria-label="Tutup penjelasan" onClick={(e) => { e.stopPropagation(); setInfoId(null); }}><X size={15} aria-hidden="true" /></button>
                              </div>
                              <div className="mk-pakem-kisi">
                                <div className="mk-pakem-blok"><span className="mk-pakem-ikon" data-nada="biru" aria-hidden="true"><Info size={15} /></span><div><p className="mk-pakem-judul">Apa ini</p><p>{pakem.apa}</p></div></div>
                                <div className="mk-pakem-blok"><span className="mk-pakem-ikon" data-nada="hijau" aria-hidden="true"><ShieldCheck size={15} /></span><div><p className="mk-pakem-judul">Buktinya</p><p>{pakem.bukti}</p></div></div>
                                <div className="mk-pakem-blok"><span className="mk-pakem-ikon" data-nada="oranye" aria-hidden="true"><CircleSlash size={15} /></span><div><p className="mk-pakem-judul">Tidak termasuk</p><p>{pakem.bukan}</p></div></div>
                              </div>
                              <div className="mk-pakem-kaki">
                                <p className="mk-pakem-dasar">Dasar angka: {BUKTI_LABEL[s.buktiAtribusi?.jenis] || "Label CRM"}{s.tingkatBukti ? ` · tingkat bukti ${s.tingkatBukti.toLowerCase()}` : ""}</p>
                                {onLihatChat && s.lead > 0 && <button type="button" className="mk-kapsul mk-kapsul--kecil mk-kapsul--aktif" data-testid={`lihat-chat-${s.id}`} onClick={(e) => { e.stopPropagation(); onLihatChat({ judul: s.label, sub: `${angka(s.lead)} chat`, query: { sumber: s.id } }); }}><MessageSquare size={14} /> Lihat {angka(s.lead)} chat</button>}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </React.Fragment>
            ))}
            {!tersaring && (
              <tr className="mk-total" data-testid="baris-total">
                <th scope="row" className="mk-kiri">Total semua sumber</th>
                {kolom.map((k) => <Sel key={k.id} id={k.id} c={selTotal(lap, k.id)} />)}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mk-catatan">Tanda — berarti tidak tersedia atau belum lengkap, bukan nol. Biaya, CPA, dan ROAS pada baris total hanya untuk sumber berbayar dan hanya bila semuanya lengkap (dihitung dari pembilang dan penyebut total). Dasar: {DASAR_BIAYA_LABEL}. Konversi total = Σ ber-order ÷ Σ lead. Total lead (termasuk spam) = New Leads di Dashboard Sales CRM; lead tanpa spam = total lead − spam = dasar Conversion Dashboard.{tersaring ? " Baris total disembunyikan saat tabel disaring." : ""}</p>
    </section>
  );
}
