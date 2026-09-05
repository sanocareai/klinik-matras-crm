import React from "react";
import { UserCheck } from "lucide-react";
import Avatar from "@/components/Avatar.jsx";

// Wave 6 (redesign Inbox, plan starry-humming-knuth) — dua konsep kepemilikan
// yang SERING TERTUKAR (lihat CLAUDE.md §20):
//   - conversation.assignedToId → siapa yang SEDANG PEGANG PERCAKAPAN INI
//     (bisa pindah lewat takeover/transfer, konteksnya per-chat)
//   - customer.assignedSalesId  → PEMILIK LEAD pelanggan ini (label "Sales
//     Person" di Pelanggan/Pipeline/Laporan, konteksnya per-pelanggan)
// Sebelumnya CustomerPanel TIDAK menampilkan keduanya sama sekali — sales
// harus lihat header chat (assignedTo) DAN buka halaman Pelanggan terpisah
// (assignedSales) untuk tahu dua-duanya. Di sini MURNI tampilan: `conversation`
// & `customer` (prop yang SUDAH di-fetch CustomerPanel/index.jsx, assignedSales
// sudah ikut ter-include dari GET /customers/:id) — TIDAK ada fetch baru,
// TIDAK ada endpoint baru. Reassignment TETAP lewat mekanisme yang sudah ada
// (Ambil Alih di ChatWindow, TransferPickerPopover di baris list) — bukan
// dibangun ulang di sini.
export default function AssignmentSection({ conversation, customer }) {
  const conversationOwner = conversation?.assignedTo || null;
  const leadOwner = customer?.assignedSales || null;
  const sameOwner = !!(conversationOwner && leadOwner && conversationOwner.id === leadOwner.id);

  if (!conversationOwner && !leadOwner) return null;

  return (
    <div className="panel-section">
      <span className="panel-section-label">Penanggung Jawab</span>
      <div className="assignment-row">
        <span className="assignment-row-label"><UserCheck size={12} /> Pegang Chat Ini</span>
        {conversationOwner ? (
          <span className="assignment-row-value">
            <Avatar name={conversationOwner.name} size="sm" /> {conversationOwner.name}
          </span>
        ) : (
          <span className="assignment-row-value assignment-row-empty">Belum diambil</span>
        )}
      </div>
      {/* Kalau pemegang chat SAMA dengan pemilik lead (kasus paling umum),
          satu baris cukup — baris kedua yang bilang hal yang sama lagi cuma
          bising. Baris kedua HANYA muncul kalau memang berbeda orang, itu
          justru info yang paling penting untuk sales lihat. */}
      {!sameOwner && (
        <div className="assignment-row">
          <span className="assignment-row-label"><UserCheck size={12} /> Pemilik Lead</span>
          {leadOwner ? (
            <span className="assignment-row-value">
              <Avatar name={leadOwner.name} size="sm" /> {leadOwner.name}
            </span>
          ) : (
            <span className="assignment-row-value assignment-row-empty">Belum ada</span>
          )}
        </div>
      )}
    </div>
  );
}
