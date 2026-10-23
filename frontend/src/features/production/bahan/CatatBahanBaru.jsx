import React, { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Trash2, Wand2 } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { cn } from "@/lib/utils.js";
import { formatJumlah, hapusBaris, kunciIdempoten, kelompokkan, parseJumlah, pesanGalatAdopsi, ubahJumlah, waktuWib } from "@/features/production/orderProduksiModel.js";
import { SUMBER, bolehKonfirmasiAktual, isianAwalDariRencana, keadaanSaldo, tambahAktual } from "@/features/production/bahan/bahanModel.js";
import PemilihBahanKatalog from "@/features/production/bahan/PemilihBahanKatalog.jsx";
import BahanBelumAda from "@/features/production/bahan/BahanBelumAda.jsx";

// Bahan BARU dari Gudang — jalur stok resmi (POST /units/:id/materials): satu baris = satu pergerakan ISSUE, Idempotency-Key per niat (klik ganda/retry tidak menggandakan).
// Tidak mewajibkan Rencana Bahan. "Gunakan rencana sebagai isian awal" hanya mengisi formulir (pengguna memeriksa dan mengubah jumlah); TIDAK memposting dan TIDAK mengurangi stok dari rencana.
import "@/features/production/bahan/bahan.css";
const NADA = { green: "bh-ok", orange: "bh-warn", red: "bh-bad" };

export default function CatatBahanBaru({ data, unitId, izin = {}, onDone, onTutup }) {
  const rencana = data.rencanaBahan?.plan ?? null; const total = data.pemakaianAktual?.total ?? [];
  const [baris, setBaris] = useState([]); const [catatan, setCatatan] = useState(""); const [status, setStatus] = useState({}); const [sibuk, setSibuk] = useState(false); const [infoRencana, setInfoRencana] = useState("");
  const kunciRef = useRef(new Map()); const kirimRef = useRef(false);
  const [belumAda, setBelumAda] = useState(null); // null | { nama } — panel "Bahan belum ada?" (usulan; bukan stok). Baris yang sudah dipilih tetap ada.
  const [awalCari, setAwalCari] = useState(""); const [versiPemilih, setVersiPemilih] = useState(0);
  const bolehUsul = !!izin.usulBahan;
  const dipilihIds = useMemo(() => new Set(baris.map((b) => b.materialId)), [baris]);
  const boleh = bolehKonfirmasiAktual(baris, status);
  const semuaSelesai = baris.length > 0 && baris.every((b) => status[b.materialId]?.fase === "ok");
  const adaGagal = baris.some((b) => status[b.materialId]?.fase === "galat");

  const kunciUntuk = (b) => { const sig = `${parseJumlah(b.qty)}|${catatan.trim()}`; const cur = kunciRef.current.get(b.materialId); if (!cur || cur.sig !== sig) kunciRef.current.set(b.materialId, { sig, key: kunciIdempoten("pakai") }); return kunciRef.current.get(b.materialId).key; };

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
          const mv = await api.addUnitMaterial(unitId, { materialId: b.materialId, qty: v, note: catatan.trim() || undefined }, kunciUntuk(b));
          let sesudah = null; try { const k = await api.getKatalogBahanProduksi({ q: b.kode || b.nama, limit: "10" }); const r = (k.rows || []).find((x) => x.materialId === b.materialId); sesudah = r && r.saldoDiketahui ? r.saldo : null; } catch { /* dampak saldo tidak terbaca: tampil "—" */ }
          setStatus((s) => ({ ...s, [b.materialId]: { fase: "ok", movementId: mv.id, qty: v, sebelum: b.saldoDiketahui ? b.tersedia : null, sesudah } }));
        } catch (e) { setStatus((s) => ({ ...s, [b.materialId]: { fase: "galat", galat: e } })); }
      }
    } finally { kirimRef.current = false; setSibuk(false); }
    await onDone?.();
  }

  const grup = kelompokkan(baris);
  return (
    <div className="space-y-4" data-testid="catat-bahan-baru">
      {!belumAda && <p className="m-0 flex items-start gap-2 rounded-btn bg-orangebg px-3 py-2 text-[12.5px] text-ink"><AlertTriangle size={15} className="bh-warn mt-0.5 shrink-0" aria-hidden /><span><b>{SUMBER.BARU.label}</b>: stok Gudang <b>berkurang</b> saat Anda konfirmasi, lewat Material Issue/pergerakan stok resmi, tepat sekali. Tidak perlu membuat Rencana lebih dulu.</span></p>}

      {!semuaSelesai && (
        <>
          {rencana?.lines?.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-btn border border-line px-3 py-2" data-testid="isian-awal-rencana">
              <span className="min-w-0 flex-1 text-[12.5px] text-ink">Ada rencana bahan ({rencana.lines.length} bahan). Pakai sebagai isian awal? Anda tetap memeriksa jumlah sebelum dicatat.</span>
              <Button variant="secondary" size="sm" className="min-h-[40px]" onClick={pakaiRencana} disabled={sibuk} data-testid="gunakan-rencana"><Wand2 size={14} aria-hidden /> Gunakan sebagai isian awal</Button>
            </div>
          )}
          {infoRencana && <p role="status" data-testid="info-rencana" className="m-0 text-[12.5px] text-ink2">{infoRencana}</p>}
          {belumAda ? (
            <BahanBelumAda unitId={unitId} kodeUnit={data.unit?.unitCode} izin={izin} awalNama={belumAda.nama} onTutup={() => setBelumAda(null)} onDone={onDone}
              onGunakanKatalog={(k) => { setAwalCari(k.nama); setVersiPemilih((v) => v + 1); setBelumAda(null); }} />
          ) : (
            <PemilihBahanKatalog key={versiPemilih} awalCari={awalCari} dipilihIds={dipilihIds} onTambah={(k) => setBaris((x) => tambahAktual(x, k))} disabled={sibuk} testid="aktual-pemilih" onBahanBelumAda={bolehUsul ? (nama) => setBelumAda({ nama }) : null} />
          )}
        </>
      )}

      <div className="border-t border-line pt-3" data-testid="aktual-pilihan">
        <h4 className="m-0 mb-1 text-[13px] font-semibold text-ink">Bahan yang dicatat ({baris.length})</h4>
        {!baris.length && <p className="m-0 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink">Belum ada bahan dipilih. Pilih dari daftar di atas, lalu isi jumlah dan satuan.</p>}
        {grup.map((g) => (
          <section key={g.kode} aria-label={g.label} className="mb-2">
            <h5 className="m-0 mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink3">{g.label}</h5>
            <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0">
              {g.baris.map((b) => {
                const st = status[b.materialId]; const ks = keadaanSaldo(b, b.qty); const terkunci = st?.fase === "ok" || sibuk;
                const row = st?.movementId ? data.pemakaianAktual?.baris?.find((r) => r.id === st.movementId) : null;
                return (
                  <li key={b.materialId} className="px-3 py-2" data-testid="aktual-baris-isian" data-fase={st?.fase || "isi"}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span><span className="block text-[11.5px] text-ink3">{b.kode || "—"}</span></span>
                      <label className="ml-auto flex shrink-0 items-center gap-1.5 max-sm:ml-0"><span className="sr-only">Jumlah {b.nama}</span>
                        <input inputMode="decimal" value={b.qty} disabled={terkunci} onChange={(e) => setBaris((x) => ubahJumlah(x, b.materialId, e.target.value))} data-testid="aktual-qty" placeholder="0"
                          className="h-11 w-24 rounded-btn border border-line bg-surface px-2 text-right text-[14px] tabular-nums text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60" />
                        <span className="w-12 text-[12px] text-ink3" data-testid="aktual-satuan">{b.satuan}</span></label>
                      {!terkunci && <button type="button" onClick={() => setBaris((x) => hapusBaris(x, b.materialId))} aria-label={`Hapus ${b.nama} dari daftar`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn text-ink3 outline-none hover:bg-hovertint hover:text-red focus-visible:ring-2 focus-visible:ring-accent/40"><Trash2 size={16} aria-hidden /></button>}
                    </div>
                    {b.dariRencana && <p className="m-0 mt-1 text-[11.5px] text-ink3">Rencana {formatJumlah(b.dariRencana.rencana)}, sudah dipakai {formatJumlah(b.dariRencana.sudahDipakai)} {b.satuan}.</p>}
                    {st?.fase !== "ok" && <p data-testid="aktual-saldo" data-status={ks.status} className={cn("m-0 mt-1 text-[12px]", NADA[ks.nada])}>{ks.teks}{ks.sisaTeks ? <span data-testid="aktual-sisa"> · {ks.sisaTeks}</span> : null}</p>}
                    {st?.fase === "sibuk" && <p className="m-0 mt-1 text-[12px] text-ink3">Mencatat…</p>}
                    {st?.fase === "galat" && <p role="alert" data-testid="aktual-galat" className="m-0 mt-1 text-[12px] text-red">{pesanGalatAdopsi(st.galat).teks} Isian tetap di layar; coba lagi (tidak akan tercatat dua kali).</p>}
                    {st?.fase === "ok" && (
                      <div role="status" data-testid="aktual-hasil" className="mt-1 rounded-btn bg-greenbg px-2.5 py-2 text-[12.5px] text-green">
                        <p className="m-0 flex items-start gap-1.5 font-medium"><CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden />Tercatat: {formatJumlah(st.qty)} {b.satuan} {b.nama}. Stok berkurang.</p>
                        <p className="m-0 mt-0.5 pl-5 text-ink2">{row ? `${row.pelaku || "—"} · ${waktuWib(row.tanggal)} · ${row.dokumen.jenis} ${row.dokumen.nomor}` : "Memuat rincian pencatat…"}</p>
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

      {!semuaSelesai && baris.length > 0 && (
        <input value={catatan} onChange={(e) => setCatatan(e.target.value)} maxLength={300} disabled={sibuk} placeholder="Catatan untuk pemakaian ini (opsional)" aria-label="Catatan pemakaian" data-testid="aktual-catatan"
          className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[13.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
      )}
      {!semuaSelesai && baris.length > 0 && boleh.ok && (
        <p className="m-0 rounded-btn bg-inset px-3 py-2 text-[12.5px] text-ink" data-testid="aktual-ringkasan-konfirmasi">Stok Gudang akan berkurang: {baris.filter((b) => status[b.materialId]?.fase !== "ok").map((b) => `${formatJumlah(parseJumlah(b.qty))} ${b.satuan} ${b.nama}`).join("; ")}.</p>
      )}
      {boleh.alasan && !semuaSelesai && <p className="m-0 text-[12px] text-red">{boleh.alasan}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="neutral" className="min-h-[44px]" onClick={onTutup} disabled={sibuk}>{semuaSelesai ? "Selesai" : "Batal"}</Button>
        {!semuaSelesai && <Button className="bh-cta min-h-[44px]" data-testid="aktual-konfirmasi" disabled={sibuk || !boleh.ok} onClick={konfirmasi}>{sibuk ? "Mencatat…" : adaGagal ? "Coba lagi yang gagal" : "Konfirmasi & kurangi stok"}</Button>}
      </div>
    </div>
  );
}
