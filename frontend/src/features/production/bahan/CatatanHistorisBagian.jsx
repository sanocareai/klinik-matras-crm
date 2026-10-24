import React, { useRef, useState } from "react";
import { AlertTriangle, ChevronDown, FileSpreadsheet } from "lucide-react";
import { api } from "@/api.js";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { cn } from "@/lib/utils.js";
import { kunciIdempoten } from "@/features/production/orderProduksiModel.js";
import { JUDUL_CATATAN, KETERANGAN_CATATAN, NADA_STATE, SATUAN_KOREKSI, aksiCatatan, badgeHpp, kelompokkanCatatan, ringkasCatatan, teksNilai, validasiKoreksiCatatan, validasiKoreksiPemakaian } from "@/features/production/bahan/catatanHistorisModel.js";

// CATATAN PEMAKAIAN HISTORIS — tampil di Bahan (tab Ruang Kerja & drawer Order Produksi). Nilai asli apa adanya; "Perlu dicek" + catatan singkat; koreksi berjejak (alasan wajib).
const FIELD = "h-11 w-full rounded-btn border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-ink3 focus:border-accent focus-visible:ring-2 focus-visible:ring-accent/30 disabled:opacity-60";
const LABEL = "block text-[12px] font-medium text-ink3";

function FormAksi({ item, aksi, onSelesai, onBatal }) {
  const [f, setF] = useState({ qty: "", uom: item.satuan ?? "", alasan: "", qtyBaru: "" });
  const [galat, setGalat] = useState(""); const [ok, setOk] = useState(""); const [sibuk, setSibuk] = useState(false); const [pratinjau, setPratinjau] = useState(null);
  const kunciRef = useRef(null); const sigRef = useRef("");
  const sig = JSON.stringify([f, aksi]); if (sigRef.current !== sig) { sigRef.current = sig; kunciRef.current = null; }
  const set = (k, v) => { setF((x) => ({ ...x, [k]: v })); setGalat(""); setPratinjau(null); };

  async function lihat() {
    const v = validasiKoreksiPemakaian({ qtyBaru: f.qtyBaru, alasan: "alasan-sementara" }); if (!v.ok) { setGalat(v.galat); return; }
    setSibuk(true); try { setPratinjau(await api.pratinjauKoreksiPemakaian(item.unitId, { materialId: item.bahan.id, qtyBaru: v.qty })); } catch (e) { setGalat(e.message || "Pratinjau gagal."); } finally { setSibuk(false); }
  }
  async function kirim() {
    setGalat(""); kunciRef.current ??= kunciIdempoten("cph"); setSibuk(true);
    try {
      if (aksi === "koreksi") {
        const v = validasiKoreksiCatatan({ qty: f.qty, uom: f.uom, alasan: f.alasan }); if (!v.ok || (f.qty === "" && f.uom === (item.satuan ?? ""))) { setGalat(v.ok ? "Isi jumlah atau ubah satuan." : v.galat); return; }
        const body = { alasan: f.alasan.trim() }; if (f.qty !== "") body.qty = Number(String(f.qty).replace(",", ".")); if (f.uom && f.uom !== item.satuan) body.uom = f.uom;
        await api.koreksiCatatanHistoris(item.id, body, kunciRef.current); setOk("Koreksi tercatat (nilai asli berkas tetap tersimpan).");
      } else if (aksi === "konfirmasi") {
        const kode = (item.flags ?? []).find((x) => ["BARIS_BERULANG", "KATEGORI_KOMPLAIN"].includes(x.kode))?.kode;
        const v = validasiKoreksiCatatan({ alasan: f.alasan }); if (!v.ok) { setGalat(v.galat); return; }
        await api.konfirmasiCatatanHistoris(item.id, { kodePenanda: kode, alasan: f.alasan.trim() }, kunciRef.current); setOk("Dikonfirmasi wajar.");
      } else if (aksi === "kecualikan") {
        const v = validasiKoreksiCatatan({ alasan: f.alasan }); if (!v.ok) { setGalat(v.galat); return; }
        await api.kecualikanCatatanHistoris(item.id, { alasan: f.alasan.trim() }, kunciRef.current); setOk("Dikecualikan dari perhitungan (catatan tidak dihapus).");
      } else if (aksi === "koreksiPemakaian") {
        const v = validasiKoreksiPemakaian({ qtyBaru: f.qtyBaru, alasan: f.alasan }); if (!v.ok) { setGalat(v.galat); return; }
        await api.ajukanKoreksiPemakaian(item.unitId, { materialId: item.bahan.id, qtyBaru: v.qty, alasan: f.alasan.trim() }, kunciRef.current); setOk("Diajukan. Menunggu persetujuan penyetuju lain (stok belum berubah).");
      }
      kunciRef.current = null; await onSelesai?.();
    } catch (e) { setGalat(e.message || "Gagal menyimpan."); } finally { setSibuk(false); }
  }
  const judul = { koreksi: "Koreksi catatan", konfirmasi: "Konfirmasi wajar", kecualikan: "Kecualikan catatan", koreksiPemakaian: "Ajukan koreksi pemakaian" }[aksi];
  return (
    <div className="mt-2 space-y-3 rounded-btn bg-inset px-3 py-3" data-testid={`form-${aksi}`}>
      <p className="m-0 text-[13px] font-semibold text-ink">{judul}</p>
      {aksi === "koreksi" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1"><span className={LABEL}>Jumlah yang benar (kosongkan bila tidak berubah)</span><input value={f.qty} onChange={(e) => set("qty", e.target.value)} inputMode="decimal" className={FIELD} data-testid="cph-qty" placeholder={item.qtyAsli ?? ""} disabled={sibuk} /></label>
          <label className="block space-y-1"><span className={LABEL}>Satuan</span><select value={f.uom} onChange={(e) => set("uom", e.target.value)} className={FIELD} data-testid="cph-uom" disabled={sibuk}>{!SATUAN_KOREKSI.includes(f.uom) && <option value={f.uom}>{f.uom || "(belum ada)"}</option>}{SATUAN_KOREKSI.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </div>
      )}
      {aksi === "koreksiPemakaian" && (
        <div className="space-y-2">
          <label className="block space-y-1"><span className={LABEL}>Pemakaian yang benar ({item.bahan?.satuan})</span><input value={f.qtyBaru} onChange={(e) => set("qtyBaru", e.target.value)} inputMode="decimal" className={FIELD} data-testid="cph-qty-baru" disabled={sibuk} /></label>
          <Button variant="secondary" size="sm" className="min-h-[40px]" onClick={lihat} disabled={sibuk} data-testid="cph-pratinjau">Lihat dampak</Button>
          {pratinjau && (
            <p className="m-0 text-[12.5px] text-ink" data-testid="cph-dampak">Pemakaian {pratinjau.bersihSebelum} → {pratinjau.bersihSesudah} {item.bahan?.satuan}; stok {pratinjau.saldoSebelum} → {pratinjau.saldoSesudah}.{" "}
              {pratinjau.boleh ? (pratinjau.nilaiPerkiraan != null ? `Nilai perkiraan ${pratinjau.nilaiPerkiraan.toLocaleString("id-ID")} (bukan final).` : "Belum ada harga perolehan — nilai tidak dihitung (bukan Rp0).") : <b className="text-red">{pratinjau.penghalang?.[0]?.pesan}</b>}</p>
          )}
        </div>
      )}
      <label className="block space-y-1"><span className={LABEL}>Alasan (wajib)</span><textarea value={f.alasan} onChange={(e) => set("alasan", e.target.value)} rows={2} maxLength={500} className={cn(FIELD, "h-auto py-2")} data-testid="cph-alasan" disabled={sibuk} /></label>
      {galat && <p role="alert" className="m-0 text-[12.5px] text-red" data-testid="cph-galat">{galat}</p>}
      {ok && <p className="m-0 text-[12.5px] text-ink" data-testid="cph-ok">{ok}</p>}
      <div className="flex flex-wrap gap-2"><Button className="min-h-[44px]" onClick={kirim} disabled={sibuk} data-testid="cph-kirim">{sibuk ? "Menyimpan…" : "Simpan"}</Button><Button variant="neutral" className="min-h-[44px]" onClick={onBatal} disabled={sibuk}>Batal</Button></div>
    </div>
  );
}

function Baris({ item, izin, onDone }) {
  const [aksi, setAksi] = useState(null); const daftarAksi = aksiCatatan(item, izin);
  return (
    <li className="rounded-card border border-line px-3 py-3" data-testid="catatan-historis-baris" data-state={item.state}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13.5px] font-medium text-ink">{item.nama}{item.spesifikasi ? <span className="font-normal text-ink3"> · {item.spesifikasi}</span> : null}</p>
          <p className="m-0 text-[12px] text-ink3">{item.sumber}{item.kategori ? ` · ${item.kategori}` : ""}{item.bahan ? ` · ${item.bahan.kode}` : " · belum terpetakan ke katalog"}</p>
        </div>
        <span className="text-[14px] font-semibold tabular-nums text-ink" data-testid="catatan-nilai-asli" title="Nilai asli dari berkas">{teksNilai(item)}</span>
        <Badge variant={NADA_STATE[item.state] ?? "neutral"} data-testid="catatan-label">{item.label}</Badge>
      </div>
      {item.catatan && <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[12.5px] text-ink" data-testid="catatan-singkat"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-orange" aria-hidden /><span>{item.catatan}</span></p>}
      {item.pergerakan && <p className="m-0 mt-1 text-[12px] text-ink3">Tertaut ke pengeluaran stok {item.pergerakan.ref} (tidak digandakan).</p>}
      {daftarAksi.length > 0 && !aksi && <div className="mt-2 flex flex-wrap gap-2">{daftarAksi.map((a) => <Button key={a.key} variant="secondary" size="sm" className="min-h-[40px]" data-testid={`aksi-${a.key}`} onClick={() => setAksi(a.key)}>{a.label}</Button>)}</div>}
      {aksi && <FormAksi item={item} aksi={aksi} onSelesai={async () => { setAksi(null); await onDone?.(); }} onBatal={() => setAksi(null)} />}
    </li>
  );
}

/** Ringkasan satu baris untuk bagian Ringkasan panel: jumlah catatan + HPP parsial/final. Tidak menampilkan angka parsial sebagai final. */
export function CatatanRingkas({ data }) {
  const ch = data?.catatanHistoris; const hpp = badgeHpp(data?.hppBahan);
  if ((!ch || ch.ringkas.total === 0) && !hpp) return null;
  return (
    <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-ink2" data-testid="catatan-ringkasan">
      {ch && ch.ringkas.total > 0 && <span><b className="text-ink">Catatan pemakaian historis:</b> {ringkasCatatan(ch.ringkas)}</span>}
      {hpp && <Badge variant={hpp.tone}>{hpp.label}</Badge>}
    </p>
  );
}

export default function CatatanHistorisBagian({ data, unitId, izin = {}, onDone }) {
  const ch = data?.catatanHistoris; const [buka, setBuka] = useState(true); const [lihatSudah, setLihatSudah] = useState(false);
  if (!ch || ch.ringkas.total === 0) return null;
  const items = ch.items.map((i) => ({ ...i, unitId })); const g = kelompokkanCatatan(items); const hpp = badgeHpp(data.hppBahan);
  const izinLokal = { catatanHistoris: !!izin.catatanHistoris };
  return (
    <div className="space-y-2" data-testid="sec-catatan-historis">
      <button type="button" aria-expanded={buka} onClick={() => setBuka((v) => !v)} className="flex min-h-[44px] w-full items-center gap-2 text-left" data-testid="catatan-historis-toggle">
        <FileSpreadsheet size={15} className="shrink-0 text-ink3" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block text-[13px] font-semibold text-ink">{JUDUL_CATATAN}</span><span className="block text-[12px] text-ink2" data-testid="catatan-ringkas">{ringkasCatatan(ch.ringkas)}</span></span>
        <ChevronDown size={16} className={cn("shrink-0 text-ink3 transition-transform", buka && "rotate-180")} aria-hidden />
      </button>
      {buka && (
        <div className="space-y-3">
          <p className="m-0 text-[12px] text-ink3">{KETERANGAN_CATATAN}</p>
          {hpp && <p className="m-0 flex flex-wrap items-center gap-2 text-[12.5px] text-ink" data-testid="hpp-bahan"><Badge variant={hpp.tone}>{hpp.label}</Badge>{hpp.nilai != null && <span>Terhitung sejauh ini {hpp.nilai.toLocaleString("id-ID")}</span>}{hpp.detail && <span className="text-ink2">{hpp.detail}</span>}</p>}
          {g.perluDicek.length > 0 && <ul className="m-0 list-none space-y-2 p-0" data-testid="catatan-perlu-dicek">{g.perluDicek.map((i) => <Baris key={i.id} item={i} izin={izinLokal} onDone={onDone} />)}</ul>}
          {g.siap.length > 0 && <ul className="m-0 list-none space-y-2 p-0" data-testid="catatan-siap">{g.siap.map((i) => <Baris key={i.id} item={i} izin={izinLokal} onDone={onDone} />)}</ul>}
          {(g.sudah.length > 0 || g.lain.length > 0) && (
            <div>
              <Button variant="tertiary" size="sm" className="min-h-[40px]" onClick={() => setLihatSudah((v) => !v)} data-testid="catatan-sudah-toggle">{lihatSudah ? "Sembunyikan" : "Tampilkan"} yang sudah di stok / bukan stok ({g.sudah.length + g.lain.length})</Button>
              {lihatSudah && <ul className="m-0 mt-2 list-none space-y-2 p-0" data-testid="catatan-sudah">{[...g.sudah, ...g.lain].map((i) => <Baris key={i.id} item={i} izin={izinLokal} onDone={onDone} />)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
