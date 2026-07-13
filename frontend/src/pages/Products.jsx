import React, { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload, ChevronUp, ChevronDown, Package, Tag } from "lucide-react";
import { api } from "../api.js";

const KATEGORI_OPTIONS = ["Upgrade", "Garansi", "Servis", "Info", "Lainnya"];

function formatHarga(price, priceUnit) {
  if (!price) return "-";
  const angka = `Rp${price.toLocaleString("id-ID")}`;
  return priceUnit ? `${priceUnit} ${angka}` : angka;
}

// Kompres gambar di browser sebelum upload
async function compressImage(file, maxWidth = 1600, quality = 0.8) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(img.width  * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" })),
        "image/jpeg",
        quality
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

// ── ProductEditor ─────────────────────────────────────────────────────────────
function ProductEditor({ product, onSaved, onDeleted }) {
  const isNew = !product?.id;
  const [form, setForm] = useState({
    name:        product?.name        || "",
    description: product?.description || "",
    category:    product?.category    || "",
    price:       product?.price       || "",
    priceUnit:   product?.priceUnit   || "",
    active:      product?.active      !== false,
  });
  const [images, setImages]       = useState(product?.images || []);
  const [saving, setSaving]       = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const fileRef                   = useRef(null);

  useEffect(() => {
    setForm({
      name:        product?.name        || "",
      description: product?.description || "",
      category:    product?.category    || "",
      price:       product?.price       || "",
      priceUnit:   product?.priceUnit   || "",
      active:      product?.active      !== false,
    });
    setImages(product?.images || []);
  }, [product?.id]);

  async function handleSave() {
    if (!form.name.trim()) return alert("Nama produk wajib diisi");
    setSaving(true);
    try {
      const payload = { ...form, price: form.price ? parseInt(form.price) : null };
      const saved = isNew
        ? await api.createProduct(payload)
        : await api.updateProduct(product.id, payload);
      onSaved(saved);
    } catch (err) { alert(err.message); }
    finally { setSaving(false); }
  }

  async function handleUploadFiles(files) {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return alert("Hanya file gambar yang diterima");
    if (isNew) return alert("Simpan produk dulu sebelum upload gambar");
    setUploading(true);
    try {
      const fd = new FormData();
      for (const f of imageFiles) {
        const compressed = await compressImage(f);
        fd.append("images", compressed);
      }
      const created = await api.uploadProductImages(product.id, fd);
      const allImages = [...images, ...created];
      setImages(allImages);
      onSaved({ ...product, images: allImages });
    } catch (err) { alert(err.message); }
    finally { setUploading(false); }
  }

  async function handleDeleteImage(imageId) {
    if (!confirm("Hapus gambar ini?")) return;
    try {
      await api.deleteProductImage(imageId);
      const newImages = images.filter((i) => i.id !== imageId);
      setImages(newImages);
      onSaved({ ...product, images: newImages });
    } catch (err) { alert(err.message); }
  }

  async function handleMoveImage(imageId, dir) {
    const idx = images.findIndex((i) => i.id === imageId);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === images.length - 1) return;
    const newImages = [...images];
    const swap = dir === "up" ? idx - 1 : idx + 1;
    [newImages[idx], newImages[swap]] = [newImages[swap], newImages[idx]];
    setImages(newImages);
    // Update sortOrder di backend
    await Promise.all(newImages.map((img, i) =>
      api.updateProductImage(img.id, { sortOrder: i })
    ));
  }

  async function handleUpdateLabel(imageId, label) {
    await api.updateProductImage(imageId, { label: label || null });
    setImages((prev) => prev.map((i) => i.id === imageId ? { ...i, label } : i));
  }

  async function handleDelete() {
    if (!confirm(`Hapus produk "${product.name}"? Semua gambarnya juga akan terhapus.`)) return;
    try {
      await api.deleteProduct(product.id);
      onDeleted(product.id);
    } catch (err) { alert(err.message); }
  }

  return (
    <div className="product-editor">
      <div className="product-editor-header">
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
          {isNew ? "Produk Baru" : "Edit Produk"}
        </h3>
        {!isNew && (
          <button onClick={handleDelete} className="btn btn-danger btn-sm">
            <Trash2 size={13} /> Hapus
          </button>
        )}
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="form-group">
          <label className="form-label">Nama Produk *</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Contoh: Upgrade Lapisan Matras" />
        </div>

        <div className="form-group">
          <label className="form-label">Deskripsi</label>
          <textarea value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Deskripsi singkat produk / layanan..."
            rows={3} style={{ resize: "vertical" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div className="form-group">
            <label className="form-label">Kategori</label>
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">-- Pilih --</option>
              {KATEGORI_OPTIONS.map((k) => <option key={k}>{k}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Satuan Harga</label>
            <select value={form.priceUnit} onChange={(e) => setForm({ ...form, priceUnit: e.target.value })}>
              <option value="">Tidak ada</option>
              <option value="mulai dari">mulai dari</option>
              <option value="per unit">per unit</option>
              <option value="per bulan">per bulan</option>
              <option value="per tahun">per tahun</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Harga (Rupiah)</label>
            <input type="number" value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              placeholder="Contoh: 450000" />
          </div>
          <div style={{ paddingBottom: 1 }}>
            <label className="form-label" style={{ marginBottom: 6 }}>Status</label>
            <div className="toggle-wrap">
              <button className={`toggle ${form.active ? "on" : ""}`}
                onClick={() => setForm({ ...form, active: !form.active })} />
              <span style={{ fontSize: 13 }}>{form.active ? "Aktif" : "Nonaktif"}</span>
            </div>
          </div>
        </div>

        <button onClick={handleSave} disabled={saving} className="btn btn-primary">
          {saving ? "Menyimpan..." : (isNew ? "Buat Produk" : "Simpan Perubahan")}
        </button>
      </div>

      {/* Upload gambar */}
      <div style={{ borderTop: "1px solid var(--border)", padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>
            Foto Produk ({images.length})
          </span>
          <button onClick={() => fileRef.current?.click()} disabled={uploading || isNew}
            className="btn btn-secondary btn-sm">
            <Upload size={13} /> {uploading ? "Mengupload..." : "Upload Foto"}
          </button>
          <input ref={fileRef} type="file" multiple accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleUploadFiles(e.target.files)} />
        </div>

        {isNew && (
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>
            Simpan produk dulu, lalu upload foto.
          </p>
        )}

        {/* Dropzone */}
        {!isNew && (
          <div
            className={`upload-zone ${dragOver ? "drag-over" : ""}`}
            style={{ marginBottom: images.length ? 12 : 0 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleUploadFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
          >
            <div className="upload-zone-icon">🖼️</div>
            <p className="upload-zone-text">Klik atau drag foto ke sini</p>
            <p className="upload-zone-sub">JPG/PNG/WEBP, maks 8 MB per foto (dikompres otomatis)</p>
          </div>
        )}

        {/* Grid gambar */}
        {images.length > 0 && (
          <div className="product-image-grid">
            {images.map((img, idx) => (
              <div key={img.id} className="product-image-item">
                <img src={img.url} alt={img.label || "Foto"} loading="lazy" decoding="async" />
                <div className="product-image-controls">
                  <input
                    key={img.id}
                    defaultValue={img.label || ""}
                    placeholder="Label (Before/After/...)"
                    className="product-image-label-input"
                    onBlur={(e) => handleUpdateLabel(img.id, e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 2 }}>
                    <button onClick={() => handleMoveImage(img.id, "up")}
                      disabled={idx === 0} className="btn-icon" title="Naikan">
                      <ChevronUp size={13} />
                    </button>
                    <button onClick={() => handleMoveImage(img.id, "down")}
                      disabled={idx === images.length - 1} className="btn-icon" title="Turunkan">
                      <ChevronDown size={13} />
                    </button>
                    <button onClick={() => handleDeleteImage(img.id)}
                      className="btn-icon" style={{ color: "var(--color-danger)" }} title="Hapus">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ProductCard ───────────────────────────────────────────────────────────────
function ProductCard({ product, isActive, onClick }) {
  const thumb = product.images?.[0];
  return (
    <button className={`product-card ${isActive ? "active" : ""}`} onClick={onClick}>
      <div className="product-card-thumb">
        {thumb
          ? <img src={thumb.url} alt={product.name} loading="lazy" decoding="async" />
          : <Package size={24} style={{ opacity: 0.3 }} />
        }
      </div>
      <div className="product-card-info">
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span className="product-card-name">{product.name}</span>
          {!product.active && <span className="badge" style={{ background: "#f3f4f6", color: "#9ca3af", fontSize: 10 }}>Nonaktif</span>}
        </div>
        {product.category && (
          <span className="product-card-cat">
            <Tag size={11} /> {product.category}
          </span>
        )}
        <span className="product-card-price">
          {formatHarga(product.price, product.priceUnit)}
        </span>
      </div>
    </button>
  );
}

// ── Main Products Page ────────────────────────────────────────────────────────
export default function Products() {
  const [products, setProducts]   = useState([]);
  const [selected, setSelected]   = useState(null); // produk yang sedang diedit
  const [isNew, setIsNew]         = useState(false);
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await api.getAllProducts();
        setProducts(data);
      } catch (err) { console.error(err); }
      finally { setLoading(false); }
    }
    load();
  }, []);

  function handleSaved(updated) {
    setProducts((prev) => {
      const exists = prev.find((p) => p.id === updated.id);
      return exists ? prev.map((p) => p.id === updated.id ? updated : p) : [updated, ...prev];
    });
    setSelected(updated);
    setIsNew(false);
  }

  function handleDeleted(id) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    setSelected(null);
    setIsNew(false);
  }

  return (
    <div className="products-layout">
      {/* Sidebar list produk */}
      <div className="products-sidebar">
        <div className="products-sidebar-header">
          <span style={{ fontWeight: 700, fontSize: 14 }}>Galeri Produk</span>
          <button className="btn btn-primary btn-sm"
            onClick={() => { setSelected(null); setIsNew(true); }}>
            <Plus size={13} /> Tambah
          </button>
        </div>
        <div className="products-list">
          {loading && <p className="empty">Memuat...</p>}
          {!loading && products.length === 0 && (
            <p className="empty">Belum ada produk.<br />Klik "+ Tambah" untuk mulai.</p>
          )}
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              isActive={selected?.id === p.id && !isNew}
              onClick={() => { setSelected(p); setIsNew(false); }}
            />
          ))}
        </div>
      </div>

      {/* Editor */}
      <div className="products-main">
        {(selected || isNew) ? (
          <ProductEditor
            product={isNew ? null : selected}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center",
            justifyContent: "center", height: "100%", color: "var(--text-muted)", gap: 12 }}>
            <Package size={48} style={{ opacity: 0.2 }} />
            <p style={{ margin: 0, fontSize: 14 }}>Pilih produk untuk edit, atau tambah produk baru</p>
          </div>
        )}
      </div>
    </div>
  );
}
