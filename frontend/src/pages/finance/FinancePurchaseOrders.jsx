import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api.js";
import { HalamanFinance } from "@/features/finance/shared.jsx";
import { useTertunda } from "@/features/finance/FilterBar.jsx";
import "@/styles/sanss-finance-po.css";
import { kpiPO, kalimatCakupan, izinPO } from "@/features/finance/po/poTampilan.js";
import { StripAlur, KpiDaftarPO, ToolbarPO, DaftarPOPanel, TombolPOBaru } from "@/features/finance/po/DaftarPO.jsx";
import EditorPO from "@/features/finance/po/EditorPO.jsx";
import { ModalDetailPO } from "@/features/finance/po/RincianPO.jsx";

// PESANAN PEMBELIAN (PO) BAHAN BAKU — Fase 1 integrasi Finance → Gudang. Redesain UI (1 Nov 2026): daftar, editor lebar, rincian. Perilaku, endpoint, dan izin TIDAK berubah.
// PO adalah dokumen KOMITMEN: menyimpan, menyetujui, merevisi, atau membatalkan PO TIDAK mengubah stok dan TIDAK membuat jurnal.
// Stok masuk dan jurnal persediaan baru lahir saat Gudang menekan Simpan ke Stok (putaway) dari Penerimaan Barang yang dibuat dari PO ini.
// Angka dipesan / diterima baik / ditolak / belum diterima / ditagih dihitung server dari penerimaan Gudang — layar ini hanya menampilkan.
// Satu-satunya efek samping selain itu: menyimpan PO (termasuk draf) memperbarui Harga Berlaku bahan yang harganya berubah (hargaDariPO.js) — dijelaskan di editor, dekat tombol simpan.

const idKunci = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
function penggunaSaatIni() {
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

export default function FinancePurchaseOrders() {
  const [tab, setTab] = useState("");
  const [q, setQ] = useState("");
  const qTunda = useTertunda(q);
  const pernahMuat = useRef(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [memuatUlang, setMemuatUlang] = useState(false);
  const [error, setError] = useState(null);
  const [pesan, setPesan] = useState(null);
  const [form, setForm] = useState(null); // { kunci, po? } — kunci baru tiap dibuka = isian bersih
  const [detailId, setDetailId] = useState(null);
  const [sp] = useSearchParams();
  const izin = useMemo(() => izinPO(penggunaSaatIni()), []);
  useEffect(() => { const id = sp.get("buka"); if (id) setDetailId(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- tautan dalam (dari panel lain) cukup dibaca sekali

  const muat = useCallback(async (opsi) => {
    const diam = opsi?.diam === true;
    if (!diam) setLoading(true); else setMemuatUlang(true);
    setError(null);
    try { setData(await api.getPurchaseOrders({ status: tab, q: qTunda.trim() })); }
    catch (e) { if (diam) setPesan({ teks: e.message || "Gagal menyegarkan daftar PO", jenis: "galat" }); else setError(e.message || "Gagal memuat Purchase Order"); }
    finally { if (!diam) setLoading(false); setMemuatUlang(false); }
  }, [tab, qTunda]);
  useEffect(() => { muat({ diam: pernahMuat.current }); pernahMuat.current = true; }, [muat]);

  const daftar = data?.purchaseOrders || [];
  const bukaBaru = () => setForm({ kunci: idKunci(), po: null });
  const kpi = useMemo(() => kpiPO(daftar), [daftar]);
  const adaSaringan = !!tab || !!qTunda.trim();

  return (
    <HalamanFinance
      className="fin-halaman"
      title="Pesanan pembelian"
      subtitle="Pantau pesanan pembelian (PO) ke supplier dan progres masuk stoknya."
      loading={loading}
      error={error}
      onRetry={muat}
      actions={<TombolPOBaru izin={izin} onClick={bukaBaru} />}
    >
      <div className="fin-ring fin-po" data-testid="halaman-po">
        {pesan && (
          <div className={`fin-po-pesan fin-po-pesan-${pesan.jenis}`} role={pesan.jenis === "galat" ? "alert" : "status"}>
            <p>{pesan.teks}</p>
            <button type="button" className="fin-tombol" onClick={() => setPesan(null)}><span>Tutup</span></button>
          </div>
        )}

        <StripAlur />
        <KpiDaftarPO kpi={kpi} cakupan={kalimatCakupan({ tab, q: qTunda, jumlah: daftar.length })} />

        <section className="fin-panel fin-po-panel" aria-label="Daftar pesanan pembelian" data-testid="panel-daftar-po" aria-busy={memuatUlang ? "true" : "false"}>
          <ToolbarPO tab={tab} setTab={setTab} q={q} setQ={setQ} jumlah={daftar.length} memuatUlang={memuatUlang} />
          <div className={memuatUlang ? "fin-po-memuat" : undefined}>
            <DaftarPOPanel daftar={daftar} onBuka={setDetailId} onBaru={bukaBaru} izin={izin} adaSaringan={adaSaringan} onReset={() => { setQ(""); setTab(""); }} />
          </div>
        </section>
      </div>

      {form && (
        <EditorPO
          key={form.kunci}
          kunci={form.kunci}
          po={form.po}
          izin={izin}
          onClose={() => setForm(null)}
          onSaved={async (id, info) => { setForm(null); await muat({ diam: true }); setDetailId(id); if (info) setPesan({ teks: info, jenis: "info" }); }}
        />
      )}
      {detailId && (
        <ModalDetailPO
          key={detailId}
          id={detailId}
          izin={izin}
          onClose={() => setDetailId(null)}
          onChanged={() => muat({ diam: true })}
          onUbah={(po) => { setDetailId(null); setForm({ kunci: idKunci(), po }); }}
        />
      )}
    </HalamanFinance>
  );
}
