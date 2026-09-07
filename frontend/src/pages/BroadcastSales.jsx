import React, { useEffect, useState } from "react";
import { Send, Loader2, Ban, CheckCircle2, Clock, Users } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { formatTanggal } from "../utils/formatDate.js";
import { cn } from "@/lib/utils.js";

// Broadcast MANUAL admin/leader ke WA pribadi SALES (7 September 2026,
// permintaan owner) — "se simple juga misal broadcast meeting di tanggal
// tertentu". Beda dari /broadcast (Broadcast & Campaign, untuk PELANGGAN):
// tidak ada wizard 4 langkah, tidak ada anti-ban daily cap, tidak ada
// gambar/kolase — cuma pesan teks + pilih penerima + jadwal kirim. Lihat
// backend/src/routes/staffBroadcast.js untuk detail arsitektur.

const STATUS_META = {
  SCHEDULED: { label: "Terjadwal", variant: "accent", Icon: Clock },
  SENT:      { label: "Terkirim",  variant: "green",  Icon: CheckCircle2 },
  CANCELLED: { label: "Dibatalkan", variant: "neutral", Icon: Ban },
};

function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [h, m] = (timeStr || "00:00").split(":");
  const d = new Date(dateStr);
  d.setHours(Number(h) || 0, Number(m) || 0, 0, 0);
  return d;
}

function nowDateStr() {
  return new Date().toISOString().slice(0, 10);
}
function nowTimeStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function BroadcastSales() {
  const [recipients, setRecipients] = useState(null); // [{id,name,phone}]
  const [items, setItems] = useState(null); // riwayat broadcast
  const [error, setError] = useState("");

  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [tanggal, setTanggal] = useState(nowDateStr());
  const [jam, setJam] = useState(nowTimeStr());
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const [r, i] = await Promise.all([api.getStaffBroadcastRecipients(), api.getStaffBroadcasts()]);
      setRecipients(r);
      setItems(i);
      // Default: semua sales tercentang — admin biasanya broadcast ke
      // semua, mempersempit lebih jarang daripada memilih satu-satu.
      setSelectedIds(new Set(r.map((s) => s.id)));
    } catch (err) {
      setError(err.message);
    }
  }

  function toggleRecipient(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) =>
      prev.size === recipients.length ? new Set() : new Set(recipients.map((s) => s.id))
    );
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormErr("");
    if (!message.trim()) return setFormErr("Pesan wajib diisi");
    if (selectedIds.size === 0) return setFormErr("Pilih minimal 1 penerima");
    const scheduledAt = combineDateTime(tanggal, jam);
    if (!scheduledAt) return setFormErr("Jadwal kirim wajib diisi");

    setSaving(true);
    try {
      const created = await api.createStaffBroadcast({
        message: message.trim(),
        recipientIds: [...selectedIds],
        scheduledAt: scheduledAt.toISOString(),
      });
      setItems((prev) => [created, ...(prev || [])]);
      setMessage("");
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCancel(id) {
    if (!confirm("Batalkan broadcast terjadwal ini?")) return;
    setCancellingId(id);
    try {
      const updated = await api.cancelStaffBroadcast(id);
      setItems((prev) => prev.map((b) => (b.id === id ? updated : b)));
    } catch (err) {
      alert(err.message);
    } finally {
      setCancellingId(null);
    }
  }

  const belumTerjadwalDulu = tanggal < nowDateStr();

  return (
    <PageContainer>
      <PageHeader
        title="Broadcast Sales"
        subtitle="Kirim pengingat manual (mis. jadwal meeting) ke WA pribadi sales — terjadwal, bukan ke pelanggan."
      />
      <PageBody>
        {error && (
          <Card className="bg-redbg text-[13px] text-red">{error}</Card>
        )}

        <Card>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-[12px] font-semibold text-ink2">Pesan</label>
              <textarea
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Contoh: Halo tim, jangan lupa meeting evaluasi bulanan hari Jumat jam 10 pagi di kantor ya!"
                className="w-full rounded-lg border border-line bg-base px-3 py-2 text-[13px] text-ink outline-none focus:border-accent"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-[12px] font-semibold text-ink2">
                  <Users size={13} /> Penerima
                </label>
                {recipients && (
                  <button type="button" onClick={toggleAll} className="text-[11.5px] font-semibold text-accent hover:underline">
                    {selectedIds.size === recipients.length ? "Kosongkan semua" : "Pilih semua"}
                  </button>
                )}
              </div>
              {!recipients ? (
                <Skeleton className="h-16 rounded-lg" />
              ) : recipients.length === 0 ? (
                <p className="rounded-lg bg-inset px-3 py-2.5 text-[12.5px] text-ink3">
                  Tidak ada sales aktif ditemukan.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {recipients.map((s) => {
                    const dipilih = selectedIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggleRecipient(s.id)}
                        title={s.phone ? undefined : "Nomor WA belum terdaftar — tidak akan menerima pesan"}
                        className={cn(
                          "flex items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                          dipilih ? "border-accent bg-accentbg text-accent" : "border-line text-ink2"
                        )}
                      >
                        {s.name}
                        {!s.phone && <span className="text-red">⚠</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-ink2">Tanggal kirim</label>
                <DatePicker value={tanggal} onChange={setTanggal} />
              </div>
              <div>
                <label className="mb-1.5 block text-[12px] font-semibold text-ink2">Jam (WIB)</label>
                <input
                  type="time"
                  value={jam}
                  onChange={(e) => setJam(e.target.value)}
                  className="h-9 rounded-lg border border-line bg-base px-3 text-[13px] text-ink outline-none focus:border-accent"
                />
              </div>
              {belumTerjadwalDulu && (
                <p className="text-[11.5px] text-orange">Tanggal ini sudah lewat — cek lagi jadwalnya.</p>
              )}
            </div>

            {formErr && <p className="text-[12px] text-red">{formErr}</p>}

            <div>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {saving ? "Menjadwalkan…" : "Jadwalkan Broadcast"}
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <h2 className="mb-3 text-[14px] font-bold text-ink">Riwayat Broadcast</h2>
          {!items ? (
            <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
          ) : items.length === 0 ? (
            <p className="rounded-lg bg-inset px-3 py-2.5 text-[12.5px] text-ink3">Belum ada broadcast dibuat.</p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {items.map((b) => {
                const meta = STATUS_META[b.status] || STATUS_META.SCHEDULED;
                const jumlahTerkirim = b.results ? Object.values(b.results).filter((r) => r.status === "TERKIRIM").length : null;
                const jumlahGagal = b.results ? Object.values(b.results).filter((r) => r.status === "GAGAL").length : null;
                return (
                  <div key={b.id} className="rounded-xl bg-surface p-3 shadow-card">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap text-[13px] text-ink">{b.message}</p>
                        <p className="mt-1.5 text-[11px] text-ink3">
                          Jadwal: {formatTanggal(b.scheduledAt)} · {b.recipientIds.length} penerima
                          {b.createdBy?.name && ` · dibuat oleh ${b.createdBy.name}`}
                        </p>
                        {b.status === "SENT" && (
                          <p className="mt-0.5 text-[11px] text-ink3">
                            {jumlahTerkirim} terkirim{jumlahGagal > 0 ? `, ${jumlahGagal} gagal` : ""}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge variant={meta.variant}><meta.Icon size={11} /> {meta.label}</Badge>
                        {b.status === "SCHEDULED" && (
                          <button
                            type="button"
                            disabled={cancellingId === b.id}
                            onClick={() => handleCancel(b.id)}
                            className="rounded-lg p-1 text-ink3 transition-colors hover:bg-redbg hover:text-red disabled:opacity-40"
                            title="Batalkan"
                          >
                            {cancellingId === b.id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </PageBody>
    </PageContainer>
  );
}
