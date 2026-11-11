import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Trash2, Wand2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, hapusBaris, kunciIdempoten, kelompokkan, ketersediaanText, parseJumlah, pesanGalatAdopsi, ubahJumlah, waktuWib } from "@/features/production/orderProduksiModel.js";
import { aturanBaris, bolehKonfirmasiAktual, hppBaris, isianAwalDariRencana, keadaanSaldo, qtyStokDariIsian, ringkasHpp, rupiahHpp, satuanIsianBaris, tambahAktual, teksKonversiBaris } from "@/features/production/bahan/bahanModel.js";
import PemilihBahanKatalog from "@/features/production/bahan/PemilihBahanKatalog.jsx";
import BahanBelumAda from "@/features/production/bahan/BahanBelumAda.jsx";
import { adminBahanSaatIni, kabarkanPengajuan, menunggu } from "@/features/production/pengajuan/pengajuanModel.js";

// Bahan BARU dari Gudang — jalur stok resmi (POST /units/:id/materials): satu baris = satu pergerakan ISSUE, Idempotency-Key per niat (klik ganda/retry tidak menggandakan).
// Tidak mewajibkan Rencana Bahan. "Gunakan rencana sebagai isian awal" hanya mengisi formulir (pengguna memeriksa dan mengubah jumlah); TIDAK memposting dan TIDAK mengurangi stok dari rencana.
import "@/features/production/bahan/bahan.css";
const NADA = { green: "bh-ok", orange: "bh-warn", red: "bh-bad" };
const semuaSelesaiDari = (baris, status) => baris.length > 0 && baris.every((b) => status[b.materialId]?.fase === "ok");

// Harga + HPP per bahan: "Harga Rp12.500 / lembar · HPP Rp25.000". Belum ada Harga Berlaku → pesan jujur (bukan Rp0). Peran tanpa izin harga tidak melihat baris ini.
function HppBaris({ b }) {
  const h = hppBaris(b, b.qty);
  if (h.status === "tersembunyi") return null;
  if (h.status === "memuat") return <p className="m-0 mt-1 text-[12px] text-ink3" data-testid="aktual-hpp-baris" data-status="memuat">Memuat harga…</p>;
  if (h.status === "tanpa_harga") return <p className="m-0 mt-1 text-[12px] bh-warn" data-testid="aktual-hpp-baris" data-status="tanpa_harga">Harga Berlaku belum ada — HPP bahan ini belum bisa dihitung dan tidak masuk total.</p>;
  return (
    <p className="m-0 mt-1 flex flex-wrap items-baseline gap-x-2 text-[12px] text-ink2 tabular-nums" data-testid="aktual-hpp-baris" data-status="ada">
      <span data-testid="aktual-harga">Harga {rupiahHpp(h.harga)} / {b.satuan}{h.hargaPakai ? ` (≈ ${rupiahHpp(h.hargaPakai.harga)} / ${h.hargaPakai.satuan})` : ""}</span>
      <span className="text-ink3">·</span>
      <span data-testid="aktual-hpp-subtotal">{h.subtotal !== null ? <>HPP <b className="font-medium text-ink">{rupiahHpp(h.subtotal)}</b></> : "HPP muncul setelah jumlah diisi"}</span>
      {h.terjadwal && <span className="text-ink3" data-testid="aktual-harga-jadwal">(harga berubah ke {rupiahHpp(h.terjadwal.harga)} mulai {new Date(h.terjadwal.berlakuMulai).toLocaleDateString("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" })})</span>}
    </p>
  );
}

export default function CatatBahanBaru({ data, unitId, izin = {}, awalCariAwal = "", onDone, onTutup, onPakaiSementara = null, onBukanBahanIni = null, onTertinggal = null, onDirty = null }) {
  const rencana = data.rencanaBahan?.plan ?? null; const total = data.pemakaianAktual?.total ?? [];
  const [baris, setBaris] = useState([]); const [catatan, setCatatan] = useState(""); const [status, setStatus] = useState({}); const [sibuk, setSibuk] = useState(false); const [infoRencana, setInfoRencana] = useState("");
  const kunciRef = useRef(new Map()); const kirimRef = useRef(false);
  const [belumAda, setBelumAda] = useState(null); // null | { nama } — panel "Bahan belum ada?" (usulan; bukan stok). Baris yang sudah dipilih tetap ada.
  const [awalCari, setAwalCari] = useState(awalCariAwal); const [versiPemilih, setVersiPemilih] = useState(0);
  const pemilihRef = useRef(null);
  const bolehUsul = !!izin.usulBahan;
  const dipilihIds = useMemo(() => new Set(baris.map((b) => b.materialId)), [baris]);
  // Baris dari rencana belum membawa harga: ambil dari katalog (Harga Berlaku sekarang), sekali per bahan. Gagal = tetap "memuat" → ditampilkan jujur sebagai harga belum diketahui, tidak ditebak.
  const hargaDimintaRef = useRef(new Set());
  useEffect(() => {
    for (const b of baris) {
      if (b.harga !== undefined || hargaDimintaRef.current.has(b.materialId)) continue; hargaDimintaRef.current.add(b.materialId);
      api.getKatalogBahanProduksi({ q: b.kode || b.nama, limit: "10" }).then((k) => { const r = (k.rows || []).find((x) => x.materialId === b.materialId); setBaris((x) => x.map((y) => (y.materialId === b.materialId && y.harga === undefined ? { ...y, harga: r ? r.harga ?? null : { harga: null }, ...(r?.satuanPakai && !y.satuanPakai ? { satuanPakai: r.satuanPakai, satuanInput: y.dariRencana ? r.satuanPakai.satuanStok : r.satuanPakai.satuanPakai } : {}) } : y))); }).catch(() => { hargaDimintaRef.current.delete(b.materialId); });
    }
  }, [baris]);
  const hpp = ringkasHpp(baris, (b) => status[b.materialId]?.fase === "ok");
  const hppTercatat = useMemo(() => { if (!semuaSelesaiDari(baris, status)) return null; let total = 0; let ada = false; let kurang = 0; for (const b of baris) { const row = status[b.materialId]?.movementId ? data.pemakaianAktual?.baris?.find((r) => r.id === status[b.materialId].movementId) : null; const n = row?.hppBeku?.nilai; if (typeof n === "number") { total += n; ada = true; } else kurang += 1; } return ada ? { total: Math.round(total * 100) / 100, kurang } : null; }, [baris, status, data.pemakaianAktual]); // eslint-disable-line react-hooks/exhaustive-deps
  const boleh = bolehKonfirmasiAktual(baris, status);
  const langsung = adminBahanSaatIni(); const adaAju = baris.some((b) => status[b.materialId]?.aju);
  const semuaSelesai = baris.length > 0 && baris.every((b) => status[b.materialId]?.fase === "ok");
  const adaGagal = baris.some((b) => status[b.materialId]?.fase === "galat");

  const kunciUntuk = (b) => { const sig = `${parseJumlah(b.qty)}|${aturanBaris(b) ? satuanIsianBaris(b) : ""}|${catatan.trim()}`; const cur = kunciRef.current.get(b.materialId); if (!cur || cur.sig !== sig) kunciRef.current.set(b.materialId, { sig, key: kunciIdempoten("pakai") }); return kunciRef.current.get(b.materialId).key; };

  function pakaiRencana() {
    const { baris: baru, dilewati } = isianAwalDariRencana(rencana?.lines, total, baris);
    setBaris((x) => [...x, ...baru]);
    setInfoRencana(baru.length ? `${baru.length} bahan diisi dari sisa rencana (rencana − sudah dipakai). Periksa dan ubah jumlah bila perlu — belum ada yang dicatat.${dilewati.length ? ` ${dilewati.length} bahan sudah terpakai penuh dan dilewati.` : ""}` : "Semua bahan rencana sudah terpakai penuh atau sudah ada di daftar.");
  }

  async function konfirmasi() {
    if (kirimRef.current || !boleh.ok) return;
    kirimRef.current = true; setSibuk(true);
    try {
      for (const b of baris) {
        if (status[b.materialId]?.fase === "ok") continue;
        const v = Math.round(parseJumlah(b.qty) * 10000) / 10000;
        setStatus((s) => ({ ...s, [b.materialId]: { fase: "sibuk" } }));
        try {
          const mv = await api.addUnitMaterial(unitId, { materialId: b.materialId, qty: v, note: catatan.trim() || undefined, ...(aturanBaris(b) ? { satuan: satuanIsianBaris(b) } : {}) }, kunciUntuk(b)); // bahan beraturan satuan pakai: satuan wajib; SERVER yang mengonversi
          if (menunggu(mv)) { setStatus((s) => ({ ...s, [b.materialId]: { fase: "ok", aju: true, pengajuan: mv.pengajuan, qty: v, ...(aturanBaris(b) ? { satuan: satuanIsianBaris(b) } : {}) } })); kabarkanPengajuan(); continue; } // non-ADMIN: PENGAJUAN, stok belum berubah
          let sesudah = null; try { const k = await api.getKatalogBahanProduksi({ q: b.kode || b.nama, limit: "10" }); const r = (k.rows || []).find((x) => x.materialId === b.materialId); sesudah = r && r.saldoDiketahui ? r.saldo : null; } catch { /* dampak saldo tidak terbaca: tampil "—" */ }
          setStatus((s) => ({ ...s, [b.materialId]: { fase: "ok", movementId: mv.id, qty: v, ...(aturanBaris(b) ? { satuan: satuanIsianBaris(b), qtyStok: qtyStokDariIsian(b, String(v)) } : {}), sebelum: b.saldoDiketahui ? b.tersedia : null, sesudah } }));
        } catch (e) { setStatus((s) => ({ ...s, [b.materialId]: { fase: "galat", galat: e } })); }
      }
    } finally { kirimRef.current = false; setSibuk(false); }
    await onDone?.();
  }

  // "Ganti bahan": buang baris ini dan arahkan ke pemilih (kolom cari difokuskan) — tidak ada yang dicatat.
  function gantiBahan(id) {
    setBaris((x) => hapusBaris(x, id));
    setTimeout(() => { const el = pemilihRef.current?.querySelector("input[type=search]"); if (el) { el.scrollIntoView?.({ block: "center" }); el.focus(); } }, 0);
  }
  const grup = kelompokkan(baris);
  // Lapor ke pemilik form: ada isian yang belum dikonfirmasi (untuk peringatan saat sumber diganti / form ditutup). Tidak menulis apa pun.
  useEffect(() => { onDirty?.(!semuaSelesai && (baris.length > 0 || catatan.trim() !== "")); return () => onDirty?.(false); }, [baris.length, catatan, semuaSelesai]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="prod-bhn-gudang" data-testid="catat-bahan-baru">
      <div className="prod-bhn-2k">
      <div className="prod-bhn-kol kiri">

      {!semuaSelesai && (
        <>
          {rencana?.lines?.length > 0 && (
            <div className="prod-isian-awal" data-testid="isian-awal-rencana">
              <span className="min-w-0 flex-1 text-[12.5px] text-ink">Ada rencana bahan ({rencana.lines.length} bahan). Pakai sebagai isian awal? Anda tetap memeriksa jumlah sebelum dicatat.</span>
              <Button variant="secondary" size="sm" className="min-h-[40px]" onClick={pakaiRencana} disabled={sibuk} data-testid="gunakan-rencana"><Wand2 size={14} aria-hidden /> Gunakan sebagai isian awal</Button>
            </div>
          )}
          {infoRencana && <p role="status" data-testid="info-rencana" className="m-0 text-[12.5px] text-ink2">{infoRencana}</p>}
          {belumAda ? (
            <BahanBelumAda unitId={unitId} kodeUnit={data.unit?.unitCode} izin={izin} awalNama={belumAda.nama} onTertinggal={onTertinggal} onTutup={() => setBelumAda(null)} onDone={onDone}
              onGunakanKatalog={(k) => { setAwalCari(k.nama); setVersiPemilih((v) => v + 1); setBelumAda(null); }} />
          ) : (
            <div ref={pemilihRef}><PemilihBahanKatalog key={versiPemilih} awalCari={awalCari} dipilihIds={dipilihIds} onTambah={(k) => setBaris((x) => tambahAktual(x, k))} disabled={sibuk} testid="aktual-pemilih" onBahanBelumAda={(bolehUsul || izin.catatPemakaianSementara) ? (nama) => setBelumAda({ nama }) : null} /></div>
          )}
        </>
      )}

      </div>
      <div className="prod-bhn-kol kanan">
      <div className="prod-pilihan" data-testid="aktual-pilihan">
        <h4 className="prod-bhn-judul-kol">Bahan dipilih ({baris.length})</h4>
        {!baris.length && <p className="prod-kosong-kecil m-0">Belum ada bahan dipilih. Pilih dari katalog, lalu isi jumlah.</p>}
        {grup.map((g) => (
          <section key={g.kode} aria-label={g.label} className="mb-2">
            <h5 className="m-0 mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink3">{g.label}</h5>
            <ul className="prod-isian-daftar m-0">
              {g.baris.map((b) => {
                const st = status[b.materialId]; const ks = keadaanSaldo(b, b.qty); const terkunci = st?.fase === "ok" || sibuk;
                const ar = aturanBaris(b); const stokQty = qtyStokDariIsian(b, b.qty); const konv = teksKonversiBaris(b, b.qty);
                const row = st?.movementId ? data.pemakaianAktual?.baris?.find((r) => r.id === st.movementId) : null;
                return (
                  <li key={b.materialId} className="prod-isian" data-testid="aktual-baris-isian" data-fase={st?.fase || "isi"}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span><span className="block text-[11.5px] text-ink3">{b.kode || "—"}</span></span>
                      <label className="ml-auto flex shrink-0 items-center gap-1.5 max-sm:ml-0"><span className="sr-only">Jumlah {b.nama}</span>
                        <input inputMode="decimal" value={b.qty} disabled={terkunci} onChange={(e) => setBaris((x) => ubahJumlah(x, b.materialId, e.target.value))} data-testid="aktual-qty" placeholder="0"
                          className="prod-qty" />
                        {ar && !terkunci ? (
                          <select aria-label={`Satuan jumlah ${b.nama}`} value={satuanIsianBaris(b)} onChange={(e) => setBaris((x) => x.map((y) => (y.materialId === b.materialId ? { ...y, satuanInput: e.target.value } : y)))} data-testid="aktual-satuan-pilih" className="h-10 rounded-btn border border-line bg-surface px-1.5 text-[12px] text-ink">
                            <option value={ar.satuanPakai}>{ar.satuanPakai}</option><option value={ar.satuanStok}>{ar.satuanStok}</option>
                          </select>
                        ) : <span className="w-12 text-[12px] text-ink3" data-testid="aktual-satuan">{ar ? satuanIsianBaris(b) : b.satuan}</span>}</label>
                      {!terkunci && <Button variant="secondary" size="sm" className="min-h-[40px] shrink-0" data-testid="aktual-ganti" aria-label={`Ganti bahan ${b.nama}`} onClick={() => gantiBahan(b.materialId)}><ArrowLeftRight size={14} aria-hidden /> Ganti bahan</Button>}
                      {!terkunci && <button type="button" onClick={() => setBaris((x) => hapusBaris(x, b.materialId))} aria-label={`Hapus ${b.nama} dari daftar`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn text-ink3 outline-none hover:bg-hovertint hover:text-red focus-visible:ring-2 focus-visible:ring-accent/40"><Trash2 size={16} aria-hidden /></button>}
                    </div>
                    {st?.fase !== "ok" && <HppBaris b={b} />}
                    {st?.fase !== "ok" && <p className="m-0 mt-1 text-[12px] text-ink2" data-testid="aktual-dampak-stok">Satuan {ar ? "stok " : ""}{b.satuan} · {ketersediaanText(b)} · Dampak stok: {ks.status === "tidak_diketahui" ? "tidak bisa dicatat (stok belum tercatat)" : parseJumlah(b.qty) > 0 ? `berkurang ${formatJumlah(stokQty)} ${b.satuan} saat dikonfirmasi` : "berkurang sesuai jumlah yang Anda isi, saat dikonfirmasi"}</p>}
                    {konv && st?.fase !== "ok" && <p className="m-0 mt-1 text-[12px] text-ink2 tabular-nums" data-testid="aktual-konversi">{konv} · {ar.teks}; stok dicatat dalam {ar.satuanStok} (dibulatkan 4 desimal)</p>}
                    {b.dariRencana && <p className="m-0 mt-1 text-[11.5px] text-ink3">Rencana {formatJumlah(b.dariRencana.rencana)}, sudah dipakai {formatJumlah(b.dariRencana.sudahDipakai)} {b.satuan}.</p>}
                    {st?.fase !== "ok" && <p data-testid="aktual-saldo" data-status={ks.status} className={cn("m-0 mt-1 text-[12px]", NADA[ks.nada])}>{ks.teks}{ks.sisaTeks ? <span data-testid="aktual-sisa"> · {ks.sisaTeks}</span> : null}</p>}
                    {st?.fase !== "ok" && ks.status === "tidak_diketahui" && (onPakaiSementara || onBukanBahanIni) && (
                      <div className="mt-1 flex flex-wrap gap-2" data-testid="aktual-alternatif">
                        <p className="m-0 basis-full text-[12px] text-ink2" data-testid="aktual-stok-tak-diketahui-jalur">Bahan ini ada di katalog tetapi <b>belum punya catatan stok</b>, jadi server menolak pencatatan resmi. Dua jalur: (1) <b>Catat sementara — stok belum diketahui</b>: fakta pemakaian dicatat sekarang, tertaut ke bahan ini, berstatus “Perlu rekonsiliasi Gudang” (stok, biaya, jurnal tidak berubah); atau (2) minta Gudang mencatat stok awal/opname lebih dulu, lalu catat lewat “Bahan dari Gudang”.</p>
                        {onPakaiSementara && izin.catatPemakaianSementara && <Button className="bh-cta min-h-[40px]" size="sm" data-testid="aktual-ke-sementara-katalog" onClick={() => onPakaiSementara({ materialId: b.materialId, kode: b.kode, nama: b.nama, satuan: b.satuan, qty: b.qty })}>Catat sementara — stok belum diketahui</Button>}
                        {onBukanBahanIni && <Button variant="secondary" size="sm" className="min-h-[40px]" data-testid="aktual-ke-sementara" onClick={() => onBukanBahanIni({ satuan: b.satuan })}>Yang saya pakai bukan bahan ini</Button>}
                      </div>
                    )}
                    {st?.fase === "sibuk" && <p className="m-0 mt-1 text-[12px] text-ink3">Mencatat…</p>}
                    {st?.fase === "galat" && <p role="alert" data-testid="aktual-galat" className="m-0 mt-1 text-[12px] text-red">{pesanGalatAdopsi(st.galat).teks} Isian tetap di layar; coba lagi (tidak akan tercatat dua kali).</p>}
                    {st?.fase === "ok" && st.aju && (
                      <div role="status" data-testid="aktual-hasil-aju" className="mt-1 rounded-btn bg-orangebg px-2.5 py-2 text-[12.5px] text-ink">
                        <p className="m-0 flex items-start gap-1.5 font-medium"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden />Dilaporkan: {formatJumlah(st.qty)} {st.satuan ?? b.satuan} {b.nama}. Menunggu verifikasi ADMIN.</p>
                        <p className="m-0 mt-0.5 pl-5 text-ink2">Stok dan HPP belum berubah sampai ADMIN (orang lain) memverifikasi. Pekerjaan tetap bisa dilanjutkan.</p>
                      </div>
                    )}
                    {st?.fase === "ok" && !st.aju && (
                      <div role="status" data-testid="aktual-hasil" className="mt-1 rounded-btn bg-greenbg px-2.5 py-2 text-[12.5px] text-green">
                        <p className="m-0 flex items-start gap-1.5 font-medium"><CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />Tercatat: {formatJumlah(st.qty)} {st.satuan ?? b.satuan}{st.qtyStok != null && st.satuan !== b.satuan ? ` (= ${formatJumlah(st.qtyStok)} ${b.satuan})` : ""} {b.nama}. Stok berkurang.</p>
                        <p className="m-0 mt-0.5 pl-5 text-ink2">{row ? `${row.pelaku || "—"} · ${waktuWib(row.tanggal)} · ${row.dokumen.jenis} ${row.dokumen.nomor}` : "Memuat rincian pencatat…"}</p>
                        {row?.hppBeku && row.hppBeku.status === "DINILAI" && row.hppBeku.nilai != null && <p className="m-0 pl-5 text-ink2" data-testid="aktual-hpp-tercatat">HPP operasional {rupiahHpp(row.hppBeku.nilai)} (harga {rupiahHpp(row.hppBeku.harga)} / {b.satuan}, dibekukan saat dicatat)</p>}
                        {row?.hppBeku && row.hppBeku.status !== "DINILAI" && row.hppBeku.status !== undefined && <p className="m-0 pl-5 text-ink2" data-testid="aktual-hpp-tercatat-kosong">HPP operasional: {row.hppBeku.status === "BELUM_DIBEKUKAN" ? "belum dibekukan" : "belum ada harga berlaku saat dicatat"} — belum masuk HPP.</p>}
                        <p className="m-0 pl-5 text-ink2" data-testid="dampak-saldo">Saldo Gudang: {st.sebelum != null ? formatJumlah(st.sebelum) : "—"} → {st.sesudah != null ? formatJumlah(st.sesudah) : "—"} {b.satuan}{st.sebelum == null ? " (stok sebelumnya belum diketahui)" : ""}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="prod-bhn-konfirmasi">
      {!belumAda && <p className="prod-dampak m-0"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span data-testid="dampak-stok-ringkas">{langsung ? <><b>Mengurangi stok</b> saat dikonfirmasi — Material Issue resmi, tepat sekali.</> : <><b>Dilaporkan sebagai pengajuan</b> — stok & HPP berubah sesudah diverifikasi ADMIN (tepat sekali).</>}</span></p>}
      {!semuaSelesai && baris.length > 0 && (
        <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} disabled={sibuk} placeholder="Catatan untuk pemakaian ini (opsional)" aria-label="Catatan pemakaian" data-testid="aktual-catatan"
          className="prod-catatan-input" />
      )}
      {!semuaSelesai && hpp.tampil && (
        <div className="prod-hpp-total" data-testid="hpp-total" role="status">
          <span className="prod-hpp-judul">Total HPP operasional</span>
          <span className="prod-hpp-angka" data-testid="hpp-total-angka">{hpp.nBerharga > 0 || hpp.lengkap ? rupiahHpp(hpp.total) : "—"}</span>
          <span className="prod-hpp-ket" data-testid="hpp-total-ket">{hpp.nMemuat > 0 ? "Memuat harga…" : hpp.nTanpaHarga > 0 ? `${hpp.nTanpaHarga} bahan belum punya Harga Berlaku — belum masuk total (bukan Rp0). Minta Gudang mengisi harga.` : "Harga Berlaku Gudang saat ini × jumlah. Angka resmi dibekukan saat dikonfirmasi."}</span>
        </div>
      )}
      {semuaSelesai && hppTercatat && !adaAju && (
        <div className="prod-hpp-total" data-testid="hpp-total-tercatat" role="status">
          <span className="prod-hpp-judul">HPP operasional tercatat</span>
          <span className="prod-hpp-angka">{rupiahHpp(hppTercatat.total)}</span>
          <span className="prod-hpp-ket">{hppTercatat.kurang > 0 ? `${hppTercatat.kurang} bahan belum punya harga berlaku saat dicatat — belum masuk HPP.` : "Dibekukan pada Harga Berlaku saat pemakaian dicatat."}</span>
        </div>
      )}
      {!semuaSelesai && baris.length > 0 && boleh.ok && (
        <p className="prod-dampak konfirmasi m-0" data-testid="aktual-ringkasan-konfirmasi">{langsung ? "Stok Gudang akan berkurang" : "Dilaporkan (stok berkurang sesudah verifikasi ADMIN)"}: {baris.filter((b) => status[b.materialId]?.fase !== "ok").map((b) => `${formatJumlah(parseJumlah(b.qty))} ${aturanBaris(b) ? satuanIsianBaris(b) : b.satuan}${aturanBaris(b) && satuanIsianBaris(b) !== b.satuan ? ` (= ${formatJumlah(qtyStokDariIsian(b, b.qty))} ${b.satuan})` : ""} ${b.nama}`).join("; ")}.</p>
      )}
      {boleh.alasan && !semuaSelesai && <p className="m-0 text-[12px] text-red">{boleh.alasan}</p>}
      <div className="prod-aksi-form">
        <Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>{semuaSelesai ? "Selesai" : "Batal"}</Button>
        {!semuaSelesai && <Button className="bh-cta min-h-[44px]" data-testid="aktual-konfirmasi" disabled={sibuk || !boleh.ok} onClick={konfirmasi}>{sibuk ? "Mencatat…" : adaGagal ? "Coba lagi yang gagal" : langsung ? "Konfirmasi & kurangi stok" : "Laporkan pemakaian"}</Button>}
      </div>
      </div>
      </div>
      </div>
    </div>
  );
}
