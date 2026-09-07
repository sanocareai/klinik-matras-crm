import React, { useEffect, useMemo, useState } from "react";
import { Send, Loader2, Ban, CheckCircle2, Clock, Users, PenSquare, History } from "lucide-react";
import { api } from "../api.js";
import { PageContainer, PageHeader, PageBody } from "@/components/ui/page.jsx";
import { Card } from "@/components/ui/card.jsx";
import { Button } from "@/components/ui/button.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Skeleton } from "@/components/ui/skeleton.jsx";
import DatePicker from "@/components/ui/date-picker.jsx";
import { formatTanggalLengkap, formatJam, toWIB } from "../utils/formatDate.js";
import { cn } from "@/lib/utils.js";

// Broadcast MANUAL admin/leader ke WA pribadi SALES (7 September 2026,
// permintaan owner) — "se simple juga misal broadcast meeting di tanggal
// tertentu". Beda dari /broadcast (Broadcast & Campaign, untuk PELANGGAN):
// tidak ada wizard 4 langkah, tidak ada anti-ban daily cap, tidak ada
// gambar/kolase — cuma pesan teks + pilih penerima + jadwal kirim.
//
// Tab "Riwayat" (revisi 7 Sep 2026, permintaan owner: "gahanya riwayat
// broadcast yang dibikin manual, tapi yang dikirim otomatis juga") — satu
// tabel `staff_broadcasts` menyimpan DUA jenis baris (kind MANUAL vs
// AUTO_REMINDER, lihat services/salesReminderDigestJob.js), tab ini
// merekap KEDUANYA, dikelompokkan per hari (WIB).
//
// Lihat backend/src/routes/staffBroadcast.js untuk detail arsitektur.

const STATUS_META = {
  SCHEDULED: { label: "Terjadwal", variant: "accent", Icon: Clock },
  SENT:      { label: "Terkirim",  variant: "green",  Icon: CheckCircle2 },
  CANCELLED: { label: "Dibatalkan", variant: "neutral", Icon: Ban },
};

const KIND_META = {
  MANUAL:        { label: "Manual",    variant: "accent" },
  AUTO_REMINDER: { label: "Otomatis",  variant: "neutral" },
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

// Kelompokkan riwayat per hari kalender WIB — permintaan owner: "merekap
// hasil broadcast setiap harinya". Kunci grup pakai format ISO stabil
// (YYYY-MM-DD di WIB), label tampil pakai formatTanggalLengkap.
function kelompokPerHari(items) {
  const map = new Map(); // "YYYY-MM-DD" -> items[]
  for (const b of items) {
    const key = toWIB(b.createdAt).format("YYYY-MM-DD");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(b);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)); // terbaru dulu
}

function ComposeTab({ recipients, onCreated }) {
  const [message, setMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [tanggal, setTanggal] = useState(nowDateStr());
  const [jam, setJam] = useState(nowTimeStr());
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  useEffect(() => {
    if (recipients) setSelectedIds(new Set(recipients.map((s) => s.id)));
  }, [recipients]);

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
      onCreated(created);
      setMessage("");
    } catch (err) {
      setFormErr(err.message);
    } finally {
      setSaving(false);
    }
  }

  const belumTerjadwalDulu = tanggal < nowDateStr();

  return (
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
            {recipients && recipients.length > 0 && (
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
  );
}

function HistoryTab({ items, onCancel, cancellingId }) {
  const grouped = useMemo(() => kelompokPerHari(items || []), [items]);

  if (!items) {
    return (
      <Card>
        <div className="flex flex-col gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card>
        <p className="rounded-lg bg-inset px-3 py-2.5 text-[12.5px] text-ink3">Belum ada broadcast tercatat.</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([key, hariItems]) => (
        <Card key={key}>
          <h3 className="mb-3 text-[12.5px] font-bold uppercase tracking-wide text-ink3">
            {formatTanggalLengkap(hariItems[0].createdAt)} · {hariItems.length} broadcast
          </h3>
          <div className="flex flex-col gap-2.5">
            {hariItems.map((b) => {
              const statusMeta = STATUS_META[b.status] || STATUS_META.SCHEDULED;
              const kindMeta = KIND_META[b.kind] || KIND_META.MANUAL;
              const jumlahTerkirim = b.results ? Object.values(b.results).filter((r) => r.status === "TERKIRIM").length : null;
              const jumlahGagal = b.results ? Object.values(b.results).filter((r) => r.status === "GAGAL").length : null;
              return (
                <div key={b.id} className="rounded-xl bg-surface p-3 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant={kindMeta.variant}>{kindMeta.label}</Badge>
                        <span className="text-[11px] text-ink3">{formatJam(b.createdAt)} WIB</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] text-ink">{b.message}</p>
                      <p className="mt-1.5 text-[11px] text-ink3">
                        {b.recipientIds.length} penerima
                        {b.createdBy?.name && ` · dibuat oleh ${b.createdBy.name}`}
                      </p>
                      {b.status === "SENT" && (
                        <p className="mt-0.5 text-[11px] text-ink3">
                          {jumlahTerkirim} terkirim{jumlahGagal > 0 ? `, ${jumlahGagal} gagal` : ""}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={statusMeta.variant}><statusMeta.Icon size={11} /> {statusMeta.label}</Badge>
                      {b.status === "SCHEDULED" && (
                        <button
                          type="button"
                          disabled={cancellingId === b.id}
                          onClick={() => onCancel(b.id)}
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
        </Card>
      ))}
    </div>
  );
}

export default function BroadcastSales() {
  const [tab, setTab] = useState("compose"); // "compose" | "history"
  const [recipients, setRecipients] = useState(null);
  const [items, setItems] = useState(null);
  const [recipientsErr, setRecipientsErr] = useState("");
  const [itemsErr, setItemsErr] = useState("");
  const [cancellingId, setCancellingId] = useState(null);

  useEffect(() => { load(); }, []);

  // Dua panggilan INDEPENDEN (7 Sep 2026, bugfix) — sebelumnya Promise.all,
  // jadi kalau salah satu gagal (mis. GET /staff-broadcast 500 gara-gara
  // bug createdAt di schema), penerima ikut kosong total padahal endpoint
  // recipients-nya sendiri baik-baik saja. Sekarang gagal satu, yang lain
  // tetap tampil.
  function load() {
    api.getStaffBroadcastRecipients().then(setRecipients).catch((err) => setRecipientsErr(err.message));
    api.getStaffBroadcasts().then(setItems).catch((err) => setItemsErr(err.message));
  }

  function handleCreated(created) {
    setItems((prev) => [created, ...(prev || [])]);
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

  return (
    <PageContainer>
      <PageHeader
        title="Broadcast Sales"
        subtitle="Kirim pengingat manual (mis. jadwal meeting) ke WA pribadi sales, dan pantau pengingat otomatis yang sudah terkirim."
      />
      <PageBody>
        {recipientsErr && <Card className="bg-redbg text-[13px] text-red">Gagal muat penerima: {recipientsErr}</Card>}
        {itemsErr && <Card className="bg-redbg text-[13px] text-red">Gagal muat riwayat: {itemsErr}</Card>}

        <div className="flex gap-1 rounded-xl bg-inset p-1" style={{ maxWidth: 320 }}>
          {[
            { key: "compose", label: "Kirim Baru", Icon: PenSquare },
            { key: "history", label: "Riwayat", Icon: History },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-center text-[12px] font-semibold transition-colors",
                tab === t.key ? "bg-base text-ink shadow-card" : "text-ink3 hover:text-ink2"
              )}
            >
              <t.Icon size={13} className="shrink-0" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "compose" ? (
          <ComposeTab recipients={recipients} onCreated={handleCreated} />
        ) : (
          <HistoryTab items={items} onCancel={handleCancel} cancellingId={cancellingId} />
        )}
      </PageBody>
    </PageContainer>
  );
}
