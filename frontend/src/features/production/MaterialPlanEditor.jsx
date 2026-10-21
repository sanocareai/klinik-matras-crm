import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Plus, Search, Trash2, X } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import {
  adaPerubahan, badanRencana, dariRencana, formatJumlah, hapusBaris, kelompokkan, ketersediaanNada, ketersediaanText, pesanGalatAdopsi, ringkasPilihan, tambahBaris, ubahJumlah, validasiBaris, waktuWib,
} from "@/features/production/orderProduksiModel.js";

// Rencana bahan per unit (adopsi Admin). RENCANA ≠ PEMAKAIAN AKTUAL: menyimpan rencana TIDAK mengurangi stok, tidak mereservasi, tidak membuat jurnal.
// Pilih bahan lewat kelompok Gudang (Busa, Kain, Pegas, …) atau cari di seluruh katalog; ringkasan pilihan menetap di bawah supaya tidak hilang saat daftar panjang di-scroll.
// Simpan = revisi baru dengan riwayat; bila orang lain sudah merevisi, server menolak (konflik) dan Anda memilih memuat versi terbaru.

const NADA_TEKS = { green: "text-green", orange: "text-orange", red: "text-red", neutral: "text-ink3" };

function DaftarRencana({ lines }) {
  const grup = useMemo(() => kelompokkan(dariRencana(lines)), [lines]);
  return (
    <div className="space-y-3">
      {grup.map((g) => (
        <section key={g.kode} aria-label={g.label}>
          <h4 className="m-0 mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink3">{g.label}</h4>
          <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0">
            {g.baris.map((b) => (
              <li key={b.materialId} className="flex items-baseline gap-3 px-3 py-2" data-testid="rencana-baris">
                <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span><span className="block text-[11.5px] text-ink3">{b.kode || "—"}</span></span>
                <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">{formatJumlah(b.qty)} <span className="font-normal text-ink3">{b.satuan}</span></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Riwayat({ revisi }) {
  if (!revisi?.length) return null;
  const urut = [...revisi].sort((a, b) => b.revision - a.revision);
  return (
    <details className="group rounded-btn" data-testid="rencana-riwayat">
      <summary className="cursor-pointer list-none text-[12.5px] font-medium text-accent outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Riwayat revisi ({revisi.length})</summary>
      <ol className="m-0 mt-2 list-none space-y-2 p-0">
        {urut.map((r) => (
          <li key={r.revision} className="rounded-btn bg-inset px-3 py-2 text-[12px]">
            <div className="font-semibold text-ink">Revisi {r.revision} <span className="font-normal text-ink3">· {r.oleh || "—"} · {waktuWib(r.at)}</span></div>
            {r.alasan && <div className="text-ink2">“{r.alasan}”</div>}
            <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-ink2">
              {r.perubahan.map((p) => (
                <li key={`${r.revision}-${p.materialId}`}>
                  {p.aksi === "TAMBAH" && <>＋ {p.nama || p.kode || "Bahan"} {formatJumlah(p.sesudah)} {p.satuan}</>}
                  {p.aksi === "UBAH" && <>↻ {p.nama || p.kode || "Bahan"} {formatJumlah(p.sebelum)} → {formatJumlah(p.sesudah)} {p.satuan}</>}
                  {p.aksi === "HAPUS" && <>－ {p.nama || p.kode || "Bahan"} (dihapus dari rencana)</>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function MaterialPlanEditor({ unitId, rencana, bolehUbah, unitAktif = true, onSaved, onReload }) {
  const plan = rencana?.plan ?? null;
  const [edit, setEdit] = useState(false);
  const [baris, setBaris] = useState(() => dariRencana(plan?.lines));
  const [alasan, setAlasan] = useState("");
  const [cari, setCari] = useState(""); const [cariTunda, setCariTunda] = useState("");
  const [kelompok, setKelompok] = useState("");
  const [katalog, setKatalog] = useState({ rows: [], kelompok: [], total: 0, memuat: false, galat: "" });
  const [simpan, setSimpan] = useState({ sibuk: false, galat: null, sukses: "" });
  const [tampilGalatIsian, setTampilGalatIsian] = useState(false);
  const reqRef = useRef(0);

  // Rencana tersimpan berubah dari luar (muat ulang) → isian editor dimulai dari versi itu, kecuali sedang menyunting.
  useEffect(() => { if (!edit) setBaris(dariRencana(plan?.lines)); }, [plan?.revision, plan?.lines, edit]);
  useEffect(() => { const t = setTimeout(() => setCariTunda(cari.trim()), 250); return () => clearTimeout(t); }, [cari]);

  const muatKatalog = useCallback(async () => {
    const id = ++reqRef.current;
    setKatalog((k) => ({ ...k, memuat: true, galat: "" }));
    try {
      // Mengetik = cari di SELURUH katalog (kelompok diabaikan); tanpa ketikan = isi kelompok terpilih.
      const d = await api.getKatalogBahanProduksi({ q: cariTunda || undefined, kelompok: cariTunda ? undefined : kelompok || undefined, limit: "60" });
      if (id !== reqRef.current) return;
      setKatalog({ rows: d.rows || [], kelompok: d.kelompok || [], total: d.total ?? (d.rows || []).length, memuat: false, galat: "" });
    } catch (e) { if (id === reqRef.current) setKatalog((k) => ({ ...k, memuat: false, galat: e.message || "Katalog bahan gagal dimuat" })); }
  }, [cariTunda, kelompok]);
  useEffect(() => { if (edit) muatKatalog(); }, [edit, muatKatalog]);

  const dipilihId = useMemo(() => new Set(baris.map((b) => b.materialId)), [baris]);
  const ringkas = useMemo(() => ringkasPilihan(baris), [baris]);
  const validasi = useMemo(() => validasiBaris(baris), [baris]);
  const berubah = useMemo(() => adaPerubahan(baris, plan?.lines || []), [baris, plan?.lines]);
  const grupPilihan = useMemo(() => kelompokkan(baris, katalog.kelompok), [baris, katalog.kelompok]);
  const galat = simpan.galat ? pesanGalatAdopsi(simpan.galat) : null;

  function mulai() { setEdit(true); setSimpan({ sibuk: false, galat: null, sukses: "" }); setBaris(dariRencana(plan?.lines)); setAlasan(""); setCari(""); setKelompok(""); setTampilGalatIsian(false); }
  function batal() { setEdit(false); setBaris(dariRencana(plan?.lines)); setSimpan({ sibuk: false, galat: null, sukses: "" }); }

  const kirimRef = useRef(false); // klik ganda lebih cepat dari render ulang: SATU permintaan per niat (permintaan kedua dengan revisi basi menimpa pesan sukses dengan galat tersembunyi)
  async function kirim() {
    setTampilGalatIsian(true);
    if (kirimRef.current || !validasi.ok || (!berubah && !!plan)) return;
    kirimRef.current = true;
    setSimpan({ sibuk: true, galat: null, sukses: "" });
    try {
      const hasil = await api.putRencanaBahan(unitId, { lines: badanRencana(baris), expectedRevision: plan?.revision ?? 0, reason: alasan.trim() || undefined });
      setEdit(false);
      setSimpan({ sibuk: false, galat: null, sukses: hasil.disimpan === false ? "Tidak ada perubahan yang perlu disimpan." : `Rencana disimpan sebagai revisi ${hasil.rencana?.plan?.revision ?? ""}. Stok tidak berubah.`.replace("  ", " ") });
      onSaved?.(hasil.rencana);
    } catch (e) { setSimpan({ sibuk: false, galat: e, sukses: "" }); } finally { kirimRef.current = false; }
  }

  const kosong = !plan || plan.lines.length === 0;

  return (
    <section aria-labelledby="rencana-judul" data-testid="rencana-bahan" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="rencana-judul" className="m-0 text-[15px] font-semibold text-ink">Rencana bahan</h3>
        <Badge variant="accent" title="Rencana tidak mengurangi stok. Pemakaian bahan sungguhan dicatat di bagian 'Pemakaian aktual'.">Rencana · tidak mengurangi stok</Badge>
        {plan && <span className="text-[12px] text-ink3">Revisi {plan.revision} · {plan.updatedBy || "—"} · {waktuWib(plan.updatedAt)}</span>}
        {bolehUbah && unitAktif && !edit && <Button variant="secondary" size="sm" className="ml-auto min-h-[40px]" data-testid="rencana-ubah" onClick={mulai}>{kosong ? "Susun rencana bahan" : "Ubah rencana"}</Button>}
      </div>

      {simpan.sukses && !edit && <p role="status" data-testid="rencana-sukses" className="m-0 flex items-start gap-2 rounded-btn bg-greenbg px-3 py-2 text-[12.5px] text-green"><CheckCircle2 size={15} className="mt-0.5 shrink-0" aria-hidden />{simpan.sukses}</p>}

      {!edit && (kosong
        ? <p className="m-0 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2" data-testid="rencana-kosong">Belum ada rencana bahan untuk unit ini. {bolehUbah && unitAktif ? "Tekan “Susun rencana bahan” untuk memilih bahan per kelompok." : !unitAktif ? "Unit sudah selesai/dibatalkan." : "Akun Anda hanya bisa melihat."}</p>
        : <DaftarRencana lines={plan.lines} />)}
      {!edit && <Riwayat revisi={rencana?.revisi} />}

      {edit && (
        <div className="space-y-4" data-testid="rencana-editor">
          {/* ── pemilih bahan */}
          <div className="space-y-2">
            <label className="relative block">
              <span className="sr-only">Cari bahan di seluruh katalog</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" aria-hidden />
              <input type="search" value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari bahan (nama atau kode) di seluruh katalog…" data-testid="rencana-cari"
                className="h-11 w-full rounded-btn border border-line bg-surface pl-9 pr-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
            </label>
            <div role="group" aria-label="Kelompok bahan" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {[{ kode: "", label: "Semua", jumlah: null }, ...katalog.kelompok.filter((k) => k.jumlah > 0 || k.kode === kelompok)].map((k) => (
                <button key={k.kode || "semua"} type="button" aria-pressed={!cariTunda && kelompok === k.kode} disabled={!!cariTunda} data-testid={`rencana-kelompok-${k.kode || "semua"}`} onClick={() => setKelompok(k.kode)}
                  className={cn("min-h-[40px] shrink-0 rounded-chip px-3 text-[13px] font-medium transition-colors disabled:opacity-40", !cariTunda && kelompok === k.kode ? "bg-accent text-white" : "bg-inset text-ink2 hover:bg-hovertint")}>
                  {k.label}{k.jumlah != null && <span className="ml-1 text-[11.5px] opacity-70">{k.jumlah}</span>}
                </button>
              ))}
            </div>
            {cariTunda && <p className="m-0 text-[12px] text-ink3">Hasil pencarian dari semua kelompok. Hapus kata kunci untuk memilih per kelompok.</p>}

            <div className="max-h-[260px] overflow-y-auto rounded-btn bg-inset" data-testid="rencana-katalog" aria-busy={katalog.memuat}>
              {katalog.galat && <p role="alert" className="m-0 flex items-center justify-between gap-2 px-3 py-2 text-[12.5px] text-red">{katalog.galat}<Button variant="tertiary" size="sm" onClick={muatKatalog}>Coba lagi</Button></p>}
              {katalog.memuat && !katalog.rows.length && <div className="space-y-2 p-3" aria-label="Memuat katalog bahan">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-line/60 motion-reduce:animate-none" />)}</div>}
              {!katalog.memuat && !katalog.galat && !katalog.rows.length && <p className="m-0 px-3 py-4 text-center text-[13px] text-ink3" data-testid="rencana-katalog-kosong">{cariTunda ? `Tidak ada bahan cocok dengan “${cariTunda}”. Coba nama atau kode lain.` : "Kelompok ini belum punya bahan aktif."}</p>}
              <ul className="m-0 list-none divide-y divide-line p-0">
                {katalog.rows.map((b) => {
                  const ada = dipilihId.has(b.materialId); const nada = ketersediaanNada(b);
                  return (
                    <li key={b.materialId} className="flex items-center gap-3 px-3 py-2" data-testid="rencana-katalog-baris">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span>
                        <span className="block text-[11.5px] text-ink3">{b.kode} · {b.satuan}{cariTunda ? ` · ${b.kelompok?.label}` : ""} · <span className={NADA_TEKS[nada]}>{ketersediaanText(b)}</span></span>
                      </span>
                      <Button variant={ada ? "neutral" : "secondary"} size="sm" className="min-h-[40px] shrink-0" disabled={ada || baris.length >= 200} onClick={() => setBaris((x) => tambahBaris(x, b))} aria-label={ada ? `${b.nama} sudah dipilih` : `Tambah ${b.nama}`}>
                        {ada ? <><CheckCircle2 size={14} aria-hidden /> Dipilih</> : <><Plus size={14} aria-hidden /> Tambah</>}
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {katalog.total > katalog.rows.length && <p className="m-0 px-3 py-2 text-center text-[12px] text-ink3">Menampilkan {katalog.rows.length} dari {katalog.total}. Persempit dengan kata kunci.</p>}
            </div>
          </div>

          {/* ── pilihan Anda (menetap) */}
          <div className="border-t border-line pt-4" data-testid="rencana-pilihan">
            <h4 className="m-0 mb-1 text-[13px] font-semibold text-ink">Bahan dalam rencana ({ringkas.jumlahBahan})</h4>
            {!baris.length && <p className="m-0 rounded-btn bg-inset px-3 py-3 text-[13px] text-ink2">Belum ada bahan dipilih. Pilih dari daftar di atas — jumlah diisi setelahnya.</p>}
            {grupPilihan.map((g) => (
              <section key={g.kode} className="mb-2" aria-label={g.label}>
                <h5 className="m-0 mb-1 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-ink3">{g.label}</h5>
                <ul className="m-0 list-none divide-y divide-line rounded-btn bg-inset p-0">
                  {g.baris.map((b) => {
                    const salah = tampilGalatIsian ? validasi.galat[b.materialId] : null;
                    const kurang = ringkas.melebihiStok.includes(b.materialId);
                    return (
                      <li key={b.materialId} className="px-3 py-2" data-testid="rencana-pilihan-baris">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 basis-full sm:basis-0 sm:flex-1"><span className="block truncate text-[13px] font-medium text-ink">{b.nama}</span><span className="block text-[11.5px] text-ink3">{b.kode || "—"} · <span className={NADA_TEKS[ketersediaanNada(b)]}>{ketersediaanText(b)}</span></span></span>
                          <label className="ml-auto flex shrink-0 items-center gap-1.5 max-sm:ml-0"><span className="sr-only">Jumlah {b.nama}</span>
                            <input inputMode="decimal" value={b.qty} onChange={(e) => setBaris((x) => ubahJumlah(x, b.materialId, e.target.value))} aria-invalid={!!salah} data-testid="rencana-qty" placeholder="0"
                              className={cn("h-11 w-24 rounded-btn border bg-surface px-2 text-right text-[14px] tabular-nums text-ink outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30", salah ? "border-red" : "border-line")} />
                            <span className="w-10 text-[12px] text-ink3">{b.satuan}</span></label>
                          <button type="button" onClick={() => setBaris((x) => hapusBaris(x, b.materialId))} aria-label={`Hapus ${b.nama} dari rencana`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn text-ink3 outline-none hover:bg-hovertint hover:text-red focus-visible:ring-2 focus-visible:ring-accent/40"><Trash2 size={16} aria-hidden /></button>
                        </div>
                        {salah && <p role="alert" className="m-0 mt-1 text-[12px] text-red">{salah}</p>}
                        {kurang && <p className="m-0 mt-1 flex items-center gap-1 text-[12px] text-orange"><AlertTriangle size={12} aria-hidden /> Melebihi stok tersedia saat ini — rencana tetap boleh disimpan; Gudang menyediakan bahan.</p>}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>

          {/* ── bilah ringkasan + simpan, menetap di bawah area gulir */}
          <div className="sticky bottom-0 -mx-1 space-y-2 rounded-card bg-surface/95 px-1 pb-1 pt-2 backdrop-blur" data-testid="rencana-bilah">
            <p className="m-0 text-[12.5px] text-ink2" data-testid="rencana-ringkasan">
              <b className="text-ink">{ringkas.jumlahBahan} bahan</b>{ringkas.perKelompok.length > 0 && <> · {ringkas.perKelompok.map((k) => `${k.label} ${k.jumlah}`).join(" · ")}</>}
              {ringkas.jumlahStokTidakDiketahui > 0 && <> · <span className="text-ink3">{ringkas.jumlahStokTidakDiketahui} stok belum diketahui</span></>}
            </p>
            <input value={alasan} onChange={(e) => setAlasan(e.target.value)} maxLength={500} placeholder={plan ? "Alasan revisi (opsional)" : "Catatan (opsional)"} aria-label="Alasan revisi" data-testid="rencana-alasan"
              className="h-11 w-full rounded-btn border border-line bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30" />
            {galat && (
              <div role="alert" data-testid="rencana-galat" className={cn("rounded-btn px-3 py-2 text-[12.5px]", galat.jenis === "konflik" ? "bg-orangebg text-orange" : "bg-redbg text-red")}>
                <p className="m-0 font-medium">{galat.teks}</p>
                {galat.petunjuk && <p className="m-0 mt-0.5">{galat.petunjuk}</p>}
                {galat.muatUlang && <Button variant="secondary" size="sm" className="mt-2 min-h-[40px]" data-testid="rencana-muat-ulang" onClick={() => { setEdit(false); setSimpan({ sibuk: false, galat: null, sukses: "" }); onReload?.(); }}><X size={14} aria-hidden /> Buang isian &amp; muat versi terbaru</Button>}
              </div>
            )}
            {tampilGalatIsian && validasi.umum && <p role="alert" className="m-0 text-[12px] text-red">{validasi.umum}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="neutral" className="min-h-[44px]" onClick={batal} disabled={simpan.sibuk}>Batal</Button>
              <Button className="min-h-[44px]" data-testid="rencana-simpan" onClick={kirim} disabled={simpan.sibuk || (!baris.length) || (!!plan && !berubah)}>{simpan.sibuk ? "Menyimpan…" : plan ? "Simpan revisi" : "Simpan rencana"}</Button>
            </div>
            {!!plan && !berubah && <p className="m-0 text-right text-[11.5px] text-ink3">Belum ada perubahan dari revisi {plan.revision}.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
