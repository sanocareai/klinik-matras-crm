import React, { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Plus, Image as ImageIcon, FileText, Package, X, Sparkles } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore.js";

const BASE = (import.meta.env.VITE_API_BASE || "") + "/api";
const MAX_FILE_MB = 50; // batas nginx client_max_body_size di production (bukan limit multer 64MB — nginx yang lebih ketat)

let uidCounter = 0;
function nextUid() { uidCounter += 1; return `mu-${Date.now()}-${uidCounter}`; }

function mediaTypeOf(file) {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  return "document";
}

// Kompresi gambar di browser sebelum upload — dipakai untuk mode "Standar".
// Diadaptasi dari frontend/src/pages/Products.jsx#compressImage (sudah
// dipakai & terbukti jalan untuk upload galeri produk).
function compressImage(file, maxWidth = 1600, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file),
        "image/jpeg",
        quality,
      );
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => resolve(file); // gagal decode (bukan gambar valid dsb) — kirim apa adanya
    img.src = URL.createObjectURL(file);
  });
}

// Upload dengan progress asli (XHR, bukan fetch — fetch tidak punya event
// upload-progress bawaan). Kontrak request SAMA PERSIS dengan
// api.js#sendMedia (field "file"/"sendAs"/"caption", endpoint sama,
// header auth sama) — cuma butuh XHR di sini demi progress bar per file.
function uploadWithProgress(conversationId, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/conversations/${conversationId}/media`);
    const token = localStorage.getItem("token");
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error("Respons server tidak valid")); }
      } else {
        let msg = "Gagal upload";
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => reject(new Error("Koneksi terputus saat upload"));
    xhr.send(formData);
  });
}

// Tombol attach + sheet pilihan + modal preview grid sebelum kirim.
// Drag-drop & paste-clipboard di area chat memanggil addFiles() lewat ref
// (dipasang dari ChatWindow/index.jsx yang menguasai area drop-nya).
const MediaUploader = forwardRef(function MediaUploader({ conversationId, onOpenProduct }, ref) {
  const [showSheet, setShowSheet] = useState(false);
  const [items, setItems]         = useState([]); // { uid, file, previewUrl, mediaType, caption, error }
  const [hd, setHd]               = useState(false); // false = Standar (default, dikompresi)
  const [sending, setSending]     = useState(false);
  const [progressByUid, setProgressByUid] = useState({});

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => {
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        alert(`"${f.name}" lebih dari ${MAX_FILE_MB}MB — tidak bisa dikirim.`);
        return false;
      }
      return true;
    });
    if (!files.length) return;
    const newItems = files.map((file) => ({
      uid: nextUid(),
      file,
      previewUrl: URL.createObjectURL(file),
      mediaType: mediaTypeOf(file),
      caption: "",
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

  useImperativeHandle(ref, () => ({ addFiles }));

  function removeItem(uid) {
    setItems((prev) => {
      const target = prev.find((i) => i.uid === uid);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.uid !== uid);
    });
  }

  function setCaption(uid, caption) {
    setItems((prev) => prev.map((i) => (i.uid === uid ? { ...i, caption } : i)));
  }

  function closePreview() {
    items.forEach((i) => URL.revokeObjectURL(i.previewUrl));
    setItems([]);
    setProgressByUid({});
  }

  // Kirim satu-per-satu (backend cuma terima 1 file per request — lihat
  // catatan di conversations.js: upload.single("file")).
  async function handleSendAll() {
    setSending(true);
    for (const item of items) {
      setProgressByUid((p) => ({ ...p, [item.uid]: 1 }));
      try {
        let fileToSend = item.file;
        if (item.mediaType === "image" && !hd) {
          fileToSend = await compressImage(item.file);
        }
        const fd = new FormData();
        fd.append("file", fileToSend);
        fd.append("sendAs", item.mediaType === "document" ? "document" : "media");
        if (item.caption.trim()) fd.append("caption", item.caption.trim());

        const msg = await uploadWithProgress(conversationId, fd, (pct) => {
          setProgressByUid((p) => ({ ...p, [item.uid]: pct }));
        });
        useMessageStore.getState().appendMessage(conversationId, msg);
        setProgressByUid((p) => ({ ...p, [item.uid]: 100 }));
      } catch (err) {
        setItems((prev) => prev.map((i) => (i.uid === item.uid ? { ...i, error: err.message } : i)));
      }
    }
    setSending(false);
    // Kalau semua sukses (tidak ada yang error), tutup modal otomatis
    setItems((prev) => {
      const stillFailed = prev.filter((i) => i.error);
      if (stillFailed.length === 0) {
        prev.forEach((i) => URL.revokeObjectURL(i.previewUrl));
        setProgressByUid({});
        return [];
      }
      return stillFailed;
    });
  }

  return (
    <>
      <button type="button" onClick={() => setShowSheet((v) => !v)} className={`chat-action-btn ${showSheet ? "active" : ""}`} title="Lampiran">
        <Plus size={16} />
      </button>

      {showSheet && (
        <div className="attach-sheet-overlay" onClick={() => setShowSheet(false)}>
          <div className="attach-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="attach-sheet-handle" />
            <div className="attach-grid-title">Lampirkan</div>
            <div className="attach-grid">
              <label className="attach-item">
                <input type="file" accept="image/*,video/*" multiple style={{ display: "none" }}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; setShowSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#dbeafe" }}><ImageIcon size={24} style={{ color: "#2563eb" }} /></div>
                <span className="attach-item-label">Foto/Video</span>
              </label>
              <label className="attach-item">
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv" multiple style={{ display: "none" }}
                  onChange={(e) => { addFiles(e.target.files); e.target.value = ""; setShowSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#fef9c3" }}><FileText size={24} style={{ color: "#ca8a04" }} /></div>
                <span className="attach-item-label">Dokumen</span>
              </label>
              {onOpenProduct && (
                <button className="attach-item" onClick={() => { onOpenProduct(); setShowSheet(false); }}>
                  <div className="attach-item-icon" style={{ background: "#ede9fe" }}><Package size={24} style={{ color: "#7c3aed" }} /></div>
                  <span className="attach-item-label">Produk</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal preview grid sebelum kirim */}
      {items.length > 0 && (
        <div className="media-preview-overlay" onClick={() => !sending && closePreview()}>
          <div className="media-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="media-preview-header">
              <span>{items.length} file dipilih</span>
              <button className="modal-close" onClick={closePreview} disabled={sending}><X size={16} /></button>
            </div>

            <div className="media-preview-grid">
              {items.map((item) => (
                <div key={item.uid} className="media-preview-item">
                  {!sending && (
                    <button className="media-preview-remove" onClick={() => removeItem(item.uid)} title="Hapus">
                      <X size={12} />
                    </button>
                  )}
                  <div className="media-preview-thumb">
                    {item.mediaType === "image" && <img src={item.previewUrl} alt="" />}
                    {item.mediaType === "video" && <video src={item.previewUrl} />}
                    {item.mediaType === "document" && <FileText size={26} />}
                    {progressByUid[item.uid] !== undefined && (
                      <div className="media-preview-progress">
                        <div className="media-preview-progress-fill" style={{ width: `${progressByUid[item.uid]}%` }} />
                      </div>
                    )}
                  </div>
                  <input
                    className="media-preview-caption"
                    placeholder="Caption..."
                    value={item.caption}
                    disabled={sending}
                    onChange={(e) => setCaption(item.uid, e.target.value)}
                  />
                  {item.error && <span className="media-preview-error">{item.error}</span>}
                </div>
              ))}
            </div>

            <div className="media-preview-footer">
              <button
                type="button"
                className={`media-quality-toggle${hd ? " active" : ""}`}
                onClick={() => setHd((v) => !v)}
                disabled={sending}
                title="HD kirim ukuran asli, Standar dikompres biar lebih hemat kuota"
              >
                <Sparkles size={13} /> {hd ? "HD" : "Standar"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleSendAll} disabled={sending} style={{ marginLeft: "auto" }}>
                {sending ? "Mengirim..." : `Kirim (${items.length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

export default MediaUploader;
