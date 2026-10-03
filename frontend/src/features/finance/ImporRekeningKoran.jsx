import React, { useRef, useState } from "react";
import { Upload, FileSpreadsheet, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Modal } from "@/components/ui/modal.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Field } from "@/components/ui/field.jsx";
import { api } from "@/api.js";
import { formatUang, Pilihan, tanggalPendek } from "@/features/finance/shared.jsx";
import { BIDANG_PEMETAAN, pemetaanValid, pemetaanUntukServer } from "@/features/finance/rekonBankLogic.js";

// IMPOR REKENING KORAN (XLSX/CSV) — langkah: pilih berkas → pratinjau (pemetaan kolom otomatis, bisa diubah) → impor.
// Impor HANYA menyimpan salinan baris bank (tidak bisa diubah) — tidak pernah membuat jurnal atau mengubah saldo buku. Berkas yang sama persis / baris yang sudah ada dicegah.

export default function ImporRekeningKoran({ open, onOpenChange, rekening, onSelesai }) {
  const inputRef = useRef(null);
  const [berkas, setBerkas] = useState(null);
  const [pratinjau, setPratinjau] = useState(null);
  const [pemetaan, setPemetaan] = useState({});
  const [sibuk, setSibuk] = useState(false);
  const [galat, setGalat] = useState("");
  const [hasil, setHasil] = useState(null);

  function tutup(v) {
    if (!v) { setBerkas(null); setPratinjau(null); setPemetaan({}); setGalat(""); setHasil(null); }
    onOpenChange(v);
  }

  async function baca(file, peta = null) {
    setSibuk(true); setGalat("");
    try {
      const p = await api.pratinjauImporKoran(rekening.id, file, peta);
      setPratinjau(p);
      setPemetaan(Object.fromEntries(Object.entries(p.kolom.pemetaan).map(([k, v]) => [k, String(v)])));
    } catch (e) {
      setPratinjau(null);
      setGalat(e.message || "Berkas tidak bisa dibaca");
    } finally { setSibuk(false); }
  }

  const cekPeta = pemetaanValid(pemetaan);

  async function impor() {
    if (!berkas || !pratinjau) return;
    setSibuk(true); setGalat("");
    try {
      const r = await api.imporKoran(rekening.id, berkas, pemetaanUntukServer(pemetaan, pratinjau.kolom.barisJudul));
      setHasil(r);
      onSelesai?.(r);
    } catch (e) {
      setGalat(e.message || "Impor gagal");
    } finally { setSibuk(false); }
  }

  const headers = pratinjau?.kolom.headers || [];
  return (
    <Modal
      open={open} onOpenChange={tutup} title={`Impor rekening koran — ${rekening?.name ?? ""}`} className="w-[760px]"
      description="Mandiri (XLSX atau CSV). Hanya menyimpan salinan mutasi bank; tidak membuat jurnal dan tidak mengubah saldo buku."
      footer={hasil ? (
        <Button size="sm" onClick={() => tutup(false)}>Selesai</Button>
      ) : (
        <>
          <Button size="sm" variant="neutral" onClick={() => tutup(false)}>Batal</Button>
          <Button size="sm" onClick={impor} disabled={sibuk || !pratinjau?.bisaDiimpor || !cekPeta.ok}>
            {sibuk ? "Memproses…" : `Impor ${pratinjau?.jumlahBarisBaru ?? 0} baris`}
          </Button>
        </>
      )}
    >
      {hasil ? (
        <div className="space-y-2 text-[13px] text-ink" data-testid="impor-sukses">
          <p className="flex items-center gap-2 font-semibold text-green"><CheckCircle2 size={16} /> {hasil.jumlahBaris} baris diimpor ({tanggalPendek(hasil.tanggalAwal)} – {tanggalPendek(hasil.tanggalAkhir)})</p>
          {hasil.dilewati > 0 && <p className="text-ink2">{hasil.dilewati} baris sudah ada sebelumnya dan dilewati (tidak ganda).</p>}
          <p className="text-ink2">Total keluar {formatUang(hasil.totalDebit)} · total masuk {formatUang(hasil.totalKredit)}. Lanjutkan ke tab Pencocokan untuk mencocokkannya dengan buku.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Berkas rekening koran" hint="Format .xlsx atau .csv, maksimal 5 MB. Kop atau baris judul di atas tabel dibaca otomatis.">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={inputRef} type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { setBerkas(f); baca(f); } e.target.value = ""; }}
              />
              <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={sibuk}><Upload size={14} /> Pilih berkas</Button>
              {berkas && <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-ink2"><FileSpreadsheet size={14} className="shrink-0" /><span className="truncate">{berkas.name}</span></span>}
            </div>
          </Field>

          {galat && <p role="alert" className="flex items-start gap-2 rounded-lg bg-redbg p-3 text-[13px] text-ink"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-red" />{galat}</p>}

          {pratinjau && (
            <>
              <div className="grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
                <Ringkas label="Baris terbaca" nilai={pratinjau.jumlahBaris} />
                <Ringkas label="Baris baru" nilai={pratinjau.jumlahBarisBaru} />
                <Ringkas label="Sudah ada (dilewati)" nilai={pratinjau.jumlahGanda} />
                <Ringkas label="Tidak terbaca" nilai={pratinjau.jumlahGalat} tone={pratinjau.jumlahGalat ? "red" : undefined} />
                <Ringkas label="Total keluar (debit)" nilai={formatUang(pratinjau.totalDebit)} />
                <Ringkas label="Total masuk (kredit)" nilai={formatUang(pratinjau.totalKredit)} />
                <Ringkas label="Saldo awal berkas" nilai={pratinjau.saldoAwalBerkas ? formatUang(pratinjau.saldoAwalBerkas) : "—"} />
                <Ringkas label="Saldo akhir berkas" nilai={pratinjau.saldoAkhirBerkas ? formatUang(pratinjau.saldoAkhirBerkas) : "—"} />
              </div>
              {pratinjau.tanggalAwal && <p className="text-[12px] text-ink3">Periode berkas: {tanggalPendek(pratinjau.tanggalAwal)} – {tanggalPendek(pratinjau.tanggalAkhir)}{pratinjau.berkas.urutan === "TERBARU_DULU" ? " · berkas urut terbaru→terlama, dibalik otomatis" : ""}</p>}

              {pratinjau.alasanTidakBisa && <p role="alert" className="rounded-lg bg-orangebg p-3 text-[13px] text-ink">{pratinjau.alasanTidakBisa}</p>}
              {pratinjau.rantaiSaldo?.diperiksa && !pratinjau.rantaiSaldo.konsisten && (
                <p role="alert" className="rounded-lg bg-orangebg p-3 text-[13px] text-ink">Saldo di berkas tidak nyambung pada {pratinjau.rantaiSaldo.jumlahPutus} baris (mis. baris {pratinjau.rantaiSaldo.putus[0].noBaris}: seharusnya {formatUang(pratinjau.rantaiSaldo.putus[0].diharapkan)}, tertulis {formatUang(pratinjau.rantaiSaldo.putus[0].tertulis)}). Kemungkinan ada baris yang hilang di berkas. Impor tetap bisa dilakukan, tetapi selisih rekonsiliasi akan tampil sebagai "belum dijelaskan".</p>
              )}
              {pratinjau.galat.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-red">{pratinjau.galat.slice(0, 5).map((g) => <li key={g.noBaris}>Baris {g.noBaris}: {g.pesan}</li>)}</ul>
              )}

              <div>
                <p className="mb-2 text-[12.5px] font-semibold text-ink">Pemetaan kolom</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {BIDANG_PEMETAAN.map((b) => (
                    <Field key={b.kunci} label={b.label} required={b.wajib}>
                      <Pilihan value={pemetaan[b.kunci] ?? ""} onChange={(v) => setPemetaan((p) => ({ ...p, [b.kunci]: v }))}>
                        <option value="">— tidak dipakai —</option>
                        {headers.map((h, i) => <option key={i} value={i}>{h || `Kolom ${i + 1}`}</option>)}
                      </Pilihan>
                    </Field>
                  ))}
                </div>
                {!cekPeta.ok && <p className="mt-2 text-[12px] text-red">{cekPeta.sebab}</p>}
                <Button size="sm" variant="neutral" className="mt-2" onClick={() => baca(berkas, pemetaanUntukServer(pemetaan, pratinjau.kolom.barisJudul))} disabled={sibuk || !cekPeta.ok}>Terapkan pemetaan</Button>
              </div>

              <div>
                <p className="mb-2 text-[12.5px] font-semibold text-ink">Contoh baris ({Math.min(15, pratinjau.contoh.length)} pertama)</p>
                <ul className="list-none p-0 space-y-1.5">
                  {pratinjau.contoh.map((c) => (
                    <li key={c.noBaris} className="grid grid-cols-[auto_1fr_auto] items-start gap-x-3 rounded-lg bg-inset px-3 py-2 text-[12.5px]">
                      <span className="whitespace-nowrap text-ink2">{tanggalPendek(c.tanggal)}</span>
                      <span className="min-w-0 truncate">{c.deskripsi}{c.ganda && <Badge variant="neutral" className="ml-2 normal-case">sudah ada</Badge>}</span>
                      <span className={`whitespace-nowrap font-medium ${Number(c.kredit) > 0 ? "text-green" : "text-orange"}`}>{Number(c.kredit) > 0 ? `+${formatUang(c.kredit)}` : `−${formatUang(c.debit)}`}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function Ringkas({ label, nilai, tone }) {
  return (
    <div className="rounded-lg bg-inset px-3 py-2">
      <p className="text-[11.5px] text-ink3">{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${tone === "red" ? "text-red" : "text-ink"}`}>{nilai}</p>
    </div>
  );
}
