import React, { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useConvSearchQuery, useConversationStore } from "../../stores/conversationStore.js";

const DEBOUNCE_MS = 300;

export default function SearchBar() {
  const storeQuery = useConvSearchQuery();
  const [value, setValue] = useState(storeQuery);
  const debounceRef = useRef(null);

  // Sinkron kalau query berubah dari luar (misal di-reset komponen lain)
  useEffect(() => { setValue(storeQuery); }, [storeQuery]);

  function handleChange(e) {
    const v = e.target.value;
    setValue(v);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      useConversationStore.getState().setSearch(v);
    }, DEBOUNCE_MS);
  }

  function handleClear() {
    setValue("");
    clearTimeout(debounceRef.current);
    useConversationStore.getState().setSearch("");
  }

  return (
    <div className="conv-search-bar">
      <div className="search-input-wrap" style={{ margin: 0 }}>
        <Search size={14} className="search-icon" />
        <input
          className="search-input"
          placeholder="Cari nama, nomor, atau isi pesan..."
          value={value}
          onChange={handleChange}
        />
        {value && (
          <button type="button" className="search-clear-btn" onClick={handleClear} title="Hapus pencarian">
            <X size={13} />
          </button>
        )}
      </div>
    </div>
  );
}
