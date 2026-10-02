import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link2, Wand2, Ban, Undo2, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Input } from "@/components/ui/input.jsx";
import { Field } from "@/components/ui/field.jsx";
import { Modal } from "@/components/ui/modal.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { api } from "@/api.js";
import { Uang, formatUang, KartuAngka, JudulKartu, Pilihan, tanggalPendek } from "@/features/finance/shared.jsx";
import TombolExportExcel, { labelFilterAktif } from "@/features/finance/ExportExcel.jsx";
import { statusTampil, KATEGORI, ringkasPilihan, bisaCocokkan, bisaKecualikan, dariSen } from "@/features/finance/rekonBankLogic.js";

// PENCOCOKAN BANK ↔ BUKU — memasangkan baris rekening koran dengan baris jurnal rekening ini. Tidak membuat jurnal: baris bank yang tidak ada di buku tetap "Belum ada di buku"
// sampai Finance mencatat dokumennya lewat alur normal. Pasangan harus SEIMBANG persis (total bank = total buku); alasan wajib untuk pencocokan manual dan pengecualian.

export default function PencocokanBank({ rek, sampai, sakelar, dari = null, onBerubah }) {
  const [data, setData] = useState(null);
  const [memuat, setMemuat] = useState(true);
  const [galat, setGalat] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [pilihBank, setPilihBank] = useState([]);
  const [pilihBuku, setPilihBuku] = useState([]);
  const [alasan, setAlasan] = useState("");
  const [kategori, setKategori] = useState("");
  const [lepas, setLepas] = useState(null); // { id, alasan, galat }
  const [kerja, setKerja] = useState(false);
  const permintaan = useRef(0);

  const muat = useCallback(async () => {
    const no = ++permintaan.current;
    setMemuat(true); setGalat(null);
    try {
      const d = await api.getRekonPencocokan(rek.id, { to: sampai, from: dari });
      if (no === permintaan.current) { setData(d); setPilihBank((p) => p.filter((id) => d.bank.some((b) => b.id === id))); setPilihBuku((p) => p.filter((id) => d.buku.some((b) => b.id === id))); }
    } catch (e) {
      if (no === permintaan.current) setGalat(e.message || "Gagal memuat pencocokan");
    } finally {
      if (no === permintaan.current) setMemuat(false);
    }
  }, [rek.id, sampai, dari]);
  useEffect(() => { muat(); }, [muat]);

  const bankPilihan = useMemo(() => (data?.bank || []).filter((b) => pilihBank.includes(b.id)), [data, pilihBank]);
  const bukuPilihan = useMemo(() => (data?.buku || []).filter((b) => pilihBuku.includes(b.id)), [data, pilihBuku]);
  const ringkas = ringkasPilihan(bankPilihan, bukuPilihan);
  const cek = bisaCocokkan(ringkas, alasan);
  const toggle = (setter) => (id) => setter((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function jalankan(fn, sukses) {
    setKerja(true); setPesan(null); setGalat(null);
    try {
      const r = await fn();
      setPesan(sukses(r));
      setPilihBank([]); setPilihBuku([]); setAlasan(""); setKategori("");
      await muat(); onBerubah?.();
    } catch (e) {
      setGalat(e.code === "SAKELAR_MATI" ? "Rekonsiliasi Bank V2 belum diaktifkan. Admin/Owner menyalakannya di Finance › Pengaturan." : e.message);
    } finally { setKerja(false); }
  }
  const cocokkan = () => jalankan(() => api.cocokkanBank(rek.id, { bankLineIds: pilihBank, journalLineIds: pilihBuku, alasan, kategori: kategori || undefined }), (r) => `Pencocokan ${r.bentuk} dibuat (${formatUang(r.total)}).`);
  const kecualikan = () => jalankan(() => api.kecualikanBank(rek.id, { bankLineIds: pilihBank, journalLineIds: pilihBuku, alasan }), () => "Baris dikecualikan dari pencocokan (tercatat dengan alasan).");
  const otomatis = () => jalankan(() => api.cocokkanOtomatisBank(rek.id, { to: sampai }), (r) => `${r.dicocokkan} pasangan 1:1 dicocokkan otomatis. Yang ambigu tidak disentuh.`);
  async function lepaskan() {
    try {
      await api.lepasPencocokanBank(lepas.id, lepas.alasan);
      setLepas(null); setPesan("Pencocokan dibatalkan; riwayat tetap tersimpan."); await muat(); onBerubah?.();
    } catch (e) { setLepas((l) => ({ ...l, galat: e.message })); }
  }

  function pilihKombinasi(k) { setPilihBank(k.bankIds); setPilihBuku(k.bukuIds); setAlasan((a) => a || "Pencocokan sesuai saran sistem (jumlah sama persis)"); }

  const r = data?.ringkasan;
  const adaData = r?.adaDataBank;
  return (
    <>
      {galat && <Card className="bg-redbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p role="alert" className="text-[13px] text-ink">{galat}</p><Button size="sm" variant="neutral" onClick={() => setGalat(null)}>Tutup</Button></CardContent></Card>}
      {pesan && <Card className="bg-greenbg"><CardContent className="flex items-center justify-between gap-3 py-3"><p className="text-[13px] text-ink">{pesan}</p><Button size="sm" variant="neutral" onClick={() => setPesan(null)}>Tutup</Button></CardContent></Card>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KartuAngka label="Bank belum dicocokkan" metrik="bank_belum_dibukukan" value={String(r?.bankBelumDicocokkan ?? 0)} tone={r?.bankBelumDicocokkan ? "red" : "default"} sub={r ? `bersih ${formatUang(r.nilaiBankBelum)}` : ""} info="Baris rekening koran yang belum ada pasangannya di buku. Mengandung uang yang mungkin belum dicatat." />
        <KartuAngka label="Buku belum dicocokkan" value={String(r?.bukuBelumDicocokkan ?? 0)} tone={r?.bukuBelumDicocokkan ? "orange" : "default"} sub={r ? `bersih ${formatUang(r.nilaiBukuBelum)}` : ""} info="Baris jurnal rekening ini yang belum muncul di rekening koran. Jurnal beserta pembaliknya yang saling meniadakan tidak dihitung." />
        <KartuAngka label="Disarankan" value={String(r?.disarankan ?? 0)} sub="ada kandidat — perlu konfirmasi" />
        <KartuAngka label="Cocok / dikecualikan" value={`${r?.cocok ?? 0} / ${r?.dikecualikan ?? 0}`} sub="kelompok pencocokan aktif" />
      </div>

      <Card className="overflow-hidden">
        <JudulKartu title="Cocokkan" description="Pilih baris di kedua sisi. Pencocokan hanya sah bila total bank sama persis dengan total buku." />
        <CardContent className="space-y-3 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={otomatis} disabled={!sakelar || kerja || !(r?.bisaOtomatis > 0)} title="Hanya pasangan 1:1 dengan nominal sama, selisih tanggal ≤ 3 hari, dan tidak ada kandidat lain">
              <Wand2 size={14} /> Cocokkan otomatis{r?.bisaOtomatis ? ` (${r.bisaOtomatis})` : ""}
            </Button>
            <TombolExportExcel
              modul="pencocokan-bank" disabled={!adaData}
              ambilBody={() => ({ periode: { from: dari || undefined, to: sampai }, filter: { cashAccountId: rek.id }, filterLabel: labelFilterAktif([["Rekening", rek.name], ["Sampai", sampai]]) })}
            />
            {!sakelar && <span className="text-[12.5px] text-ink3">Pencocokan belum diaktifkan (Finance › Pengaturan › Rekonsiliasi Bank V2).</span>}
          </div>

          {(bankPilihan.length > 0 || bukuPilihan.length > 0) && (
            <div className="rounded-lg bg-inset p-3 text-[13px]" data-testid="ringkas-pilihan">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>Bank: <strong>{formatUang(dariSen(ringkas.totalBank))}</strong> ({ringkas.jumlahBank} baris)</span>
                <span>Buku: <strong>{formatUang(dariSen(ringkas.totalBuku))}</strong> ({ringkas.jumlahBuku} baris)</span>
                <Badge variant={ringkas.seimbang ? "green" : "orange"} className="normal-case">{ringkas.seimbang ? `Seimbang ${ringkas.bentuk}` : ringkas.jumlahBank && ringkas.jumlahBuku ? "Tidak seimbang" : "Pilih kedua sisi"}</Badge>
              </p>
              {ringkas.jumlahBank > 0 && ringkas.jumlahBuku > 0 && !ringkas.seimbang && <p className="mt-1 text-[12.5px] text-orange">{ringkas.teksSelisih}</p>}
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_200px]">
                <Field label="Alasan" hint="Wajib, minimal 10 karakter. Tercatat di audit."><Input value={alasan} onChange={(e) => setAlasan(e.target.value)} placeholder="mis. transfer supplier + biaya BI-FAST" /></Field>
                <Field label="Kategori (opsional)"><Pilihan value={kategori} onChange={setKategori}><option value="">Otomatis</option>{Object.entries(KATEGORI).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Pilihan></Field>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={cocokkan} disabled={!sakelar || kerja || !cek.ok} title={cek.sebab || ""}><Link2 size={14} /> Cocokkan</Button>
                <Button size="sm" variant="neutral" onClick={kecualikan} disabled={!sakelar || kerja || !bisaKecualikan(bankPilihan.length + bukuPilihan.length, alasan)} title="Kecualikan baris terpilih dari pencocokan (alasan wajib; butuh persetujuan)"><Ban size={14} /> Kecualikan</Button>
                <Button size="sm" variant="neutral" onClick={() => { setPilihBank([]); setPilihBuku([]); }}>Kosongkan pilihan</Button>
                {!cek.ok && ringkas.jumlahBank > 0 && ringkas.jumlahBuku > 0 && <span className="text-[12px] text-ink3">{cek.sebab}</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!adaData && !memuat ? (
        <Card><CardContent><EmptyState icon={Link2} title="Belum ada rekening koran" description="Impor mutasi bank dulu di tab Mutasi Rekening, lalu cocokkan di sini." /></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DaftarSisi judul="Baris bank belum dicocokkan" sub="Menurut rekening koran" kosong="Semua baris bank sudah dicocokkan atau dikecualikan." items={data?.bank || []} dipilih={pilihBank} onToggle={toggle(setPilihBank)} sisi="bank" />
          <DaftarSisi judul="Baris buku belum dicocokkan" sub="Menurut jurnal rekening ini" kosong="Semua baris buku sudah dicocokkan." items={data?.buku || []} dipilih={pilihBuku} onToggle={toggle(setPilihBuku)} sisi="buku" />
        </div>
      )}
      {(r?.bukuSebelumDataBank ?? 0) > 0 && <p className="text-[12px] text-ink3">{r.bukuSebelumDataBank} baris buku bertanggal jauh sebelum data bank pertama tidak ditampilkan (sudah tercakup saldo awal rekening koran; lihat tab Rekonsiliasi).{r.penyesuaianBuku ? ` ${r.penyesuaianBuku} jurnal penyesuaian saldo bukan transaksi bank dan tidak dicocokkan.` : ""}</p>}

      {(data?.kombinasi || []).length > 0 && (
        <Card className="overflow-hidden">
          <JudulKartu title="Saran kombinasi (1:N / N:1)" description="Beberapa baris yang jumlahnya sama persis. Tidak pernah dicocokkan otomatis — pilih lalu konfirmasi manual." />
          <CardContent className="space-y-2 pb-4">
            {data.kombinasi.map((k, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                <span className="min-w-0 flex-1">
                  <Badge variant={k.ambigu ? "orange" : "accent"} className="mr-2 normal-case">{k.bentuk}{k.ambigu ? " · ambigu" : ""}</Badge>
                  Bank: {k.bank.map((b) => `${b.masuk ? "+" : "−"}${formatUang(b.masuk || b.keluar)}`).join(" , ")} ↔ Buku: {k.buku.map((j) => `${j.masuk ? "+" : "−"}${formatUang(j.masuk || j.keluar)} (${j.nomor})`).join(" , ")}
                </span>
                <Button size="sm" variant="neutral" onClick={() => pilihKombinasi(k)}><Sparkles size={13} /> Pilih</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="overflow-hidden">
        <JudulKartu title="Pencocokan & pengecualian aktif" description="Riwayat tidak dihapus: membatalkan pencocokan hanya menandainya dibatalkan." />
        <CardContent className="space-y-2 pb-4">
          {(data?.kelompok || []).length === 0 ? <p className="py-4 text-center text-[13px] text-ink3">Belum ada pencocokan.</p> : data.kelompok.map((g) => (
            <div key={g.id} className="rounded-lg bg-inset px-3 py-2 text-[12.5px]" data-testid="kelompok-aktif">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant={g.jenis === "KECUALI" ? "neutral" : "green"} className="normal-case">{g.jenis === "KECUALI" ? "Dikecualikan" : g.jenis === "OTOMATIS" ? "Cocok otomatis" : "Cocok manual"}</Badge>
                  <span className="text-ink2">{g.bentuk}{g.kategoriLabel ? ` · ${g.kategoriLabel}` : ""}</span>
                </span>
                <Button size="sm" variant="neutral" onClick={() => setLepas({ id: g.id, alasan: "" })} disabled={!sakelar}><Undo2 size={13} /> Lepas</Button>
              </div>
              {g.alasan && <p className="mt-1 text-ink3">{g.alasan}</p>}
              <ul className="list-none p-0 mt-1 space-y-0.5 text-ink2">
                {g.bank.map((b) => <li key={b.id} className="truncate">Bank {tanggalPendek(b.tanggal)} · {b.deskripsi} · {b.masuk ? `+${formatUang(b.masuk)}` : `−${formatUang(b.keluar)}`}</li>)}
                {g.buku.map((j) => <li key={j.id} className="truncate">Buku {tanggalPendek(j.tanggalBuku)} · {j.nomor} · {j.deskripsi} · {j.masuk ? `+${formatUang(j.masuk)}` : `−${formatUang(j.keluar)}`}</li>)}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Modal
        open={!!lepas} onOpenChange={(v) => !v && setLepas(null)} title="Batalkan pencocokan" description="Baris kembali menjadi 'belum dicocokkan'. Riwayat pencocokan tetap tersimpan."
        footer={<><Button size="sm" variant="neutral" onClick={() => setLepas(null)}>Kembali</Button><Button size="sm" onClick={lepaskan} disabled={(lepas?.alasan || "").trim().length < 10}>Batalkan pencocokan</Button></>}
      >
        {lepas && <div className="space-y-2"><Field label="Alasan" required hint="Minimal 10 karakter."><Input value={lepas.alasan} onChange={(e) => setLepas((l) => ({ ...l, alasan: e.target.value }))} /></Field>{lepas.galat && <p role="alert" className="text-[12.5px] text-red">{lepas.galat}</p>}</div>}
      </Modal>
    </>
  );
}

function DaftarSisi({ judul, sub, kosong, items, dipilih, onToggle, sisi }) {
  return (
    <Card className="overflow-hidden">
      <JudulKartu title={judul} description={sub} />
      <CardContent className="pb-4">
        {items.length === 0 ? <p className="py-6 text-center text-[13px] text-ink3">{kosong}</p> : (
          <ul className="list-none p-0 space-y-1.5" data-testid={`daftar-${sisi}`}>
            {items.map((b) => {
              const aktif = dipilih.includes(b.id);
              const st = statusTampil(b.status);
              return (
                <li key={b.id}>
                  <label className={`flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-[12.5px] ${aktif ? "bg-accentbg" : "bg-inset"}`}>
                    <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={aktif} onChange={() => onToggle(b.id)} aria-label={`Pilih ${b.deskripsi}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate font-medium text-ink">{b.deskripsi}</span>
                        <span className="whitespace-nowrap tabular-nums">{b.masuk ? <Uang value={b.masuk} className="text-green" /> : <Uang value={b.keluar} className="text-orange" />}</span>
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-ink3">
                        <span>{tanggalPendek(b.tanggalBuku ?? b.tanggal)}</span>
                        {b.nomor && <span className="font-mono">{b.nomor}</span>}
                        {b.referensi && <span className="font-mono">{b.referensi}</span>}
                        <Badge variant={st.variant} className="normal-case">{st.label}</Badge>
                      </span>
                      {b.kandidat?.length > 0 && <span className="mt-1 block truncate text-[11.5px] text-ink3">Kandidat: {b.kandidat.map((k) => k.nomor || k.deskripsi).join("; ")}</span>}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
