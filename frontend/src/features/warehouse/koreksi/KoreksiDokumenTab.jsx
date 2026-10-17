import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Loader2, CheckCircle2, XCircle, Ban, ClipboardCheck } from "lucide-react";
import { api } from "@/api.js";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { bolehMenyetujui } from "@/features/warehouse/penyesuaianLogic.js";
import { STATUS_KOREKSI, JENIS_KOREKSI, JENIS_OPERASI, barisPerubahan, bolehBatal, bolehSetujui, alasanTidakBolehSetujui } from "./koreksiLogic.js";

function pengguna() { try { return JSON.parse(localStorage.getItem("user")) || {}; } catch { return {}; } }
const FILTER = [{ key: "PENDING_APPROVAL", label: "Menunggu persetujuan" }, { key: "", label: "Semua" }, { key: "POSTED", label: "Diterapkan" }, { key: "REJECTED", label: "Ditolak" }, { key: "CANCELLED", label: "Dibatalkan" }];

function Detail({ k, aksi }) {
  const u = pengguna(); const roles = u.roles || (u.role ? [u.role] : []);
  const [catatan, setCatatan] = useState(""); const [busy, setBusy] = useState(false); const [galat, setGalat] = useState("");
  const boleh = bolehMenyetujui(roles) && bolehSetujui(k, u.id); const batal = bolehBatal(k, u.id);
  const alasanTidak = bolehMenyetujui(roles) ? alasanTidakBolehSetujui(k, u.id) : "";
  async function jalan(fn, pesanGalat) { setBusy(true); setGalat(""); try { await fn(); await aksi(); } catch (e) { setGalat(e.message || pesanGalat); } finally { setBusy(false); } }
  const baris = barisPerubahan(k.perubahan);
  return (
    <div className="space-y-2 border-t border-line px-3 py-2.5 text-[12px]" data-testid="detail-koreksi">
      <p className="m-0 text-ink2"><strong>Alasan:</strong> {k.alasan}</p>
      <div>
        <h5 className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Sebelum → sesudah</h5>
        <ul className="m-0 list-none space-y-0.5 p-0" data-testid="perubahan-koreksi">
          {baris.map((b, i) => <li key={i} className="text-ink2"><span className="text-ink3">{b.bagian} · </span>{b.bidang}: <span className="line-through">{b.sebelum}</span> → <strong className="text-ink">{b.sesudah}</strong></li>)}
        </ul>
      </div>
      {k.pratinjau?.operasi?.length > 0 && (
        <div>
          <h5 className="mb-1 text-[10.5px] font-bold uppercase tracking-wide text-ink3">Pergerakan stok yang direncanakan</h5>
          <ul className="m-0 list-disc space-y-0.5 pl-4 text-ink2">{k.pratinjau.operasi.map((o, i) => <li key={i}>{JENIS_OPERASI[o.jenis] ?? o.jenis}: {o.qty > 0 ? "+" : ""}{o.qty} · {o.kode} · {o.lokasi}</li>)}</ul>
        </div>
      )}
      {k.pergerakan?.length > 0 && <p className="m-0 text-ink3" data-testid="pergerakan-koreksi">Pergerakan tercatat: {k.pergerakan.map((m) => `${m.qty > 0 ? "+" : ""}${m.qty} (${m.jenis})`).join(", ")} — bertaut ke pergerakan asal.</p>}
      {k.pemutus && <p className="m-0 text-ink3">{k.status === "POSTED" ? "Disetujui" : k.status === "REJECTED" ? "Ditolak" : "Diputuskan"} oleh {k.pemutus.name}{k.catatanKeputusan ? ` — ${k.catatanKeputusan}` : ""}.</p>}
      {k.status === "PENDING_APPROVAL" && (
        <div className="space-y-1.5">
          {alasanTidak && <p className="m-0 text-orange" data-testid="pemohon-sama">{alasanTidak}</p>}
          {!bolehMenyetujui(roles) && !batal && <p className="m-0 text-ink3">Menunggu persetujuan Owner atau Finance.</p>}
          {(boleh || batal) && <input value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder={boleh ? "Catatan keputusan (wajib untuk menolak, min 5 karakter)" : "Catatan pembatalan (opsional)"} className="w-full rounded-btn border border-border bg-surface px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accent" aria-label="Catatan keputusan" data-testid="catatan-keputusan" />}
          <div className="flex flex-wrap gap-2">
            {boleh && <Button size="sm" disabled={busy} onClick={() => jalan(() => api.setujuiKoreksiGudang(k.id, catatan.trim() || undefined), "Gagal menyetujui")} data-testid="setujui-koreksi">{busy ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />} Setujui &amp; terapkan</Button>}
            {boleh && <Button size="sm" variant="destructive" disabled={busy} onClick={() => jalan(() => api.tolakKoreksiGudang(k.id, catatan.trim()), "Gagal menolak")} data-testid="tolak-koreksi"><XCircle size={13} /> Tolak</Button>}
            {batal && <Button size="sm" variant="ghost" disabled={busy} onClick={() => jalan(() => api.batalKoreksiGudang(k.id, catatan.trim() || undefined), "Gagal membatalkan")} data-testid="batal-koreksi"><Ban size={13} /> Batalkan pengajuan</Button>}
          </div>
          {galat && <p role="alert" className="m-0 text-red" data-testid="galat-keputusan">{galat}</p>}
        </div>
      )}
    </div>
  );
}

export default function KoreksiDokumenTab() {
  const [filter, setFilter] = useState("PENDING_APPROVAL"); const [data, setData] = useState({ total: 0, koreksi: [] }); const [memuat, setMemuat] = useState(true); const [galat, setGalat] = useState(""); const [buka, setBuka] = useState(null);
  const muat = useCallback(async () => {
    setMemuat(true); setGalat("");
    try { setData(await api.getDaftarKoreksiGudang({ status: filter })); } catch (e) { setGalat(e.message); } finally { setMemuat(false); }
  }, [filter]);
  useEffect(() => { muat(); }, [muat]);
  const jumlahMenunggu = useMemo(() => data.koreksi.filter((k) => k.status === "PENDING_APPROVAL").length, [data]);
  return (
    <div className="space-y-3" data-testid="tab-koreksi-dokumen">
      <div className="rounded-btn border-l-[3px] border-accent bg-inset px-3 py-2.5 text-[12px] text-ink2">
        <p className="m-0 font-bold text-ink">Koreksi Dokumen Gudang</p>
        <p className="m-0">Dokumen yang sudah diposting tidak diubah atau dihapus diam-diam. Koreksi tercatat sebagai dokumen sendiri: alasan wajib, sebelum–sesudah, dan — bila mengubah stok — disetujui orang lain lalu menghasilkan pergerakan pembalik/selisih yang bertaut ke dokumen asal. Tidak mengubah pembayaran, jurnal, atau tagihan Finance.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {FILTER.map((f) => <Button key={f.key || "semua"} size="sm" variant={filter === f.key ? "primary" : "secondary"} onClick={() => setFilter(f.key)}>{f.label}</Button>)}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={muat} title="Muat ulang"><RefreshCw size={14} /></Button>
      </div>
      {galat && <p className="text-[12px] text-red">{galat}</p>}
      {memuat ? <p className="flex items-center gap-1.5 text-[12.5px] text-ink3"><Loader2 size={14} className="animate-spin" /> Memuat…</p> : data.koreksi.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title={filter === "PENDING_APPROVAL" ? "Tidak ada koreksi yang menunggu" : "Belum ada koreksi"} description="Koreksi diajukan dari detail Penerimaan Barang yang sudah masuk stok." />
      ) : (
        <ul className="m-0 list-none space-y-2 p-0">
          {data.koreksi.map((k) => (
            <li key={k.id}>
              <Card className="p-0" data-testid="baris-koreksi-dokumen">
                <button type="button" onClick={() => setBuka(buka === k.id ? null : k.id)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2.5 text-left" aria-expanded={buka === k.id}>
                  <span className="text-[13px] font-semibold text-ink">{k.nomor}</span>
                  <Badge variant={STATUS_KOREKSI[k.status]?.warna ?? "neutral"}>{STATUS_KOREKSI[k.status]?.label ?? k.status}</Badge>
                  <span className="text-[12px] text-ink2">{k.nomorDokumen}</span>
                  <span className="text-[11px] text-ink3">{JENIS_KOREKSI[k.jenis] ?? k.jenis} · {k.pemohon?.name ?? "—"} · {new Date(k.diajukanPada).toLocaleString("id-ID")}</span>
                </button>
                {buka === k.id && <Detail k={k} aksi={muat} />}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {jumlahMenunggu > 0 && filter === "PENDING_APPROVAL" && <p className="text-[11.5px] text-ink3">{jumlahMenunggu} koreksi menunggu keputusan.</p>}
    </div>
  );
}
