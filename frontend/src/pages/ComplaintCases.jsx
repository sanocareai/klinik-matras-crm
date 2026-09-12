import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock } from "lucide-react";
import { api } from "@/api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { EmptyState } from "@/components/ui/empty-state.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Card } from "@/components/ui/card.jsx";
import { FilterDropdown } from "@/components/ui/filter-dropdown.jsx";
import { formatTanggal, formatTanggalPendek, hariSejak } from "@/utils/formatDate.js";
import ComplaintCaseDrawer from "@/features/complaints/ComplaintCaseDrawer.jsx";
import {
  CATEGORY_LABEL, SEVERITY_LABEL, SEVERITY_TONE, OWNER_LABEL, STATUS_LABEL, STATUS_TONE,
} from "@/features/complaints/complaintLabels.js";

// Papan Kasus Komplain lintas divisi (D-116, 11 September 2026) — SATU
// halaman dipakai Sales/Delivery/Produksi/Warehouse/QC (sidebar masing-
// masing workspace menunjuk ke path YANG SAMA, lihat Layout.jsx), pola
// sama dengan "Semua Order" (ArmadaOrders.jsx/ProductionOrders.jsx) yang
// juga satu sumber data dibaca lintas divisi. Filter status/pemegang kasus
// membantu tiap divisi menyaring kasus yang relevan buat mereka SENDIRI
// tanpa perlu halaman terpisah per divisi (menghindari duplikasi state).
//
// D-153 (12 September 2026, laporan owner: "redesign tab kasus komplain")
// — tabel polos SEBELUMNYA cuma menampilkan 7 kolom generik (nomor/nama/
// kategori/severity/status/pemegang/tanggal) — keluhan CUSTOMER SENDIRI
// (`description`, field WAJIB diisi saat kasus dibuka) dan target SLA
// internal (`targetCompletionAt`) sama sekali TIDAK ditampilkan di daftar,
// padahal DUA-duanya sudah ada di endpoint yang sama (complaintCaseInclude
// dipakai identik utk list & detail, lihat routes/complaints.js) — perlu
// buka drawer satu-satu cuma untuk tahu "keluhannya apa" dan "sudah lewat
// target atau belum". Diganti jadi kartu supaya keduanya kelihatan sekilas,
// dan diurutkan severity (Kritis dulu) — bukan cuma tanggal dibuka — supaya
// kasus paling mendesak yang paling gampang dilihat, bukan yang paling baru.
const STATUS_OPTIONS = Object.keys(STATUS_LABEL).map((s) => ({ value: s, label: STATUS_LABEL[s] }));
const OWNER_OPTIONS = Object.keys(OWNER_LABEL).map((o) => ({ value: o, label: OWNER_LABEL[o] }));
const SEVERITY_RANK = { KRITIS: 0, TINGGI: 1, SEDANG: 2, RENDAH: 3 };

function CaseCard({ c, onOpen }) {
  const overdueDays = c.status !== "SELESAI" && c.status !== "DIBATALKAN" ? hariSejak(c.targetCompletionAt) : null;
  const overdue = overdueDays != null && Number.isFinite(overdueDays) && overdueDays > 0;

  return (
    <Card className="cursor-pointer p-4 transition-colors hover:bg-hovertint" onClick={onOpen}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-[12.5px] font-semibold text-ink">{c.caseNumber}</span>
            <span className="text-[12px] text-ink3">{CATEGORY_LABEL[c.category] || c.category}</span>
          </div>
          <p className="mt-1 truncate text-[13.5px] font-medium text-ink">
            {c.order?.customer?.name || "—"}
            <span className="font-normal text-ink3"> · {c.order?.orderNumber}</span>
            {c.unit && <span className="font-normal text-ink3"> · {c.unit.unitCode}</span>}
          </p>
        </div>
        <Badge variant={SEVERITY_TONE[c.severity]} className="shrink-0">{SEVERITY_LABEL[c.severity] || c.severity}</Badge>
      </div>

      {/* Keluhan customer apa adanya — SEBELUMNYA cuma terlihat setelah buka
          drawer. line-clamp-2 supaya kartu tetap ringkas kalau ceritanya panjang. */}
      {c.description && (
        <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-ink2">{c.description}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_TONE[c.status]}>{STATUS_LABEL[c.status] || c.status}</Badge>
          <span className="text-[11.5px] text-ink3">Pemegang: {OWNER_LABEL[c.currentOwner] || c.currentOwner}</span>
        </div>
        <div className="flex items-center gap-3 text-[11.5px] text-ink3">
          {c.targetCompletionAt && (
            overdue ? (
              <span className="flex items-center gap-1 font-medium text-red">
                <Clock size={12} /> Lewat target {overdueDays} hari
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Clock size={12} /> Target {formatTanggalPendek(c.targetCompletionAt)}
              </span>
            )
          )}
          <span>Dibuka {formatTanggal(c.createdAt)}</span>
        </div>
      </div>
    </Card>
  );
}

export default function ComplaintCases() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [owner, setOwner] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    api.getComplaintCases({ status: status || undefined, currentOwner: owner || undefined })
      .then((d) => setCases(d.cases || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [status, owner]);

  useEffect(() => { load(); }, [load]);

  // Urutan tampil: kasus AKTIF dulu (SELESAI/DIBATALKAN tenggelam ke bawah —
  // sudah tuntas, tidak perlu bersaing tempat dengan yang masih perlu
  // ditangani), lalu di dalam kasus aktif severity paling mendesak dulu
  // (Kritis di atas), createdAt terbaru sebagai tiebreaker terakhir. TIDAK
  // mengubah data/urutan dari server, cuma bagaimana halaman ini
  // menampilkannya.
  const sortedCases = useMemo(() => {
    const aktifRank = (c) => (c.status === "SELESAI" || c.status === "DIBATALKAN" ? 1 : 0);
    return [...cases].sort((a, b) => {
      const aktifDiff = aktifRank(a) - aktifRank(b);
      if (aktifDiff !== 0) return aktifDiff;
      const rankDiff = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
  }, [cases]);

  const stats = useMemo(() => {
    const aktif = cases.filter((c) => c.status !== "SELESAI" && c.status !== "DIBATALKAN");
    const prioritas = aktif.filter((c) => c.severity === "KRITIS" || c.severity === "TINGGI");
    const lewatTarget = aktif.filter((c) => {
      const d = hariSejak(c.targetCompletionAt);
      return Number.isFinite(d) && d > 0;
    });
    const selesai = cases.filter((c) => c.status === "SELESAI");
    return { total: cases.length, aktif: aktif.length, prioritas: prioritas.length, lewatTarget: lewatTarget.length, selesai: selesai.length };
  }, [cases]);

  return (
    <PageContainer>
      <PageHeader
        title="Kasus Komplain"
        subtitle="Kasus komplain & purna-jual lintas divisi — Sales, Delivery, Produksi, Warehouse, QC."
      />
      <PageBody>
        {cases.length > 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Card className="p-3.5">
              <p className="text-[20px] font-bold leading-none text-ink">{stats.aktif}</p>
              <p className="mt-1 text-[11.5px] text-ink3">Kasus aktif</p>
            </Card>
            <Card className="p-3.5">
              <p className="text-[20px] font-bold leading-none text-orange">{stats.prioritas}</p>
              <p className="mt-1 text-[11.5px] text-ink3">Prioritas tinggi/kritis</p>
            </Card>
            <Card className="p-3.5">
              <p className={"text-[20px] font-bold leading-none " + (stats.lewatTarget > 0 ? "text-red" : "text-ink")}>{stats.lewatTarget}</p>
              <p className="mt-1 text-[11.5px] text-ink3">Lewat target SLA</p>
            </Card>
            <Card className="p-3.5">
              <p className="text-[20px] font-bold leading-none text-green">{stats.selesai}</p>
              <p className="mt-1 text-[11.5px] text-ink3">Selesai</p>
            </Card>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            placeholder="Semua status"
          />
          <FilterDropdown
            value={owner}
            onChange={setOwner}
            options={OWNER_OPTIONS}
            placeholder="Semua pemegang"
          />
        </div>

        {error && <p className="rounded-btn bg-redbg px-3 py-2 text-[12.5px] text-red">{error}</p>}
        {loading && <p className="text-[12.5px] text-ink3">Memuat…</p>}

        {!loading && cases.length === 0 && (
          <EmptyState
            icon={AlertTriangle}
            title="Belum ada kasus komplain"
            description="Kasus dibuka Sales dari Order Detail (tombol '+ Buka Kasus' di section Kasus Komplain)."
          />
        )}

        {sortedCases.length > 0 && (
          <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            {sortedCases.map((c) => (
              <CaseCard key={c.id} c={c} onOpen={() => setOpenId(c.id)} />
            ))}
          </div>
        )}
      </PageBody>

      <ComplaintCaseDrawer open={!!openId} caseId={openId} onClose={() => setOpenId(null)} onChanged={load} />
    </PageContainer>
  );
}
