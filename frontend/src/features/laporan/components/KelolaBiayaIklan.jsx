import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, Loader2, Pencil, Save, Eye, XCircle } from "lucide-react";
import { api } from "@/api.js";
import { Modal } from "@/components/ui/modal.jsx";
import { cn } from "@/lib/utils.js";
import { formKosong, validasiForm, bodyBiaya, ringkasRencana, ringkasHasil, SUMBER_FORM, kemarin, ringkasAsalBiaya, daftarPemilihan, ALASAN_TIDAK_DIPAKAI } from "../biayaIklanLogic.js";
import { statusBiayaTeks, rupiah, rupiahPersis, verifikasiLabel } from "../akuisisiLogic.js";
import { teksPeriode } from "../periodeLaporan.js";
import { ImporSpend } from "./IklanBiayaPanel.jsx";

// "Kelola biaya iklan" (ADMIN): biaya iklan tingkat SUMBER, diinput manual. Tidak mengubah campaign/ad set/ad/budget Meta, tidak meminta token/secret, dan tidak dialokasikan ke campaign.
//  A) Harian — satu tanggal WIB.   B) Total rentang — nominal untuk rentang PERSIS (tidak diprorata ke hari/campaign).   C) Impor detail Ad — jalur CSV yang sudah ada.
// Input ulang pada kunci yang sama memperbarui entri yang sama; setiap perubahan tercatat (nominal lama/baru, siapa, kapan, alasan). Pratinjau dulu (tidak menulis), baru Simpan.

const TAB = [{ id: "HARIAN", label: "Harian" }, { id: "TOTAL_RENTANG", label: "Total rentang" }, { id: "DETAIL_AD", label: "Impor detail Ad" }];
const NAMA_SUMBER = Object.fromEntries(SUMBER_FORM.map((s) => [s.id, s.label]));
const FIELD = "w-full min-w-0 rounded-btn border border-line bg-inset px-3 py-2 text-[13px] text-ink outline-none focus:border-accent";
const Galat = ({ t }) => (t ? <span role="alert" className="text-[11.5px] text-red">{t}</span> : null);
const waktu = (iso) => { try { return new Date(iso).toLocaleString("id-ID", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB"; } catch { return iso; } };

function Riwayat({ id }) {
  const [d, setD] = useState(null); const [galat, setGalat] = useState(null);
  useEffect(() => { api.getRiwayatBiayaSumber(id).then((r) => setD(r.riwayat)).catch((e) => setGalat(e?.message || "Gagal memuat riwayat")); }, [id]);
  if (galat) return <p className="text-[12px] text-red">{galat}</p>;
  if (!d) return <p className="text-[12px] text-ink3"><Loader2 size={12} className="mr-1 inline animate-spin" />Memuat riwayat…</p>;
  return (
    <ol className="space-y-1 text-[12px] text-ink2" aria-label="Riwayat perubahan">
      {d.map((r) => (
        <li key={r.revisi}><b>#{r.revisi} {r.aksi}</b> · {waktu(r.waktu)} · {r.nominalLama != null ? `${rupiahPersis(r.nominalLama)} → ` : ""}{rupiahPersis(r.nominalBaru)}{r.statusLama && r.statusLama !== r.statusBaru ? ` · ${r.statusLama} → ${r.statusBaru}` : ""} · <span className="t-secondary">“{r.alasan}”</span></li>
      ))}
    </ol>
  );
}

export default function KelolaBiayaIklan({ open, onOpenChange, periode, hariIni, sumberAwal = "TIKTOK", onTersimpan }) {
  const [tab, setTab] = useState("HARIAN");
  const bawaanDari = periode?.ok && periode.sampai < hariIni ? periode.sampai : kemarin(hariIni);
  const [form, setForm] = useState(() => formKosong({ sumber: sumberAwal, dari: bawaanDari }));
  const [rencana, setRencana] = useState(null);
  const [galat, setGalat] = useState(null);
  const [sibuk, setSibuk] = useState(false);
  const [data, setData] = useState(null);
  const [muat, setMuat] = useState(false);
  const [buka, setBuka] = useState(null);       // id entri yang riwayatnya terbuka
  const [batal, setBatal] = useState(null);     // { id, alasan }
  const [info, setInfo] = useState(null);

  const adaRentang = periode?.ok === true;
  const v = useMemo(() => validasiForm(form, hariIni), [form, hariIni]);

  const muatDaftar = useCallback(async () => {
    if (!adaRentang) { setData(null); return; }
    setMuat(true);
    try { setData(await api.getBiayaSumber({ dari: periode.dari, sampai: periode.sampai, batal: "1" })); } catch (e) { setGalat(e?.message || "Gagal memuat daftar biaya"); } finally { setMuat(false); }
  }, [adaRentang, periode?.dari, periode?.sampai]);
  useEffect(() => { if (open) muatDaftar(); }, [open, muatDaftar]);
  useEffect(() => { if (open) { setForm(formKosong({ sumber: sumberAwal, jenis: tab === "TOTAL_RENTANG" ? "TOTAL_RENTANG" : "HARIAN", dari: bawaanDari, sampai: bawaanDari })); setRencana(null); setGalat(null); setInfo(null); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, sumberAwal]);

  const ubah = (k, val) => { setForm((f) => { const n = { ...f, [k]: val, _sentuh: true }; if (k === "dari" && f.jenis === "HARIAN") n.sampai = val; return n; }); setRencana(null); setInfo(null); };
  const pilihTab = (t) => {
    setTab(t); setRencana(null); setGalat(null); setInfo(null);
    if (t !== "DETAIL_AD") setForm((f) => ({ ...f, jenis: t, sampai: t === "HARIAN" ? f.dari : (periode?.ok ? periode.sampai : f.dari), dari: t === "TOTAL_RENTANG" && periode?.ok ? periode.dari : f.dari, _sentuh: false }));
  };

  async function kirim(dryRun) {
    setForm((f) => ({ ...f, _sentuh: true }));
    if (!v.valid) { setGalat("Periksa isian yang bertanda merah."); return; }
    setSibuk(true); setGalat(null); setInfo(null);
    try {
      const r = await api.simpanBiayaSumber(bodyBiaya(form, { dryRun }));
      if (dryRun) setRencana(r);
      else { setRencana(null); setInfo(r.ditulis ? `Tersimpan — ${ringkasHasil(r)}` : "Tidak ada perubahan — nilai sama dengan entri yang sudah ada."); await muatDaftar(); onTersimpan?.(); setForm((f) => ({ ...f, nominal: "", alasan: "", konfirmasiNol: false, _sentuh: false })); }
    } catch (e) {
      setRencana(null);
      const konflik = e?.detail?.konflik;
      setGalat(e?.code === "BIAYA_KONFLIK" && konflik ? `${e.message}. Bentrok dengan: ${konflik.map((k) => `${k.jenis === "HARIAN" ? k.dari : `${k.dari}–${k.sampai}`} (${rupiahPersis(k.nominal)})`).join("; ")}.` : (e?.message || "Gagal menyimpan"));
    } finally { setSibuk(false); }
  }
  async function batalkan() {
    if (!batal) return;
    if (String(batal.alasan || "").trim().length < 5) { setGalat("Alasan pembatalan wajib (min. 5 karakter)."); return; }
    setSibuk(true); setGalat(null);
    try { await api.batalkanBiayaSumber(batal.id, batal.alasan.trim()); setBatal(null); setInfo("Entri dibatalkan (tidak dihapus; riwayat tetap ada)."); await muatDaftar(); onTersimpan?.(); } catch (e) { setGalat(e?.message || "Gagal membatalkan"); } finally { setSibuk(false); }
  }
  function sunting(e) {
    setTab(e.kind); setRencana(null); setInfo(null); setGalat(null);
    setForm({ sumber: e.sourceId, jenis: e.kind, dari: e.dateFrom, sampai: e.dateTo, akun: e.accountId || "", nominal: String(e.amount), alasan: "", konfirmasiNol: Number(e.amount) === 0, gantiDetailAd: e.override === true, _sentuh: false });
  }

  const entri = (data?.entri || []);
  const G = form._sentuh ? v.galat : {};
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Kelola biaya iklan" description="Biaya tingkat SUMBER — tidak mengubah campaign, ad set, ad, atau budget Meta."
      className="w-[780px]" footer={<button className="btn btn-ghost btn-sm" onClick={() => onOpenChange(false)}>Tutup</button>}>
      <div className="flex flex-col gap-4 text-[12.5px] text-ink2">
        <div role="tablist" aria-label="Jenis input biaya" className="inline-flex w-full flex-wrap items-center gap-1 rounded-btn bg-inset p-0.5">
          {TAB.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => pilihTab(t.id)} className={cn("flex-1 rounded-btn px-3 py-1.5 text-[12.5px]", tab === t.id ? "bg-surface font-semibold text-ink shadow-card" : "text-ink3")}>{t.label}</button>
          ))}
        </div>

        {tab === "DETAIL_AD" ? (
          <div className="flex flex-col gap-2">
            <p>Impor CSV Ads Manager level <b>Ad</b> (jalur yang sama dengan tab Iklan). Detail Ad per hari <b>diutamakan</b> atas biaya manual di tingkat sumber — keduanya tidak pernah dijumlah.</p>
            <ImporSpend onSelesai={() => { muatDaftar(); onTersimpan?.(); }} />
          </div>
        ) : (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); kirim(true); }} noValidate>
            <p className="t-secondary">
              {tab === "HARIAN" ? "Satu tanggal WIB (sebelum hari ini). Input ulang pada sumber+tanggal+akun yang sama memperbarui entri yang sama." : "Nominal untuk rentang PERSIS ini — hanya dipakai bila periode laporan memuat seluruh rentangnya; tidak pernah dibagi per hari atau per campaign."}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">Sumber
                <select className={FIELD} value={form.sumber} onChange={(e) => ubah("sumber", e.target.value)} aria-invalid={!!G.sumber}>{SUMBER_FORM.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select><Galat t={G.sumber} />
              </label>
              <label className="flex flex-col gap-1">ID akun iklan (opsional)
                <input className={FIELD} inputMode="numeric" value={form.akun} onChange={(e) => ubah("akun", e.target.value)} placeholder="kosong = semua akun" aria-invalid={!!G.akun} /><Galat t={G.akun} />
              </label>
              <label className="flex flex-col gap-1">{tab === "HARIAN" ? "Tanggal (WIB)" : "Dari (WIB)"}
                <input className={FIELD} type="date" max={kemarin(hariIni)} value={form.dari} onChange={(e) => ubah("dari", e.target.value)} aria-invalid={!!G.dari} /><Galat t={G.dari} />
              </label>
              {tab === "TOTAL_RENTANG" && (
                <label className="flex flex-col gap-1">Sampai (WIB)
                  <input className={FIELD} type="date" max={kemarin(hariIni)} value={form.sampai} onChange={(e) => ubah("sampai", e.target.value)} aria-invalid={!!G.sampai} /><Galat t={G.sampai} />
                </label>
              )}
              <label className="flex flex-col gap-1">Nominal (IDR)
                <input className={FIELD} inputMode="decimal" value={form.nominal} onChange={(e) => ubah("nominal", e.target.value)} placeholder="1500000" aria-invalid={!!G.nominal} /><Galat t={G.nominal} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">Alasan / sumber angka (wajib, tercatat di riwayat)
                <input className={FIELD} value={form.alasan} maxLength={300} onChange={(e) => ubah("alasan", e.target.value)} placeholder="mis. Invoice TikTok Ads no. …, atau Ads Manager 25 Okt" aria-invalid={!!G.alasan} /><Galat t={G.alasan} />
              </label>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {Number(String(form.nominal).trim()) === 0 && String(form.nominal).trim() !== "" && (
                <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.konfirmasiNol} onChange={(e) => ubah("konfirmasiNol", e.target.checked)} /> Saya konfirmasi biaya memang <b>Rp0</b> (bukan belum diisi)</label>
              )}
              {form.sumber === "META" && (
                <label className="inline-flex items-center gap-2" title="Hanya bila total manual lebih benar daripada detail Ad (Windsor/API/CSV). Detail Ad tetap dipakai laporan campaign."><input type="checkbox" checked={form.gantiDetailAd} onChange={(e) => ubah("gantiDetailAd", e.target.checked)} /> Ganti detail Ad pada tingkat sumber (alasan wajib)</label>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className="btn btn-ghost btn-sm" disabled={sibuk}>{sibuk ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Pratinjau</button>
              <button type="button" className="btn btn-primary btn-sm" disabled={sibuk || !rencana || rencana.aksi === "KONFLIK" || rencana.aksi === "TIDAK_BERUBAH"} onClick={() => kirim(false)}><Save size={14} /> Simpan</button>
              {rencana && <span className="text-[12.5px] text-ink" role="status">{ringkasRencana(rencana)}</span>}
            </div>
          </form>
        )}

        {galat && <p role="alert" className="flex items-start gap-2 text-red"><AlertTriangle size={15} className="mt-0.5 shrink-0" /> {galat}</p>}
        {info && <p role="status" className="text-green">{info}</p>}

        {adaRentang ? (
          <section aria-label="Cakupan dan entri biaya" className="flex flex-col gap-2">
            <h4 className="text-[13px] font-semibold text-ink">Biaya periode {teksPeriode(periode.dari, periode.sampai)} {muat && <Loader2 size={12} className="ml-1 inline animate-spin" />}</h4>
            {data && Object.entries(data.cakupan).map(([sid, c]) => (
              <div key={sid} className="rounded-btn bg-inset p-2.5">
                <p><b className="text-ink">{NAMA_SUMBER[sid] || sid}</b> — {statusBiayaTeks(c.status)}{c.spend != null ? ` · ${rupiah(c.spend)}` : ""}</p>
                {ringkasAsalBiaya(c).length > 0 && <p className="t-secondary">{ringkasAsalBiaya(c).join(" · ")}</p>}
                {c.verifikasi && c.status !== "BELUM_DIISI" && <p className="t-secondary">Verifikasi: {verifikasiLabel(c.verifikasi)}</p>}
                <ul aria-label="Sumber biaya yang dipakai dan alasannya" className="mt-1 space-y-0.5 text-[11.5px]">
                  {daftarPemilihan(c).map((p) => <li key={p.kunci} className={p.peringatan ? "text-orange" : "t-secondary"}>{p.hari != null ? <b>{p.hari} hari · </b> : null}{p.teks}</li>)}
                </ul>
                {(c.hariHilang || []).length > 0 && <p className="t-secondary">Hari belum ada data: {c.hariHilang.slice(0, 12).join(", ")}{c.hariHilang.length > 12 ? ` … (+${c.hariHilang.length - 12})` : ""}</p>}
                {(c.biayaBulananPengaturan || []).length > 0 && (
                  <p className="t-secondary">Biaya bulanan Pengaturan Sales: {c.biayaBulananPengaturan.map((b) => `${String(b.bulan).padStart(2, "0")}/${b.tahun} ${rupiah(b.nominal)} (${b.dipakai ? "dipakai" : ALASAN_TIDAK_DIPAKAI[b.alasan] || "tidak dipakai"})`).join("; ")}</p>
                )}
              </div>
            ))}
            {entri.length === 0 && !muat && <p className="t-secondary">Belum ada entri manual pada periode ini.</p>}
            {entri.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-[12px]">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wide text-ink3"><th className="py-1 pr-2">Sumber</th><th className="py-1 pr-2">Jenis</th><th className="py-1 pr-2">Tanggal</th><th className="py-1 pr-2 text-right">Nominal</th><th className="py-1 pr-2">Status</th><th className="py-1" /></tr></thead>
                  <tbody>
                    {entri.map((e) => (
                      <React.Fragment key={e.id}>
                        <tr className="border-t border-line/60 align-top">
                          <td className="py-1.5 pr-2">{NAMA_SUMBER[e.sourceId] || e.sourceId}{e.accountId ? <span className="t-secondary block">akun {e.accountId}</span> : null}</td>
                          <td className="py-1.5 pr-2">{e.kind === "HARIAN" ? "Harian" : "Total rentang"}{e.override ? <span className="t-secondary block">ganti detail Ad</span> : null}</td>
                          <td className="py-1.5 pr-2 tabular-nums">{e.dateFrom === e.dateTo ? e.dateFrom : `${e.dateFrom} – ${e.dateTo}`}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{rupiahPersis(e.amount)}</td>
                          <td className="py-1.5 pr-2">{e.status === "AKTIF" ? "Aktif" : <span className="text-ink3">Dibatalkan</span>} <span className="t-secondary">rev {e.revision}</span></td>
                          <td className="py-1.5 text-right">
                            <span className="inline-flex gap-1">
                              <button type="button" className="btn btn-ghost btn-sm" aria-label="Ubah entri" onClick={() => sunting(e)}><Pencil size={13} /></button>
                              {e.status === "AKTIF" && <button type="button" className="btn btn-ghost btn-sm" aria-label="Batalkan entri" onClick={() => setBatal({ id: e.id, alasan: "" })}><XCircle size={13} /></button>}
                              <button type="button" className="btn btn-ghost btn-sm" aria-label="Riwayat entri" aria-expanded={buka === e.id} onClick={() => setBuka(buka === e.id ? null : e.id)}><History size={13} /></button>
                            </span>
                          </td>
                        </tr>
                        {batal?.id === e.id && (
                          <tr><td colSpan={6} className="pb-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <input className={cn(FIELD, "min-w-[200px] flex-1")} placeholder="Alasan pembatalan (wajib)" value={batal.alasan} onChange={(ev) => setBatal({ ...batal, alasan: ev.target.value })} />
                              <button type="button" className="btn btn-danger btn-sm" disabled={sibuk} onClick={batalkan}>Batalkan entri</button>
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBatal(null)}>Tidak jadi</button>
                            </div>
                          </td></tr>
                        )}
                        {buka === e.id && <tr><td colSpan={6} className="pb-2"><Riwayat id={e.id} /></td></tr>}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : (
          <p className="t-secondary">Pilih periode tertutup (maks. 93 hari) di filter tanggal untuk melihat cakupan dan daftar entri.</p>
        )}
      </div>
    </Modal>
  );
}
