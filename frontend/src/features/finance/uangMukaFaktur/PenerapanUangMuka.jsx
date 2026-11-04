import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Info, RefreshCw, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Input } from "@/components/ui/input.jsx";
import { cn } from "@/lib/utils.js";
import { api } from "@/api.js";
import { TombolAksi, InputUang, tanggalPendek } from "@/features/finance/shared.jsx";
import { Galat } from "@/features/finance/tagihan/DialogTagihan.jsx";
import { formatUangTepat, penjagaPermintaan } from "@/features/finance/tagihan/tagihanLogika.js";
import {
  ringkasKelayakan, teksPeringatanUangMuka, pilihanAwal, maksimalPenerapan, pratinjauPenerapan, perluKonfirmasiPasangan,
  kesiapanPenerapan, bodyPenerapan, KODE_PERLU_MUAT_ULANG,
} from "./kelayakanLogika.js";

// SATU komponen penerapan uang muka ke faktur supplier, dipakai dari Tagihan supplier, rincian PO, tawaran setelah persetujuan, dan form pembayaran.
// Tidak ada jalur transaksi kedua: pratinjau dari GET .../uang-muka/faktur/:billId/kandidat, konfirmasi lewat POST .../uang-muka/terapkan (Idempotency-Key,
// sisaFakturDilihat, kunci baris & jurnal di server). Layar ini tidak menulis jurnal sendiri dan tidak menerapkan apa pun otomatis.

const idKunci = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const KETERANGAN_IZIN = "Akun Anda tidak punya izin menerapkan uang muka (Finance/Akuntan).";

// ── Pemeriksaan kelayakan (kontrak server) ────────────────────────────────────────────────────────────────────────────
/**
 * Memeriksa kelayakan uang muka untuk beberapa faktur lewat kontrak kandidat server (satu panggilan per faktur, paling banyak empat bersamaan).
 * `peta`: billId → ringkasKelayakan + `data` mentah. `galat`: billId → pesan. Berubahnya daftar `ids` (termasuk sisa yang dimasukkan ke kuncinya) memuat ulang.
 */
export function useKelayakanFaktur(ids, { aktif = true } = {}) {
  const kunci = (ids || []).join("|");
  const [peta, setPeta] = useState(() => new Map());
  const [galat, setGalat] = useState({});
  const [memuat, setMemuat] = useState(false);
  const [versi, setVersi] = useState(0);
  const penjaga = useRef(penjagaPermintaan());
  // Cache per "faktur:sisa" — sisa berubah (penerapan/pembayaran) → kunci berubah → diperiksa ulang; daftar yang menyempit/melebar tidak memuat ulang yang sudah diketahui.
  const cache = useRef(new Map());
  useEffect(() => {
    const daftar = kunci ? kunci.split("|") : [];
    if (!aktif || daftar.length === 0) { setPeta(new Map()); setGalat({}); setMemuat(false); return undefined; }
    const token = penjaga.current.mulai();
    const gagal = {};
    const susun = () => new Map(daftar.filter((k) => cache.current.has(k)).map((k) => [k.split(":")[0], cache.current.get(k)]));
    const perlu = daftar.filter((k) => !cache.current.has(k));
    setPeta(susun());
    if (perlu.length === 0) { setGalat({}); setMemuat(false); return undefined; }
    setMemuat(true);
    let i = 0;
    const kerja = async () => {
      while (i < perlu.length) {
        const k = perlu[i++];
        const id = k.split(":")[0];
        try {
          const d = await api.getKandidatUangMukaFaktur(id);
          if (!penjaga.current.sahkan(token)) return;
          cache.current.set(k, { ...ringkasKelayakan(d), data: d });
        } catch (e) {
          if (!penjaga.current.sahkan(token)) return;
          gagal[id] = e?.message || "Gagal memeriksa uang muka";
        }
      }
    };
    Promise.all([kerja(), kerja(), kerja(), kerja()]).then(() => {
      if (!penjaga.current.sahkan(token)) return;
      setPeta(susun()); setGalat(gagal); setMemuat(false);
    });
    return () => penjaga.current.batalkan();
  }, [kunci, aktif, versi]);
  const muatUlang = useCallback(() => { cache.current.clear(); setVersi((n) => n + 1); }, []);
  return { peta, galat, memuat, muatUlang };
}

/** Peringatan satu faktur: hanya bila server menyatakan ada uang muka yang tertaut ke PO faktur ini. Gagal memuat → dijelaskan + Coba lagi. */
export function BannerUangMuka({ r, galat, onCoba, onTerapkan, bolehPost = true, kompak = false }) {
  if (galat) {
    return (
      <div role="alert" data-testid="galat-periksa-uang-muka" className="flex flex-wrap items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px] text-ink2">
        <Info size={14} className="shrink-0 text-ink3" aria-hidden="true" />
        <span className="min-w-0 flex-1">Uang muka untuk faktur ini belum bisa diperiksa ({galat}). Periksa manual sebelum mencatat pembayaran.</span>
        <Button size="sm" variant="neutral" onClick={onCoba} data-testid="coba-lagi-uang-muka" className="max-sm:min-h-11 max-sm:px-4"><RefreshCw size={12} aria-hidden="true" /> Coba lagi</Button>
      </div>
    );
  }
  if (!r?.ada) return null;
  return (
    <div role="status" data-testid="peringatan-uang-muka-faktur" className="flex flex-wrap items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="m-0 font-medium">{teksPeringatanUangMuka(r)}</p>
        {!kompak && <p className="m-0 mt-0.5 text-[12px]">Dokumen: {r.sesuai.map((d) => d.nomor).join(", ")}. Uang muka dibayar, faktur disetujui, dan penerapan adalah tiga langkah terpisah.</p>}
      </div>
      <Button size="sm" variant="neutral" onClick={onTerapkan} disabled={!bolehPost} title={bolehPost ? undefined : KETERANGAN_IZIN} data-testid="terapkan-uang-muka-peringatan" className="max-sm:min-h-11 max-sm:px-4">
        <Wallet size={13} aria-hidden="true" /> Terapkan uang muka
      </Button>
    </div>
  );
}

/** Pembungkus satu faktur (rincian tagihan / kartu faktur PO). `versi` berubah → periksa ulang. */
export function PeringatanUangMukaFaktur({ billId, aktif = true, versi = 0, bolehPost = true, onTerapkan, kompak = false }) {
  const { peta, galat, muatUlang } = useKelayakanFaktur(aktif && billId ? [`${billId}:${versi}`] : [], { aktif });
  return <BannerUangMuka r={peta.get(billId)} galat={galat[billId]} onCoba={muatUlang} onTerapkan={onTerapkan} bolehPost={bolehPost} kompak={kompak} />;
}

// ── Dialog penerapan ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function PenerapanUangMuka({ billId, nomorFaktur, onClose, onSaved, bolehPost = true }) {
  const [data, setData] = useState(null);
  const [galatMuat, setGalatMuat] = useState("");
  const [pilih, setPilih] = useState(null);
  const [nominal, setNominal] = useState("");
  const [catatan, setCatatan] = useState("");
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [konfirmasiPasangan, setKonfirmasiPasangan] = useState(false);
  const [lainTerbuka, setLainTerbuka] = useState(false);
  const [galat, setGalat] = useState("");
  const [perluMuat, setPerluMuat] = useState(false);
  const [info, setInfo] = useState("");
  const kunciRef = useRef({ isi: "", kunci: "" });
  const penjaga = useRef(penjagaPermintaan());
  const pilihRef = useRef(null);
  pilihRef.current = pilih;
  const tombolMuatRef = useRef(null);
  // Galat "data basi": tombol Muat ulang harus langsung terlihat (isi dialog bisa bergulir).
  useEffect(() => { if (perluMuat) tombolMuatRef.current?.scrollIntoView?.({ block: "nearest" }); }, [perluMuat]);

  const muat = useCallback(async ({ pertahankan = false } = {}) => {
    const token = penjaga.current.mulai();
    setGalatMuat("");
    try {
      const d = await api.getKandidatUangMukaFaktur(billId);
      if (!penjaga.current.sahkan(token)) return;
      setData(d);
      const dipilih = pertahankan ? d.uangMuka.find((x) => x.id === pilihRef.current) : null;
      if (dipilih) {
        const maks = maksimalPenerapan(dipilih, d.faktur.sisaUtang);
        setNominal((n) => (Number(n) > maks ? String(maks) : n));
        setInfo("Data dimuat ulang dari server. Periksa lagi pratinjau dan nominal sebelum mengonfirmasi.");
      } else {
        const awal = pilihanAwal(d);
        setPilih(awal.id); setNominal(awal.nominal);
        setLainTerbuka(!awal.id && d.uangMuka.length > 0);
        if (pertahankan) setInfo("Uang muka yang Anda pilih sudah berubah. Pilih ulang dari daftar terbaru.");
      }
      setKonfirmasi(false); setPerluMuat(false);
    } catch (e) {
      if (!penjaga.current.sahkan(token)) return;
      setGalatMuat(e?.message || "Gagal memuat uang muka");
    }
  }, [billId]);
  useEffect(() => { muat(); return () => penjaga.current.batalkan(); }, [muat]);

  const sesuai = useMemo(() => (data?.uangMuka || []).filter((d) => d.samaPO), [data]);
  const lain = useMemo(() => (data?.uangMuka || []).filter((d) => !d.samaPO), [data]);
  const dp = (data?.uangMuka || []).find((d) => d.id === pilih) || null;
  const sisa = data?.faktur.sisaUtang ?? 0;
  const maks = maksimalPenerapan(dp, sisa);
  const siap = kesiapanPenerapan({ uangMuka: dp, nominal, sisaFaktur: sisa, konfirmasi, konfirmasiPasangan });
  const lihat = dp && Number(nominal) > 0 ? pratinjauPenerapan({ sisaFaktur: sisa, uangMuka: dp, nominal }) : null;
  const kunciTerapkan = (body) => { const isi = JSON.stringify(body); if (kunciRef.current.isi !== isi) kunciRef.current = { isi, kunci: `umt-${idKunci()}` }; return kunciRef.current.kunci; };

  function ubahPilihan(d) {
    setPilih(d.id); setNominal(String(d.saran)); setKonfirmasi(false); setKonfirmasiPasangan(false); setInfo(""); setGalat("");
  }

  async function terapkan() {
    setGalat(""); setInfo("");
    const body = bodyPenerapan({ uangMuka: dp, billId, nominal, sisaFaktur: sisa, konfirmasiPasangan, catatan });
    try { await api.terapkanUangMukaFaktur(body, kunciTerapkan(body)); }
    catch (e) {
      setGalat(e?.message || "Gagal menerapkan uang muka. Isian Anda tetap ada; coba lagi.");
      setPerluMuat(KODE_PERLU_MUAT_ULANG.includes(e?.code));
      return;
    }
    // Penerapan sudah tersimpan di server. Gagalnya penyegaran halaman di belakang tidak boleh terbaca sebagai "gagal menerapkan".
    try { await onSaved?.(); } catch { /* halaman induk menampilkan galatnya sendiri */ }
  }

  const judul = `Terapkan uang muka · ${nomorFaktur || data?.faktur.nomor || ""}`.trim();
  return (
    <Modal
      open onOpenChange={(v) => !v && onClose()} title={judul} description="Mengurangi sisa tagihan faktur. Tidak ada uang keluar baru dari bank."
      className="fin-tg-modal fin-tg-dlg w-[620px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={
        <>
          <Button variant="neutral" onClick={onClose} className="max-sm:min-h-11 max-sm:px-4">Batal</Button>
          <TombolAksi disabled={!siap.siap || !bolehPost} title={bolehPost ? undefined : KETERANGAN_IZIN} data-testid="simpan-penerapan" onClick={terapkan}>
            <Wallet size={14} aria-hidden="true" /> Terapkan uang muka
          </TombolAksi>
        </>
      }
    >
      {!data && !galatMuat && <p className="m-0 text-[13px] text-ink3" role="status">Memuat uang muka…</p>}
      {galatMuat && (
        <div role="alert" data-testid="galat-muat-penerapan" className="flex flex-wrap items-center gap-2 rounded-lg bg-redbg px-3 py-2 text-[12.5px] text-red">
          <span className="min-w-0 flex-1">{galatMuat}</span>
          <Button size="sm" variant="neutral" onClick={() => muat()} data-testid="coba-lagi-penerapan" className="max-sm:min-h-11 max-sm:px-4"><RefreshCw size={12} aria-hidden="true" /> Coba lagi</Button>
        </div>
      )}
      {data && (
        <div className="space-y-3" data-testid="form-terapkan">
          <dl className="fin-tg-dlg-ringkas" data-testid="konteks-penerapan">
            <div><dt>Supplier</dt><dd>{data.faktur.supplier}</dd></div>
            <div><dt>PO faktur</dt><dd>{data.faktur.po || "Tanpa PO"}</dd></div>
            <div><dt>Faktur tujuan</dt><dd>{nomorFaktur || data.faktur.nomor}</dd></div>
            <div><dt>Nilai faktur</dt><dd>{formatUangTepat(data.faktur.nilai)}</dd></div>
            <div><dt>Sisa tagihan sekarang</dt><dd className="fin-tg-besar" data-testid="sisa-sekarang">{formatUangTepat(sisa)}</dd></div>
          </dl>

          {!data.faktur.bolehDiterapkan && <p className="fin-tg-info" data-nada="jingga" role="status">Faktur ini berstatus {data.faktur.status}; uang muka hanya bisa diterapkan ke faktur yang sudah disetujui dan belum lunas.</p>}

          {data.uangMuka.length === 0 ? (
            <p className="fin-tg-info" data-nada="jingga" role="status" data-testid="tanpa-uang-muka">Tidak ada uang muka yang belum diterapkan untuk supplier {data.faktur.supplier}.</p>
          ) : (
            <>
              <fieldset className="m-0 space-y-1.5 border-0 p-0">
                <legend className="mb-1 text-[12.5px] font-medium text-ink">Uang muka untuk PO ini</legend>
                {sesuai.length === 0 && <p className="m-0 text-[12.5px] text-ink3" data-testid="tanpa-uang-muka-po">Tidak ada uang muka yang tertaut ke PO faktur ini. Tidak ada yang dipilih otomatis.</p>}
                {sesuai.map((d) => <PilihanUangMuka key={d.id} d={d} pilih={pilih} onPilih={ubahPilihan} />)}
              </fieldset>
              {lain.length > 0 && (
                <div className="space-y-1.5">
                  <button type="button" className="text-[12.5px] font-semibold text-accent max-sm:min-h-11" aria-expanded={lainTerbuka} onClick={() => setLainTerbuka((v) => !v)} data-testid="buka-uang-muka-lain">
                    {lainTerbuka ? "Sembunyikan" : "Tampilkan"} uang muka lain milik supplier ini ({lain.length})
                  </button>
                  {lainTerbuka && (
                    <fieldset className="m-0 space-y-1.5 border-0 p-0" data-testid="uang-muka-lain">
                      <legend className="mb-1 text-[12px] text-orange">Tidak tertaut ke PO faktur ini. Pilih hanya bila Anda yakin pasangannya benar.</legend>
                      {lain.map((d) => <PilihanUangMuka key={d.id} d={d} pilih={pilih} onPilih={ubahPilihan} />)}
                    </fieldset>
                  )}
                </div>
              )}

              {dp && (
                <>
                  <Field label="Nominal diterapkan" required hint={`Maksimal ${formatUangTepat(maks)} (saldo uang muka atau sisa tagihan, mana yang lebih kecil)`}>
                    <InputUang value={nominal} onChange={(v) => { setNominal(v); setKonfirmasi(false); }} max={maks} step="0.01" aria-label="Nominal diterapkan" data-testid="nominal-penerapan" />
                  </Field>
                  <Field label="Catatan"><Input value={catatan} maxLength={300} onChange={(e) => setCatatan(e.target.value)} /></Field>
                </>
              )}

              {lihat && (
                <section className="rounded-lg border border-line p-3 text-[12.5px]" data-testid="pratinjau-penerapan" aria-label="Pratinjau penerapan">
                  <h4 className="m-0 mb-2 text-[11px] font-bold uppercase tracking-wide text-ink3">Pratinjau</h4>
                  <ul className="m-0 list-none space-y-1.5 p-0">
                    <li className="flex flex-wrap justify-between gap-x-3"><span className="text-ink3">Uang muka sumber</span><span className="font-mono text-ink">{dp.nomor}{dp.purchaseOrder ? ` · ${dp.purchaseOrder.nomor}` : " · tanpa PO"}</span></li>
                    <li className="flex flex-wrap justify-between gap-x-3"><span className="text-ink3">Diterapkan</span><strong className="tabular-nums text-ink" data-testid="pratinjau-jumlah">{formatUangTepat(Number(nominal))}</strong></li>
                    <li className="flex flex-wrap justify-between gap-x-3"><span className="text-ink3">Sisa tagihan</span><span className="tabular-nums text-ink" data-testid="pratinjau-sisa">{formatUangTepat(lihat.sisaSebelum)} → <strong>{formatUangTepat(lihat.sisaSesudah)}</strong></span></li>
                    <li className="flex flex-wrap justify-between gap-x-3"><span className="text-ink3">Uang muka tersedia</span><span className="tabular-nums text-ink" data-testid="pratinjau-saldo">{formatUangTepat(lihat.saldoSebelum)} → <strong>{formatUangTepat(lihat.saldoSesudah)}</strong></span></li>
                    <li className="flex flex-wrap justify-between gap-x-3"><span className="text-ink3">Uang keluar baru dari bank</span><strong className="tabular-nums text-ink">Rp0</strong></li>
                  </ul>
                  <p className="m-0 mt-2 text-[12px] text-ink2" data-testid="tanpa-kas-baru">Tidak ada uang keluar baru dari bank. Jurnal: Dr Utang Usaha / Cr Uang Muka Supplier.{lihat.melunasi ? " Sisa tagihan menjadi nol dan faktur berstatus Lunas." : ""}</p>
                </section>
              )}

              {dp && perluKonfirmasiPasangan(dp) && (
                <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-orangebg px-3 py-2 text-[12.5px] text-orange max-sm:min-h-11">
                  <input type="checkbox" checked={konfirmasiPasangan} onChange={(e) => setKonfirmasiPasangan(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="konfirmasi-pasangan" />
                  <span>{dp.bedaPO ? `Uang muka ini dibayar untuk ${dp.purchaseOrder?.nomor}, bukan PO faktur ini. Saya konfirmasi pengalihan.` : "Uang muka ini tidak tertaut ke PO mana pun. Saya konfirmasi pasangan dengan faktur ini."}</span>
                </label>
              )}
              {dp && (
                <label className="flex cursor-pointer items-start gap-2 text-[12.5px] text-ink max-sm:min-h-11">
                  <input type="checkbox" checked={konfirmasi} onChange={(e) => setKonfirmasi(e.target.checked)} className="mt-0.5 h-4 w-4" data-testid="konfirmasi-penerapan" />
                  <span>Saya sudah memeriksa pratinjau dan mengonfirmasi penerapan uang muka ini ke faktur.</span>
                </label>
              )}
              {!siap.siap && <p className="m-0 text-[12px] text-ink3" role="status" data-testid="pesan-siap-penerapan">{siap.pesan}</p>}
            </>
          )}
          {info && <p className="fin-tg-info" data-nada="biru" role="status" data-testid="info-muat-ulang">{info}</p>}
          <Galat pesan={galat} testid="galat-penerapan" />
          {perluMuat && (
            <Button ref={tombolMuatRef} size="sm" variant="neutral" onClick={() => muat({ pertahankan: true })} data-testid="muat-ulang-penerapan" className="max-sm:min-h-11 max-sm:px-4"><RefreshCw size={12} aria-hidden="true" /> Muat ulang data (isian tetap)</Button>
          )}
        </div>
      )}
    </Modal>
  );
}

function PilihanUangMuka({ d, pilih, onPilih }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 max-sm:min-h-11", pilih === d.id ? "border-accent bg-accentbg" : "border-line")} data-testid={`pilih-uang-muka-${d.nomor}`}>
      <input type="radio" name="uang-muka" checked={pilih === d.id} onChange={() => onPilih(d)} className="mt-1 h-4 w-4 shrink-0" />
      <span className="min-w-0 text-[12.5px]">
        <span className="block font-medium text-ink">
          {d.nomor}{d.purchaseOrder ? ` · ${d.purchaseOrder.nomor}` : " · tanpa PO"}
          {d.samaPO && <Badge variant="green" className="ml-1.5">PO sama</Badge>}
          {d.bedaPO && <Badge variant="orange" className="ml-1.5">PO lain</Badge>}
        </span>
        <span className="block text-ink3">Tersedia {formatUangTepat(d.saldoBelumDiterapkan)} dari {formatUangTepat(d.nominal)} dibayar{d.tanggal ? ` · ${tanggalPendek(String(d.tanggal).slice(0, 10))}` : ""}{d.rekening ? ` · ${d.rekening}` : ""}</span>
      </span>
    </label>
  );
}

// ── Tawaran setelah persetujuan faktur ────────────────────────────────────────────────────────────────────────────────────
/**
 * Setelah persetujuan faktur BERHASIL, periksa uang muka yang tertaut ke PO-nya dan tawarkan langkah terpisah. Menutup tawaran tidak membatalkan persetujuan,
 * membukanya tidak menulis jurnal, dan tidak ada penerapan otomatis. `mulai(billId, nomor)` dipanggil pemanggil SETELAH persetujuan dan penyegaran halaman.
 */
export function useTawaranUangMuka({ bolehPost = true, onSelesai } = {}) {
  const [st, setSt] = useState(null); // { billId, nomor, tahap: "gagal" | "tawar" | "terapkan", ringkas?, galat? }
  const mulai = useCallback(async (billId, nomor) => {
    try {
      const r = ringkasKelayakan(await api.getKandidatUangMukaFaktur(billId));
      setSt(r.ada ? { billId, nomor, tahap: "tawar", ringkas: r } : null);
    } catch (e) {
      setSt({ billId, nomor, tahap: "gagal", galat: e?.message || "Gagal memeriksa uang muka" });
    }
  }, []);
  const tutup = () => setSt(null);
  const elemen = st ? (
    st.tahap === "terapkan"
      ? <PenerapanUangMuka billId={st.billId} nomorFaktur={st.nomor} bolehPost={bolehPost} onClose={tutup} onSaved={async () => { tutup(); await onSelesai?.(); }} />
      : <TawaranUangMuka st={st} bolehPost={bolehPost} onTutup={tutup} onCoba={() => { const { billId, nomor } = st; setSt(null); mulai(billId, nomor); }} onTerapkan={() => setSt({ ...st, tahap: "terapkan" })} />
  ) : null;
  return { mulai, elemen };
}

function TawaranUangMuka({ st, bolehPost, onTutup, onCoba, onTerapkan }) {
  const r = st.ringkas;
  return (
    <Modal
      open onOpenChange={(v) => !v && onTutup()} title="Faktur disetujui" description={`${st.nomor} sudah disetujui dan menjadi utang resmi.`}
      className="fin-tg-modal fin-tg-dlg w-[520px] max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:rounded-none"
      footer={
        st.tahap === "gagal"
          ? <><Button variant="neutral" onClick={onTutup} className="max-sm:min-h-11 max-sm:px-4" data-testid="tutup-tawaran">Tutup</Button><Button onClick={onCoba} data-testid="coba-lagi-tawaran" className="max-sm:min-h-11 max-sm:px-4"><RefreshCw size={13} aria-hidden="true" /> Coba lagi</Button></>
          : <><Button variant="neutral" onClick={onTutup} className="max-sm:min-h-11 max-sm:px-4" data-testid="nanti-saja">Nanti saja</Button><Button onClick={onTerapkan} disabled={!bolehPost} title={bolehPost ? undefined : KETERANGAN_IZIN} data-testid="lanjut-terapkan" className="max-sm:min-h-11 max-sm:px-4"><Wallet size={13} aria-hidden="true" /> Terapkan uang muka</Button></>
      }
    >
      {st.tahap === "gagal" ? (
        <p className="fin-tg-dlg-galat" role="alert" data-testid="galat-tawaran">Persetujuan berhasil, tetapi uang muka untuk faktur ini belum bisa diperiksa ({st.galat}). Persetujuan tidak dibatalkan. Coba lagi, atau periksa manual sebelum mencatat pembayaran.</p>
      ) : (
        <div className="space-y-3" data-testid="tawaran-uang-muka">
          <p className="m-0 text-[14px] font-medium text-ink">Gunakan uang muka untuk mengurangi sisa tagihan?</p>
          <p className="fin-tg-info" data-nada="jingga" role="status">{teksPeringatanUangMuka(r)}</p>
          <p className="m-0 text-[12.5px] text-ink2">Menutup tawaran ini tidak membatalkan persetujuan dan tidak menulis jurnal apa pun. Penerapan baru terjadi setelah Anda memeriksa pratinjau dan mengonfirmasinya.</p>
        </div>
      )}
    </Modal>
  );
}
