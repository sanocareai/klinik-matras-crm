import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, AlertTriangle } from "lucide-react";
import { api } from "../api.js";
import { PageContainer } from "@/components/ui/page.jsx";

// D-200 tahap 4 — halaman peluncuran Task & Meeting.
//
// Bukan tujuan navigasi manual siapa pun: satu-satunya jalan masuk ke sini
// adalah lewat klik kartu "Task & Meeting" di /portal, yang mengarahkan
// browser (navigasi PENUH, lintas origin — lihat openPortal() di Portal.jsx)
// ke HUB GET /sso/start. HUB itu yang membuat state anti-CSRF (cookie
// HttpOnly di origin HUB) lalu MENGARAHKAN BALIK ke sini membawa hash-nya
// lewat query string (?state_hash=…&next=…) — hash saja, bukan state asli,
// jadi aman muncul di URL.
//
// Halaman ini hanya: (1) baca state_hash+next dari URL, (2) panggil
// POST /api/hub/handoff (Bearer JWT SANSS — pengguna SUDAH login di sini)
// membawa keduanya, (3) auto-submit form POST ke HUB /sso/callback dengan
// kode sekali-pakai yang didapat. Kode TIDAK PERNAH ditaruh di URL — hanya
// field form tersembunyi, dikirim via POST sungguhan (bukan fetch/XHR),
// supaya cookie state HUB (SameSite=None) ikut terkirim otomatis.
//
// BUG ditemukan rehearsal staging Tahap 5 (browser sungguhan): `useSearchParams()`
// membaca location VIRTUAL milik sistem tab dalam-app (TabsContext.jsx —
// `resolveEntryPath(location.pathname)`, SENGAJA cuma pathname, lihat D-144),
// bukan window.location sungguhan — jadi query string di URL sebenarnya
// (terlihat jelas di address bar, dikonfirmasi lewat window.location.search)
// tidak pernah terlihat di sini, dan halaman ini SELALU jatuh ke "Tautan
// tidak lengkap" walau tautannya benar. Baca window.location.search langsung
// (sekali, saat mount — halaman ini satu-tujuan, tidak butuh reaktif ke
// navigasi tab) untuk melewati lapisan tab sama sekali.
function readLaunchQuery() {
  const sp = new URLSearchParams(window.location.search);
  return { stateHash: sp.get("state_hash") || "", next: sp.get("next") || undefined };
}

export default function HubLaunch() {
  const [status, setStatus] = useState("loading"); // loading | submitting | error
  const [errorMsg, setErrorMsg] = useState("");
  const formRef = useRef(null);
  const [action, setAction] = useState(null);
  const [code, setCode] = useState(null);

  useEffect(() => {
    let batal = false;
    const { stateHash, next } = readLaunchQuery();

    if (!stateHash) {
      setStatus("error");
      setErrorMsg("Tautan tidak lengkap. Buka Task & Meeting lagi dari halaman workspace.");
      return;
    }

    api
      .postHubHandoff({ stateHash, next })
      .then((res) => {
        if (batal) return;
        setAction(res.postUrl);
        setCode(res.fields?.code || "");
        setStatus("submitting");
      })
      .catch((err) => {
        if (batal) return;
        setStatus("error");
        setErrorMsg(
          err.code === "DESTINATION_NOT_ALLOWED"
            ? "Tujuan tidak diizinkan. Buka Task & Meeting lagi dari halaman workspace."
            : err.code === "INVALID_STATE"
              ? "Tautan sudah tidak berlaku. Buka Task & Meeting lagi dari halaman workspace."
              : err.code === "HUB_ACCESS_DENIED"
                ? "Akun Anda tidak punya akses ke Task & Meeting. Hubungi admin."
                : "Task & Meeting tidak dapat dihubungi saat ini. Coba lagi sebentar lagi.",
        );
      });

    return () => {
      batal = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-submit SEGERA setelah form (dengan action + code) ter-render —
  // ini yang benar-benar membawa browser ke HUB /sso/callback.
  useEffect(() => {
    if (status === "submitting" && formRef.current) formRef.current.submit();
  }, [status]);

  return (
    <PageContainer>
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-24 text-center">
        {status === "error" ? (
          <>
            <AlertTriangle className="h-10 w-10 text-danger" />
            <h1 className="text-lg font-bold text-ink">Tidak bisa membuka Task &amp; Meeting</h1>
            <p className="text-[13px] text-ink3">{errorMsg}</p>
            <Link to="/portal" className="text-[13px] font-semibold text-accent hover:underline">
              Kembali ke workspace
            </Link>
          </>
        ) : (
          <>
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <h1 className="text-lg font-bold text-ink">Membuka Task &amp; Meeting…</h1>
            <p className="text-[13px] text-ink3">Mohon tunggu, Anda akan diarahkan otomatis.</p>
          </>
        )}
        {/* Form POST sungguhan (bukan fetch) — browser mengirimkan cookie
            state HUB (SameSite=None) hanya pada navigasi top-level seperti
            ini, dan HUB butuh membacanya untuk memvalidasi permintaan ini. */}
        {status === "submitting" && action && (
          <form ref={formRef} method="POST" action={action} className="hidden">
            <input type="hidden" name="code" value={code} />
          </form>
        )}
      </div>
    </PageContainer>
  );
}
