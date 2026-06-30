import React, { useEffect, useState } from "react";
import { X, Search, Package, Check, ChevronLeft, SendHorizonal } from "lucide-react";
import { api } from "../api.js";

const KATEGORI_ALL = "Semua";
const KATEGORI_OPTIONS = [KATEGORI_ALL, "Upgrade", "Garansi", "Servis", "Info", "Lainnya"];

function formatHarga(price, priceUnit) {
  if (!price) return null;
  const angka = `Rp${price.toLocaleString("id-ID")}`;
  return priceUnit ? `${priceUnit} ${angka}` : angka;
}

export function ProductPicker({ conversation, onClose, onSent }) {
  const [products, setProducts]           = useState([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState("");
  const [kategori, setKategori]           = useState(KATEGORI_ALL);
  const [selected, setSelected]           = useState(null); // produk aktif
  const [checkedIds, setCheckedIds]       = useState([]);   // gambar yang dicentang
  const [includePrice, setIncludePrice]   = useState(true);
  const [sending, setSending]             = useState(false);

  useEffect(() => {
    api.getProducts()
      .then(setProducts)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Saat produk dipilih, default semua gambar dicentang
  function selectProduct(p) {
    setSelected(p);
    setCheckedIds(p.images.map((i) => i.id));
  }

  function toggleImage(imageId) {
    setCheckedIds((prev) =>
      prev.includes(imageId) ? prev.filter((id) => id !== imageId) : [...prev, imageId]
    );
  }

  function toggleAll() {
    if (!selected) return;
    const allIds = selected.images.map((i) => i.id);
    setCheckedIds(checkedIds.length === allIds.length ? [] : allIds);
  }

  // Preview caption yang akan dikirim
  function previewCaption() {
    if (!selected) return "";
    let text = `*${selected.name}*`;
    if (selected.description) text += `\n${selected.description}`;
    if (includePrice && selected.price) {
      const harga = `Rp${selected.price.toLocaleString("id-ID")}`;
      text += `\n\n💰 ${selected.priceUnit ? `${selected.priceUnit} ` : ""}${harga}`;
    }
    return text;
  }

  async function handleSend() {
    if (!selected || !checkedIds.length) return;
    setSending(true);
    try {
      const result = await api.sendProduct(conversation.id, {
        productId: selected.id,
        imageIds: checkedIds,
        includePrice,
      });
      onSent(result.messages || []);
    } catch (err) {
      alert(`Gagal kirim produk: ${err.message}`);
    } finally {
      setSending(false);
    }
  }

  // Filter list produk
  const filtered = products.filter((p) => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase());
    const matchKat    = kategori === KATEGORI_ALL || p.category === kategori;
    return matchSearch && matchKat;
  });

  const customerName = conversation?.customer?.name || "pelanggan";

  return (
    <div className="product-picker-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="product-picker-panel">
        {/* Header */}
        <div className="product-picker-header">
          {selected ? (
            <button className="btn-icon" onClick={() => setSelected(null)} title="Kembali">
              <ChevronLeft size={16} />
            </button>
          ) : <span />}
          <span className="product-picker-title">
            {selected ? selected.name : "Galeri Produk"}
          </span>
          <button className="btn-icon" onClick={onClose} title="Tutup">
            <X size={16} />
          </button>
        </div>

        {/* Panel list produk */}
        {!selected && (
          <>
            {/* Search + filter */}
            <div className="product-picker-search-bar">
              <div className="search-input-wrap">
                <Search size={13} style={{ color: "var(--text-muted)" }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari produk..."
                />
              </div>
              <div className="product-picker-kategori">
                {KATEGORI_OPTIONS.map((k) => (
                  <button
                    key={k}
                    className={`picker-kat-btn ${kategori === k ? "active" : ""}`}
                    onClick={() => setKategori(k)}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            {/* List */}
            <div className="product-picker-list">
              {loading && <p className="empty">Memuat produk...</p>}
              {!loading && filtered.length === 0 && (
                <p className="empty">Tidak ada produk ditemukan.</p>
              )}
              {filtered.map((p) => {
                const thumb = p.images?.[0];
                const harga = formatHarga(p.price, p.priceUnit);
                return (
                  <button key={p.id} className="picker-product-item" onClick={() => selectProduct(p)}>
                    <div className="picker-product-thumb">
                      {thumb
                        ? <img src={thumb.url} alt={p.name} />
                        : <Package size={20} style={{ opacity: 0.3 }} />
                      }
                    </div>
                    <div className="picker-product-info">
                      <span className="picker-product-name">{p.name}</span>
                      {p.category && <span className="picker-product-cat">{p.category}</span>}
                      {harga && <span className="picker-product-price">{harga}</span>}
                      {p.description && (
                        <span className="picker-product-desc">{p.description}</span>
                      )}
                    </div>
                    <div className="picker-product-count">
                      {p.images?.length || 0} foto
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Panel detail produk (setelah dipilih) */}
        {selected && (
          <div className="product-picker-detail">
            {/* Grid gambar dengan checkbox */}
            {selected.images.length === 0 ? (
              <p className="empty">Produk ini belum punya foto.<br />Upload foto di halaman Galeri Produk.</p>
            ) : (
              <>
                <div className="picker-images-header">
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {checkedIds.length}/{selected.images.length} foto dipilih
                  </span>
                  <button onClick={toggleAll} className="btn btn-secondary btn-sm">
                    {checkedIds.length === selected.images.length ? "Batal Semua" : "Pilih Semua"}
                  </button>
                </div>
                <div className="picker-images-grid">
                  {selected.images.map((img) => {
                    const checked = checkedIds.includes(img.id);
                    return (
                      <button
                        key={img.id}
                        className={`picker-image-item ${checked ? "checked" : ""}`}
                        onClick={() => toggleImage(img.id)}
                      >
                        <img src={img.url} alt={img.label || "Foto"} />
                        <div className="picker-image-check">
                          {checked && <Check size={12} />}
                        </div>
                        {img.label && (
                          <span className="picker-image-label">{img.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* Opsi + preview caption */}
            <div className="picker-options">
              <label className="picker-option-row">
                <input type="checkbox"
                  checked={includePrice}
                  onChange={(e) => setIncludePrice(e.target.checked)} />
                <span>Sertakan harga</span>
              </label>
            </div>

            {/* Preview caption */}
            <div className="picker-caption-preview">
              <div className="picker-caption-label">Preview caption (gambar terakhir):</div>
              <div className="picker-caption-text">{previewCaption()}</div>
            </div>

            {/* Tombol kirim */}
            <button
              className="btn btn-primary"
              style={{ margin: "0 16px 16px", width: "calc(100% - 32px)" }}
              onClick={handleSend}
              disabled={sending || checkedIds.length === 0}
            >
              {sending
                ? `Mengirim ${checkedIds.length} foto...`
                : <><SendHorizonal size={14} /> Kirim ke {customerName} ({checkedIds.length} foto)</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
