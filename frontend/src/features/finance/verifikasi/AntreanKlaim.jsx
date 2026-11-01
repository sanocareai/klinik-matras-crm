import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, FileText, Search, X } from "lucide-react";
import { api } from "@/api.js";
import { formatUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { cocok, normalisasiCari } from "@/features/finance/saringPembayaran.js";
import { RowActions } from "@/features/finance/RowActions.jsx";
import { Pilih } from "@/features/finance/pemasukan/DaftarPemasukan.jsx";
import { ModalVerifikasi } from "@/features/finance/LunasBelumDicatat.jsx";
import { ModalAlasan, ModalVerifikasiKlaim } from "@/features/finance/KlaimLunasSales.jsx";
import KlaimLunasResi from "@/features/finance/KlaimLunasResi.jsx";
import { pesanGalatKlaim } from "@/features/finance/pesanGalatKlaim.js";
import { STATUS_KLAIM_LABEL } from "@/features/klaim/klaimLunasLogic.js";
import { LABEL_CARA_BAYAR, buatPenjaga } from "./verifikasiLogic.js";
import { modelKlaim, modelKlaimLama } from "./modelPemeriksaan.jsx";

// ANTREAN "DITANDAI LUNAS OLEH SALES" — tiga sumber server yang BERBEDA, ditata sama tetapi tidak digabung:
//   • Klaim pembayaran : pengajuan Sales dengan tanggal, nominal, metode, catatan, dan bukti (bukti bisa belum ada) (GET /finance/penerimaan/klaim-lunas).
//   • Resi             : satu klaim per Resi (hanya bila fitur pembayaran Resi aktif; komponen lama dipakai apa adanya).
//   • Order ditandai lunas tanpa catatan pembayaran ("klaim lama"; GET /finance/penerimaan/lunas-belum-dicatat).
// Tindakan, validasi, kunci idempoten, dan pesan galat = komponen/API LAMA (ModalVerifikasi*, ModalAlasan, api.*). Di sini hanya penataan.
// Pencarian & filter Sales/Jenis hanya menyaring daftar "klaim lama" (sama dengan sebelumnya) dan id yang tampil dilaporkan ke Export Excel lewat onTampil.

const kosong = (v) => v === null || v === undefined || v === "";
const iso = (x) => (x ? String(x).slice(0, 10) : null);

function BuktiMini({ b }) {
  const pdf = b.mime === "application/pdf";
  return (
    <a href={b.url} target="_blank" rel="noreferrer" title={b.nama} className="fin-vf-mini-bukti" aria-label={`Buka bukti ${b.nama || ""} di tab baru`}>
      {pdf ? <FileText size={16} aria-hidden="true" /> : <img src={b.url} alt="" loading="lazy" className="fin-vf-mini-gambar" />}
    </a>
  );
}

function BuktiKlaim({ bukti, status, tanpa = "Belum ada bukti", onPeriksa }) {
  if (!bukti?.length) return <span className="fin-vf-tanpa-bukti" data-testid="bukti-kosong">{tanpa}</span>;
  return (
    <span className="fin-vf-bukti-sel" data-testid="bukti-klaim">
      {bukti.slice(0, 2).map((b) => <BuktiMini key={b.id ?? b.url} b={b} />)}
      {bukti.length > 2 && <button type="button" className="fin-vf-sisa-bukti" onClick={onPeriksa} aria-label={`${bukti.length - 2} bukti lainnya, periksa`}>+{bukti.length - 2}</button>}
    </span>
  );
}

function PanelKosong({ judul, pesan }) {
  return (
    <div className="fin-vf-kosong" role="status">
      <CheckCircle2 size={22} aria-hidden="true" />
      <p className="fin-vf-kosong-judul">{judul}</p>
      <p>{pesan}</p>
    </div>
  );
}

export default function AntreanKlaim({ ringkas = false, onTampil, onBerubah, onData, onPeriksa, versiMuat = 0 }) {
  const [berbukti, setBerbukti] = useState(null);
  const [lama, setLama] = useState(null);
  const [rekening, setRekening] = useState([]);
  const [galatBerbukti, setGalatBerbukti] = useState(null);
  const [galatLama, setGalatLama] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [modal, setModal] = useState(null); // { jenis: "verifikasi"|"minta"|"tolak", klaim } | { jenis: "lama", item } | { jenis: "massal" }
  const [q, setQ] = useState("");
  const [fSales, setFSales] = useState("");
  const [fKelompok, setFKelompok] = useState("");
  const [pilih, setPilih] = useState(() => new Set());
  const [bukaPenjelasan, setBukaPenjelasan] = useState(false);
  const penjaga = useRef(buatPenjaga());
  const idPenjelasan = useId();

  const muat = useCallback(async () => {
    const saya = penjaga.current.mulai();
    const [b, l, r] = await Promise.allSettled([api.getKlaimLunasAntrean(), api.getFinanceLunasBelumDicatat(), api.getFinanceCashAccounts()]);
    if (!penjaga.current.terbaru(saya)) return;
    if (b.status === "fulfilled") { setBerbukti(b.value); setGalatBerbukti(null); } else setGalatBerbukti(b.reason?.message || "Gagal memuat klaim berbukti");
    if (l.status === "fulfilled") { setLama(l.value); setGalatLama(null); } else setGalatLama(l.reason?.message || "Gagal memuat daftar");
    setRekening(r.status === "fulfilled" ? (r.value?.accounts || []).filter((a) => a.active) : []);
  }, []);
  useEffect(() => { muat(); }, [muat, versiMuat]);

  const selesai = async () => { await muat(); onBerubah?.(); };

  // Jalankan aksi lama (prompt/API) lalu muat ulang. Galat → pesan di atas daftar; tidak pernah menelan diam-diam.
  async function aksiLama(fn) {
    try { await fn(); setModal(null); setPilih(new Set()); await selesai(); } catch (e) { setPesan(e.message); }
  }
  // Mengembalikan true bila berhasil; dialog memakainya untuk melepas status "sibuk" saat gagal.
  async function jalankanKlaim(fn) {
    setPesan(null);
    try { await fn(); } catch (e) { setPesan(pesanGalatKlaim(e)); return false; }
    setModal(null);
    try { await selesai(); } catch { /* dimuat ulang oleh muat() */ }
    return true;
  }

  const itemsBerbukti = berbukti?.items ?? [];
  const items = lama?.items ?? [];
  const opsiSales = useMemo(() => [...new Set(items.map((i) => i.salesName).filter(Boolean))].sort().map((s) => [s, s]), [items]);
  const tampil = useMemo(() => items.filter((i) => {
    if (fSales && i.salesName !== fSales) return false;
    if (fKelompok && i.kelompok !== fKelompok) return false;
    return cocok(normalisasiCari(q), i.orderNumber, i.customerName, i.salesName, i.sisa, i.nilaiOrder);
  }), [items, q, fSales, fKelompok]);

  useEffect(() => { if (lama) onTampil?.(tampil.map((i) => i.orderId)); }, [lama, tampil]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onTampil?.(null), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (berbukti) onData?.({ menunggu: berbukti.menunggu?.jumlah ?? 0, diminta: berbukti.dimintaBukti?.jumlah ?? 0 });
  }, [berbukti]); // eslint-disable-line react-hooks/exhaustive-deps

  // Identitas objek `modal` untuk ModalVerifikasi harus STABIL: komponen itu mengisi ulang formulirnya setiap `modal` berganti.
  const modalLama = useMemo(() => (modal && (modal.jenis === "lama" || modal.jenis === "massal") ? { item: modal.item, massal: modal.jenis === "massal" } : null), [modal]);
  const semuaTerpilih = tampil.length > 0 && tampil.every((i) => pilih.has(i.orderId));
  const terpilih = items.filter((i) => pilih.has(i.orderId));
  const totalTerpilih = terpilih.reduce((s, i) => s + i.sisa, 0);
  const toggle = (id) => setPilih((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const tgl = lama ? tanggalPendek(lama.cutoff) : "";
  const adaFilter = !!q || !!fSales || !!fKelompok;
  const resiItems = Array.isArray(lama?.resi) ? lama.resi : null;

  // ── Tindakan per baris (RowActions menjaga klik ganda selama proses) ──
  const minta = (i) => {
    const catatan = window.prompt("Minta bukti pembayaran untuk " + i.orderNumber + ". Catatan untuk Sales (boleh dikosongkan):", "Mohon kirim bukti transfer/pembayaran");
    if (catatan !== null) return aksiLama(() => api.mintaBuktiPenerimaan(i.orderId, catatan.trim()));
  };
  const tolak = (i) => {
    const alasan = window.prompt("Tolak klaim lunas " + i.orderNumber + ". Alasan (uangnya belum masuk)? Status order akan dikembalikan ke belum lunas:");
    if (alasan?.trim()) return aksiLama(() => api.tolakLunas(i.orderId, alasan.trim()));
  };
  const aksiKlaim = (k) => {
    const sub = k.status === "SUBMITTED";
    const buka = (jenis) => () => setModal({ jenis, klaim: k });
    return {
      primary: sub ? { label: "Verifikasi", variant: "secondary", onClick: buka("verifikasi") } : { label: "Periksa", variant: "neutral", onClick: () => onPeriksa(modelKlaim(k, { aksi: panelAksiKlaim(k) })) },
      items: [
        sub && { key: "periksa", label: "Periksa bukti dan rincian", onClick: () => onPeriksa(modelKlaim(k, { aksi: panelAksiKlaim(k) })) },
        sub && { key: "minta", label: "Minta bukti tambahan", onClick: buka("minta") },
        { key: "tolak", label: "Tolak klaim", destructive: true, onClick: buka("tolak") },
      ].filter(Boolean),
    };
  };
  function panelAksiKlaim(k) {
    const sub = k.status === "SUBMITTED";
    // Panel ditutup oleh pemanggil sebelum dialog tindakan dibuka (dua lapisan modal sekaligus membingungkan fokus).
    return [
      sub && { key: "verifikasi", label: "Verifikasi klaim", utama: true, onClick: () => { onPeriksa(null); setModal({ jenis: "verifikasi", klaim: k }); } },
      sub && { key: "minta", label: "Minta bukti", onClick: () => { onPeriksa(null); setModal({ jenis: "minta", klaim: k }); } },
      { key: "tolak", label: "Tolak klaim", onClick: () => { onPeriksa(null); setModal({ jenis: "tolak", klaim: k }); } },
    ].filter(Boolean);
  }
  function panelAksiLama(i) {
    return [
      { key: "verifikasi", label: "Verifikasi pembayaran", utama: true, onClick: () => { onPeriksa(null); setModal({ jenis: "lama", item: i }); } },
      { key: "minta", label: "Minta bukti", onClick: () => { onPeriksa(null); return minta(i); } },
      { key: "tolak", label: "Tolak klaim", onClick: () => { onPeriksa(null); return tolak(i); } },
    ];
  }
  const periksaLama = (i) => onPeriksa(modelKlaimLama(i, { aksi: panelAksiLama(i), tgl }));
  const aksiLamaBaris = (i) => ({
    primary: { label: "Verifikasi", variant: "secondary", onClick: () => setModal({ jenis: "lama", item: i }) },
    items: [
      { key: "periksa", label: "Periksa rincian", onClick: () => periksaLama(i) },
      { key: "minta", label: "Minta bukti", onClick: () => minta(i) },
      { key: "tolak", label: "Tolak klaim", destructive: true, onClick: () => tolak(i) },
    ],
  });

  const bukaBaris = (e, fn) => {
    if (e.target.closest("button, a, input, select, label, summary")) return;
    if (typeof window !== "undefined" && String(window.getSelection?.() ?? "").length > 0) return;
    fn();
  };
  const tombol = (e, fn) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); fn(); } };

  return (
    <div className="fin-vf-klaim" data-testid="antrean-klaim">
      {pesan && !modal && (
        <p className="fin-pm-pesan fin-pm-pesan-galat" role="alert">{pesan} <button type="button" className="fin-pm-reset" onClick={() => setPesan(null)}>Tutup</button></p>
      )}

      {/* ── Klaim pembayaran dari Sales ── */}
      <section className="fin-panel fin-pm-daftar" aria-label="Klaim pembayaran dari Sales" data-testid="klaim-lunas-berbukti" aria-busy={!berbukti && !galatBerbukti}>
        <div className="fin-panel-kepala">
          <h2 className="fin-panel-judul">Klaim pembayaran dari Sales</h2>
          <p className="fin-panel-sub">
            {berbukti && itemsBerbukti.length
              ? `${berbukti.menunggu.jumlah} menunggu verifikasi · ${formatUang(berbukti.menunggu.total)}${berbukti.dimintaBukti.jumlah ? ` · ${berbukti.dimintaBukti.jumlah} menunggu bukti tambahan dari Sales` : ""}`
              : "Pengajuan Sales dengan tanggal, nominal, metode, dan catatan; bukti bisa sudah atau belum dilampirkan. Mengajukan klaim belum mengubah status order atau saldo."}
          </p>
        </div>
        {galatBerbukti && <p className="fin-galat fin-pm-galat" role="alert">Gagal memuat: {galatBerbukti} <button type="button" className="fin-pm-reset" onClick={muat}>Coba lagi</button></p>}
        {!berbukti && !galatBerbukti && <p className="fin-pm-kosong">Memuat klaim…</p>}
        {berbukti && itemsBerbukti.length === 0 && <PanelKosong judul="Tidak ada klaim baru" pesan="Semua klaim pembayaran dari Sales sudah diproses." />}
        {itemsBerbukti.length > 0 && (
          <>
            <div className="fin-pm-tabel-bungkus fin-pm-gulir" tabIndex={0} role="region" aria-label="Tabel klaim pembayaran dari Sales; gulir mendatar bila perlu">
              <table className="fin-pm-tabel fin-vf-tabel" data-jenis="klaim-berbukti">
                <thead><tr>
                  <th scope="col">Pelanggan / Order</th><th scope="col">Tanggal bayar</th><th scope="col" className="fin-pm-kanan">Nominal klaim</th>
                  <th scope="col">Rekening tujuan</th><th scope="col">Bukti</th><th scope="col">Status</th><th scope="col">Tindakan</th>
                </tr></thead>
                <tbody>
                  {itemsBerbukti.map((k) => {
                    const a = aksiKlaim(k);
                    const periksa = () => onPeriksa(modelKlaim(k, { aksi: panelAksiKlaim(k) }));
                    return (
                      <tr key={k.id} className="fin-pm-baris" tabIndex={0} data-testid="baris-klaim" data-status={k.status} onClick={(e) => bukaBaris(e, periksa)} onKeyDown={(e) => tombol(e, periksa)}>
                        <td><div className="fin-pm-pihak">
                          <span className="fin-pm-nama">{k.order.customerName}</span>
                          <span className="fin-pm-nomor">{k.order.orderNumber || "—"}{k.resi && <span className="fin-chip fin-chip-neutral fin-vf-gap">Resi · {k.resiInfo?.anak.length ?? "?"} order</span>}</span>
                          <span className="fin-vf-meta">Diajukan {k.createdByName || "Sales"}</span>
                          {k.note && <span className="fin-vf-meta fin-vf-catatan-klaim" title={k.note}>{k.note}</span>}
                        </div></td>
                        <td><span className="fin-pm-tgl">{k.paymentDate ? tanggalPendek(k.paymentDate) : "—"}</span></td>
                        <td className="fin-pm-kanan"><span className="fin-pm-nilai-sel"><span className="fin-pm-rp">{formatUang(k.amount)}</span><span className="fin-pm-rp-sub">sisa tagihan {formatUang(k.order.sisa)}</span></span></td>
                        <td>{k.cashAccount?.name
                          ? <div className="fin-vf-rek-kosong"><span className="fin-pm-nama">{k.cashAccount.name}</span><span className="fin-pm-rek-ket">{LABEL_CARA_BAYAR[k.method] || k.method || "—"} · diisi Sales</span></div>
                          : <div className="fin-vf-rek-kosong"><span className="fin-pm-nama">Belum dipilih</span><span className="fin-pm-rek-ket">{LABEL_CARA_BAYAR[k.method] || k.method || "—"}</span></div>}</td>
                        <td><BuktiKlaim bukti={k.bukti} onPeriksa={periksa} /></td>
                        <td><div className="fin-pm-status">
                          <span className={`fin-chip fin-chip-${k.status === "SUBMITTED" ? "orange" : "neutral"}`}>{STATUS_KLAIM_LABEL[k.status] || k.status}</span>
                          {k.reviewReason && <span className="fin-pm-subcatatan">{k.reviewReason}</span>}
                          {(k.peringatan ?? []).map((p) => <span key={p.kode} className="fin-vf-peringatan">{p.pesan}</span>)}
                        </div></td>
                        <td className="fin-pm-aksi"><RowActions primary={a.primary} items={a.items} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="fin-pm-kartu-daftar" aria-label="Klaim pembayaran dari Sales (tampilan kartu)">
              {itemsBerbukti.map((k) => {
                const a = aksiKlaim(k);
                return (
                  <li key={k.id} className="fin-pm-kartu fin-vf-kartu fin-vf-kartu-klik" data-testid="kartu-klaim" data-status={k.status} onClick={(e) => bukaBaris(e, () => onPeriksa(modelKlaim(k, { aksi: panelAksiKlaim(k) })))}>
                    <div className="fin-pm-kartu-atas">
                      <span className="fin-pm-tgl">{k.paymentDate ? tanggalPendek(k.paymentDate) : "—"}</span>
                      <span className="fin-pm-nilai-sel"><span className="fin-pm-rp">{formatUang(k.amount)}</span><span className="fin-pm-rp-sub">sisa tagihan {formatUang(k.order.sisa)}</span></span>
                    </div>
                    <div className="fin-pm-pihak"><span className="fin-pm-nama">{k.order.customerName}</span><span className="fin-pm-nomor">{k.order.orderNumber || "—"} · {k.createdByName || "Sales"}</span></div>
                    <dl className="fin-pm-kartu-isi">
                      <div><dt>Status</dt><dd><span className={`fin-chip fin-chip-${k.status === "SUBMITTED" ? "orange" : "neutral"}`}>{STATUS_KLAIM_LABEL[k.status] || k.status}</span></dd></div>
                      <div><dt>Rekening tujuan</dt><dd>{k.cashAccount?.name ? `${k.cashAccount.name} (diisi Sales)` : "Belum dipilih"} · {LABEL_CARA_BAYAR[k.method] || k.method || "—"}</dd></div>
                      <div><dt>Bukti</dt><dd><BuktiKlaim bukti={k.bukti} onPeriksa={() => onPeriksa(modelKlaim(k, { aksi: panelAksiKlaim(k) }))} /></dd></div>
                    </dl>
                    {k.note && <p className="fin-vf-meta">{k.note}</p>}
                    {(k.peringatan ?? []).map((p) => <p key={p.kode} className="fin-vf-peringatan">{p.pesan}</p>)}
                    <div className="fin-vf-kartu-aksi"><RowActions primary={a.primary} items={a.items} /></div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      {resiItems && <KlaimLunasResi items={resiItems} ringkas={ringkas} rekening={rekening} onBerubah={selesai} />}

      {/* ── Order ditandai lunas, belum ada catatan pembayaran ── */}
      <section className="fin-panel fin-pm-daftar" aria-label="Order ditandai lunas tanpa catatan pembayaran" data-testid="klaim-lama" aria-busy={!lama && !galatLama}>
        <div className="fin-panel-kepala">
          <h2 className="fin-panel-judul">Order ditandai lunas, belum ada catatan pembayaran</h2>
          <p className="fin-panel-sub">
            {lama ? `${lama.semua.jumlah} order · ${formatUang(lama.semua.total)} · semua periode. Yang paling baru ditandai ada di atas.` : "Memuat…"}
          </p>
        </div>
        {!ringkas && (
          <>
            <button type="button" className="fin-pm-pembuka fin-pm-pembuka-lunak" aria-expanded={bukaPenjelasan} aria-controls={idPenjelasan} onClick={() => setBukaPenjelasan((v) => !v)}>
              Bagaimana memeriksanya? {bukaPenjelasan ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
            {bukaPenjelasan && (
              <p id={idPenjelasan} className="fin-pm-lanjut-isi fin-vf-penjelasan">
                Order di bawah ditandai Lunas oleh Sales di CRM, tetapi belum ada catatan uang masuknya, jadi belum ada pembayaran yang bisa diverifikasi. Cek uangnya benar-benar masuk,
                lalu pilih <strong>Verifikasi</strong> (pilih rekening dan lampirkan foto bukti). Belum ada bukti? Pilih <strong>Minta bukti</strong>. Uangnya ternyata belum masuk?
                Pilih <strong>Tolak klaim</strong> — status order dikembalikan.
              </p>
            )}
          </>
        )}
        {lama && (
          <dl className="fin-pm-stat" data-testid="angka-klaim-lama">
            <div><dt>Perlu dicek <span className="fin-redup">· ditandai sejak {tgl}</span></dt><dd><strong>{lama.baru.jumlah}</strong> <span className="fin-redup">order · {formatUang(lama.baru.total)}</span></dd></div>
            <div><dt>Lunas sebelum {tgl}</dt><dd><strong>{lama.lama.jumlah}</strong> <span className="fin-redup">order · {formatUang(lama.lama.total)}. Uangnya sudah termasuk saldo bank awal; cukup ditandai selesai.</span></dd></div>
          </dl>
        )}

        <div className="fin-pm-toolbar" role="search">
          <label className="fin-pm-cari">
            <Search size={16} aria-hidden="true" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari order, pelanggan, sales, nominal…" aria-label="Cari order, pelanggan, sales, atau nominal" autoComplete="off" enterKeyHint="search" />
            {q && <button type="button" className="fin-pm-hapus" onClick={() => setQ("")} aria-label="Hapus pencarian"><X size={14} aria-hidden="true" /></button>}
          </label>
          <span className="fin-vf-cakupan" title="Antrean pekerjaan: tidak terikat periode.">Semua periode</span>
          <div className="fin-pm-filter">
            <Pilih label="Jenis" value={fKelompok} onChange={setFKelompok} options={[["BARU", `Perlu dicek (sejak ${tgl})`], ["LAMA", `Lunas sebelum ${tgl}`]]} />
            <Pilih label="Sales" value={fSales} onChange={setFSales} options={opsiSales} />
          </div>
        </div>
        <div className="fin-pm-hasil">
          <span data-testid="hasil-klaim-lama">{lama ? (adaFilter ? <><strong>{tampil.length}</strong> dari {items.length} order</> : <><strong>{items.length}</strong> order</>) : "Memuat…"}</span>
          {adaFilter && <button type="button" className="fin-pm-reset" onClick={() => { setQ(""); setFSales(""); setFKelompok(""); }}>Atur ulang filter</button>}
        </div>
        {galatLama && <p className="fin-galat fin-pm-galat" role="alert">Gagal memuat: {galatLama} <button type="button" className="fin-pm-reset" onClick={muat}>Coba lagi</button></p>}

        {pilih.size > 0 && (
          <div className="fin-vf-massal" role="region" aria-label="Verifikasi massal" data-testid="bar-massal">
            <p><strong>{pilih.size}</strong> order dipilih · {formatUang(totalTerpilih)}</p>
            <div className="fin-vf-massal-aksi">
              <button type="button" className="fin-pm-reset" onClick={() => setPilih(new Set())}>Batal pilih</button>
              <button type="button" className="fin-vf-btn fin-vf-btn-utama" onClick={() => setModal({ jenis: "massal" })}>Verifikasi yang dipilih</button>
            </div>
          </div>
        )}

        {lama && tampil.length === 0 && (
          <PanelKosong
            judul={adaFilter ? "Tidak ada yang cocok" : "Tidak ada order yang menunggu"}
            pesan={adaFilter ? "Ubah pencarian atau filter." : "Semua order yang ditandai lunas oleh Sales sudah dicek uang masuknya."}
          />
        )}
        {tampil.length > 0 && (
          <>
            <div className="fin-pm-tabel-bungkus fin-pm-gulir" tabIndex={0} role="region" aria-label="Tabel order ditandai lunas; gulir mendatar bila perlu">
              <table className="fin-pm-tabel fin-vf-tabel" data-jenis="klaim-lama">
                <thead><tr>
                  <th scope="col" className="fin-vf-kolom-cek"><input type="checkbox" checked={semuaTerpilih} aria-label="Pilih semua" onChange={() => setPilih(semuaTerpilih ? new Set() : new Set(tampil.map((i) => i.orderId)))} /></th>
                  <th scope="col">Pelanggan / Order</th><th scope="col">Ditandai lunas</th><th scope="col" className="fin-pm-kanan">Perlu dicek</th>
                  <th scope="col">Rekening tujuan</th><th scope="col">Bukti</th><th scope="col">Status</th><th scope="col">Tindakan</th>
                </tr></thead>
                <tbody>
                  {tampil.map((i) => {
                    const a = aksiLamaBaris(i);
                    return (
                      <tr key={i.orderId} className="fin-pm-baris" tabIndex={0} data-testid="baris-lama" data-kelompok={i.kelompok} data-terpilih={pilih.has(i.orderId) ? "1" : "0"} onClick={(e) => bukaBaris(e, () => periksaLama(i))} onKeyDown={(e) => tombol(e, () => periksaLama(i))}>
                        <td className="fin-vf-kolom-cek"><input type="checkbox" checked={pilih.has(i.orderId)} onChange={() => toggle(i.orderId)} aria-label={`Pilih ${i.orderNumber}`} /></td>
                        <td><div className="fin-pm-pihak"><span className="fin-pm-nama">{i.customerName}</span><span className="fin-pm-nomor">{i.orderNumber || "—"}</span><span className="fin-vf-meta">{i.salesName || "Sales —"}</span></div></td>
                        <td><span className="fin-pm-tgl">{i.lunasSejak ? tanggalPendek(i.lunasSejak) : "Tanggal tidak diketahui"}</span></td>
                        <td className="fin-pm-kanan"><span className="fin-pm-nilai-sel"><span className="fin-pm-rp">{formatUang(i.sisa)}</span><span className="fin-pm-rp-sub">nilai order {formatUang(i.nilaiOrder)}</span></span></td>
                        <td><div className="fin-vf-rek-kosong"><span className="fin-pm-nama">Belum ada</span><span className="fin-pm-rek-ket">Belum ada catatan pembayaran</span></div></td>
                        <td><span className="fin-vf-tanpa-bukti" data-testid="bukti-belum-lengkap">Bukti belum lengkap</span></td>
                        <td><div className="fin-pm-status">
                          <span className={`fin-chip fin-chip-${i.kelompok === "BARU" ? "orange" : "neutral"}`}>{i.kelompok === "BARU" ? "Perlu dicek" : `Sebelum ${tgl}`}</span>
                          {i.buktiDiminta && <span className="fin-chip fin-chip-neutral" data-testid="bukti-diminta" title={i.buktiDiminta.catatan || undefined}>Bukti diminta {tanggalPendek(String(i.buktiDiminta.pada).slice(0, 10))}</span>}
                        </div></td>
                        <td className="fin-pm-aksi"><RowActions primary={a.primary} items={a.items} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="fin-pm-kartu-daftar" aria-label="Order ditandai lunas (tampilan kartu)">
              {tampil.map((i) => {
                const a = aksiLamaBaris(i);
                return (
                  <li key={i.orderId} className="fin-pm-kartu fin-vf-kartu fin-vf-kartu-klik" data-testid="kartu-lama" data-kelompok={i.kelompok} onClick={(e) => bukaBaris(e, () => periksaLama(i))}>
                    <div className="fin-pm-kartu-atas">
                      <label className="fin-vf-cek-kartu"><input type="checkbox" checked={pilih.has(i.orderId)} onChange={() => toggle(i.orderId)} aria-label={`Pilih ${i.orderNumber}`} /><span className="fin-pm-tgl">{i.lunasSejak ? tanggalPendek(i.lunasSejak) : "Tanggal tidak diketahui"}</span></label>
                      <span className="fin-pm-nilai-sel"><span className="fin-pm-rp">{formatUang(i.sisa)}</span><span className="fin-pm-rp-sub">nilai order {formatUang(i.nilaiOrder)}</span></span>
                    </div>
                    <div className="fin-pm-pihak"><span className="fin-pm-nama">{i.customerName}</span><span className="fin-pm-nomor">{i.orderNumber || "—"} · {i.salesName || "Sales —"}</span></div>
                    <dl className="fin-pm-kartu-isi">
                      <div><dt>Status</dt><dd><div className="fin-pm-status"><span className={`fin-chip fin-chip-${i.kelompok === "BARU" ? "orange" : "neutral"}`}>{i.kelompok === "BARU" ? "Perlu dicek" : `Sebelum ${tgl}`}</span>{i.buktiDiminta && <span className="fin-chip fin-chip-neutral">Bukti diminta {tanggalPendek(String(i.buktiDiminta.pada).slice(0, 10))}</span>}</div></dd></div>
                      <div><dt>Rekening tujuan</dt><dd>Belum ada catatan pembayaran</dd></div>
                      <div><dt>Bukti</dt><dd><span className="fin-vf-tanpa-bukti">Bukti belum lengkap</span></dd></div>
                    </dl>
                    <div className="fin-vf-kartu-aksi"><RowActions primary={a.primary} items={a.items} /></div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

      <ModalAlasan
        modal={modal && (modal.jenis === "minta" || modal.jenis === "tolak") ? modal : null} onClose={() => { setPesan(null); setModal(null); }} galat={pesan}
        onKirim={(alasan) => jalankanKlaim(() => (modal.jenis === "minta"
          ? api.mintaBuktiKlaimLunas(modal.klaim.id, { alasan, versi: modal.klaim.version })
          : api.tolakKlaimLunas(modal.klaim.id, { alasan, versi: modal.klaim.version })))}
      />
      <ModalVerifikasiKlaim
        modal={modal?.jenis === "verifikasi" ? modal : null} rekening={rekening} onClose={() => { setPesan(null); setModal(null); }} galat={pesan}
        onKirim={(body) => jalankanKlaim(() => api.verifikasiKlaimLunas(modal.klaim.id, { ...body, versi: modal.klaim.version }))}
      />
      <ModalVerifikasi
        modal={modalLama}
        onClose={() => setModal(null)} rekening={rekening} terpilih={terpilih} tgl={tgl} cutoff={lama?.cutoff}
        onSubmit={(payload) => aksiLama(() => (modal.jenis === "massal"
          ? api.verifikasiPenerimaanMassal({ ...payload, orderIds: terpilih.map((i) => i.orderId) }).then((r) => {
              if (r.gagal > 0) throw new Error(`${r.berhasil} berhasil, ${r.gagal} gagal: ${r.hasil.filter((h) => !h.ok).map((h) => h.error).slice(0, 2).join("; ")}`);
            })
          : api.verifikasiPenerimaan({ ...payload, orderId: modal.item.orderId })))}
      />
    </div>
  );
}
