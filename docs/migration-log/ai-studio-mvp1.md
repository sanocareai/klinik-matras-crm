# AI Studio — MVP 1 (Completion Record)

**Tanggal:** November 2026 · **Branch:** `feat/ai-studio-mvp1`
**Rancangan:** repo `Sano_WA_Agent` → `docs/fase2/00-rancangan-sano-ai-studio.md`, `01-desain-teknis-mvp1.md`, mockup "Sano AI Studio".

Workspace **AI Studio** — terpisah dari Sales CRM (keputusan Owner) — untuk melatih & menguji agent AI.
Agent pertama: **Mattress Consultant** (skill `sano-mattress-consultant`).
**TIDAK ada jalur kirim ke customer.** Semua balasan hanya di Playground.

## Yang dikirim
| Bagian | Berkas |
|---|---|
| Skill bawaan (versi 1) | `backend/data/studio-skills/sano-mattress-consultant/` (SKILL.md + references) |
| Perakit prompt, cek keras, runtime | `backend/src/services/agentStudio/{skillLoader,checks,runtime}.js` |
| API | `backend/src/routes/studio.js` → `/api/studio/*` |
| Portal & izin | `backend/src/constants/permissions.js` (PORTALS `aistudio`: ADMIN/OWNER) |
| UI | `frontend/src/pages/aiStudio/AiStudio.jsx` (Playground · Tinjauan · Test Case), sidebar divisi `aistudio` di `Layout.jsx`, `WorkspaceSwitcher.jsx` (ADMIN/OWNER/SALES), ikon Portal |
| Tes | `backend/tests/agentStudio.test.js` (11 tes murni), `authorize.test.js` (portal ke-7) |

## Akses
- `/api/studio/*`: ADMIN, OWNER, SALES. Tinjauan koreksi (`GET/PATCH /feedback`): ADMIN, OWNER.
- PORTALS backend sengaja **tanpa SALES** → sales tetap auto-skip ke CRM saat login; masuk AI Studio lewat WorkspaceSwitcher.

## Database
Migrasi `prisma/migrations/20261227090000_add_ai_studio/` — **additive**: 6 tabel `studio_*` + 4 enum `Studio*`, tanpa FK ke tabel lama.
Rollback ada di baris komentar teratas `migration.sql`.

## Environment
| Var | Default | Fungsi |
|---|---|---|
| `STUDIO_ANTHROPIC_API_KEY` | — | Kunci API (organisasi yang ditautkan ke Max). Kosong → `ANTHROPIC_API_KEY` → kunci BYOK AI Playground |
| `STUDIO_MAX_COST_USD_MONTH` | `20` | Batas biaya Studio per bulan (jumlah `studio_messages.costUsd`). Tercapai → kirim pesan ditolak 429 |

## Cara kerja satu giliran
1. Versi skill LIVE (`studio_skill_versions.files`) + katalog produk aktif (harga live) → system prompt (bagian skill di depan → prompt caching).
2. Riwayat sesi + pesan customer → Claude (default `claude-haiku-5-5`; pilihan `claude-sonnet-5-5`).
3. Jawaban JSON (bubbles, kartu katalog, tahap, data terkumpul, rekomendasi, handover, catatan) → dinormalisasi.
4. **Cek keras** deterministik: harga sesuai katalog · harga tidak terlalu cepat · tanpa diskon/promo · tanpa klaim medis · layanan masih dijual · maks 1 emoji · handover saat komplain/nego.
5. Biaya dihitung per pesan (harga per model di `runtime.js` → cek ulang bila harga Anthropic berubah).

Agent pertama ditanam otomatis saat `/api/studio/agents` pertama kali dipanggil.

## Verifikasi
- `node --test tests/agentStudio.test.js` → 11/11 lulus.
- `npm test` → semua lulus kecuali 6 tes yang **juga gagal di main tanpa perubahan ini** (pola CRLF di checkout Windows: financeKontrakMetrik, productionWorkshopExecutionMigrationAndAudit, stagingIsolation ×3, skrip rilis atribusi).
- `prisma validate` OK; migrasi dihasilkan lewat `prisma migrate diff` (hanya objek studio).

## Deploy (setelah disetujui Owner)
```bash
git pull
docker compose up -d --build backend
docker compose exec backend npx prisma migrate deploy   # 6 tabel studio_*
# set STUDIO_ANTHROPIC_API_KEY di .env backend bila memakai kunci organisasi Max
```

## Berikutnya (MVP 2–3)
Replay chat nyata · test suite otomatis + AI juri · versi & persetujuan penerbitan · editor knowledge · konfigurasi model per tugas & dashboard biaya.
