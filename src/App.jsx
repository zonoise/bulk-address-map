import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  CheckCircle2,
  CopyPlus,
  Download,
  Eraser,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { buildPastePreview, looksLikeDelimitedTable } from "./addressPaste";

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const fallbackCoordinates = [
  {
    match: "東京都千代田区丸の内1丁目",
    lat: 35.681236,
    lng: 139.767125,
    displayName: "東京都千代田区丸の内1丁目付近",
  },
  {
    match: "大阪市北区梅田3丁目",
    lat: 34.702485,
    lng: 135.495951,
    displayName: "大阪府大阪市北区梅田3丁目付近",
  },
  {
    match: "札幌市中央区北1条西2丁目",
    lat: 43.062096,
    lng: 141.354376,
    displayName: "北海道札幌市中央区北1条西2丁目付近",
  },
];

const initialRows = [
  {
    id: crypto.randomUUID(),
    name: "",
    address: "東京都千代田区丸の内1丁目",
    status: "success",
    lat: 35.681236,
    lng: 139.767125,
    displayName: "東京都千代田区丸の内1丁目付近",
  },
  {
    id: crypto.randomUUID(),
    name: "",
    address: "大阪市北区梅田3丁目",
    status: "success",
    lat: 34.702485,
    lng: 135.495951,
    displayName: "大阪府大阪市北区梅田3丁目付近",
  },
  {
    id: crypto.randomUUID(),
    name: "",
    address: "札幌市中央区北1条西2丁目",
    status: "idle",
    lat: null,
    lng: null,
    displayName: "",
  },
];

const statusMeta = {
  idle: { label: "未検索", icon: MapPin },
  loading: { label: "検索中", icon: Search },
  success: { label: "表示済み", icon: CheckCircle2 },
  error: { label: "エラー", icon: TriangleAlert },
};

function normalizeAddress(value) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function draftLines(value) {
  return value.split(/\n+/).map(normalizeAddress).filter(Boolean);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeWithGsi(address) {
  const params = new URLSearchParams({ q: normalizeAddress(address) });
  const response = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?${params}`);

  if (!response.ok) {
    throw new Error("国土地理院の住所検索から応答がありません");
  }

  const [feature] = await response.json();
  if (!feature?.geometry?.coordinates) {
    throw new Error("国土地理院で候補が見つかりませんでした");
  }

  const [lng, lat] = feature.geometry.coordinates;
  return {
    lat: Number(lat),
    lng: Number(lng),
    displayName: feature.properties?.title ? `${feature.properties.title}（国土地理院）` : "国土地理院の検索結果",
  };
}

async function geocodeAddress(address) {
  const normalized = normalizeAddress(address);
  const fallback = fallbackCoordinates.find((item) => normalized.includes(item.match));

  try {
    return await geocodeWithGsi(normalized);
  } catch (error) {
    if (fallback) return fallback;
    throw error instanceof Error ? error : new Error("国土地理院で候補が見つかりませんでした");
  }
}

function StatusPill({ status }) {
  const meta = statusMeta[status] ?? statusMeta.idle;
  const Icon = meta.icon;

  return (
    <span className={`status status-${status}`}>
      <Icon size={13} />
      {meta.label}
    </span>
  );
}

function AddressMap({ rows, selectedId, onSelect, fitSignal }) {
  const mapNode = useRef(null);
  const map = useRef(null);
  const markers = useRef(L.layerGroup());
  const validRows = useMemo(
    () => rows.filter((row) => row.status === "success" && Number.isFinite(row.lat) && Number.isFinite(row.lng)),
    [rows],
  );

  useEffect(() => {
    if (!mapNode.current || map.current) return;

    map.current = L.map(mapNode.current, {
      zoomControl: false,
      attributionControl: false,
    }).setView([36.2048, 138.2529], 5);

    L.control.zoom({ position: "topright" }).addTo(map.current);
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map.current);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);

    markers.current.addTo(map.current);
  }, []);

  useEffect(() => {
    if (!map.current) return;

    markers.current.clearLayers();
    validRows.forEach((row, index) => {
      const popupTitle = row.name ? `${index + 1}. ${row.name}` : `${index + 1}. ${row.address}`;
      const marker = L.marker([row.lat, row.lng], {
        title: row.name || row.address,
        zIndexOffset: row.id === selectedId ? 1000 : index,
      });

      marker.bindPopup(`
        <strong>${escapeHtml(popupTitle)}</strong>
        ${row.name ? `<span class="popup-address">${escapeHtml(row.address)}</span>` : ""}
        <span>${escapeHtml(row.displayName || "検索結果")}</span>
      `);
      marker.on("click", () => onSelect(row.id));
      marker.addTo(markers.current);

      if (row.id === selectedId) {
        marker.openPopup();
      }
    });
  }, [validRows, selectedId, onSelect]);

  useEffect(() => {
    if (!map.current || validRows.length === 0) return;

    const bounds = L.latLngBounds(validRows.map((row) => [row.lat, row.lng]));
    map.current.fitBounds(bounds, {
      padding: [60, 60],
      maxZoom: validRows.length === 1 ? 15 : 13,
    });
  }, [fitSignal, validRows]);

  return <div ref={mapNode} className="map-canvas" aria-label="住所ピンの地図" />;
}

export function App() {
  const [rows, setRows] = useState(initialRows);
  const [draft, setDraft] = useState("");
  const [draftEntries, setDraftEntries] = useState([]);
  const [pasteNotice, setPasteNotice] = useState("");
  const [pastePreview, setPastePreview] = useState(null);
  const [selectedPasteColumn, setSelectedPasteColumn] = useState("");
  const [selectedId, setSelectedId] = useState(initialRows[0].id);
  const [fitSignal, setFitSignal] = useState(0);
  const [isSearching, setIsSearching] = useState(false);

  const stats = useMemo(() => {
    const success = rows.filter((row) => row.status === "success").length;
    const errors = rows.filter((row) => row.status === "error").length;
    return {
      total: rows.length,
      success,
      errors,
      waiting: rows.length - success - errors,
    };
  }, [rows]);

  const selectedRow = rows.find((row) => row.id === selectedId) ?? rows[0];
  const hasDraftContent = draft.trim().length > 0;
  const hasUnsearchedRows = rows.some((row) => row.status === "idle" && row.address.trim());
  const addButtonClass = hasDraftContent ? "primary-button" : "secondary-button";
  const mapButtonClass = !hasDraftContent && hasUnsearchedRows ? "primary-button" : "secondary-button";

  function appendDraftEntries(entries) {
    const currentLines = draftLines(draft);
    const currentEntries =
      draftEntries.length === currentLines.length
        ? currentLines.map((address, index) => ({ address, name: draftEntries[index]?.name ?? "" }))
        : currentLines.map((address) => ({ address, name: "" }));
    const nextEntries = [
      ...currentEntries,
      ...entries.map((entry) => ({
        address: normalizeAddress(entry.address ?? ""),
        name: normalizeAddress(entry.name ?? ""),
      })),
    ].filter((entry) => entry.address);

    setDraft(nextEntries.map((entry) => entry.address).join("\n"));
    setDraftEntries(nextEntries);
  }

  function addDraftRows() {
    const lines = draftLines(draft);
    const additions = lines
      .map((address, index) => ({
        id: crypto.randomUUID(),
        name: draftEntries.length === lines.length ? draftEntries[index]?.name ?? "" : "",
        address,
        status: "idle",
        lat: null,
        lng: null,
        displayName: "",
      }));

    if (additions.length === 0) return;
    setRows((current) => [...current, ...additions]);
    setSelectedId(additions[0].id);
    setDraft("");
    setDraftEntries([]);
    setPasteNotice("");
    setPastePreview(null);
  }

  function handleDraftPaste(event) {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const looksLikeTable = html.includes("<table") || looksLikeDelimitedTable(text);

    if (!looksLikeTable) {
      setPasteNotice("");
      return;
    }

    const preview = buildPastePreview({ html, text });
    if (!preview || preview.columns.length === 0) {
      setPasteNotice("表から住所列を見つけられませんでした。住所列だけコピーすると確実です。");
      setPastePreview(null);
      return;
    }

    event.preventDefault();
    setPastePreview(preview);
    setSelectedPasteColumn(preview.selectedKey);
    setPasteNotice(`表を検出しました。${preview.rowCount}行から住所列を選んでください。`);
  }

  function applyPastePreview() {
    const selected = pastePreview?.columns.find((column) => column.key === selectedPasteColumn);
    if (!selected || selected.values.length === 0) {
      setPasteNotice("この列には追加できる住所がありません。別の列を選んでください。");
      return;
    }

    appendDraftEntries(selected.records ?? selected.values.map((address) => ({ address, name: "" })));
    setPasteNotice(`「${selected.label}」列から${selected.values.length}件反映しました。`);
    setPastePreview(null);
    setSelectedPasteColumn("");
  }

  function cancelPastePreview() {
    setPastePreview(null);
    setSelectedPasteColumn("");
    setPasteNotice("");
  }

  function updateRow(id, patch) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function searchRow(row) {
    if (!row.address.trim()) return;

    updateRow(row.id, { status: "loading", error: "" });
    try {
      const result = await geocodeAddress(row.address);
      updateRow(row.id, {
        status: "success",
        lat: result.lat,
        lng: result.lng,
        displayName: result.displayName,
        error: "",
      });
      setSelectedId(row.id);
      setFitSignal((value) => value + 1);
    } catch (error) {
      updateRow(row.id, {
        status: "error",
        lat: null,
        lng: null,
        displayName: "",
        error: error instanceof Error ? error.message : "検索に失敗しました",
      });
    }
  }

  async function searchAll() {
    const targets = rows.filter((row) => row.address.trim() && row.status === "idle");
    if (targets.length === 0) return;

    setIsSearching(true);
    for (const row of targets) {
      await searchRow(row);
      await wait(900);
    }
    setIsSearching(false);
    setFitSignal((value) => value + 1);
  }

  function removeRow(id) {
    setRows((current) => current.filter((row) => row.id !== id));
    if (selectedId === id) {
      const next = rows.find((row) => row.id !== id);
      setSelectedId(next?.id ?? "");
    }
  }

  function clearResults() {
    setRows((current) =>
      current.map((row) => ({
        ...row,
        status: "idle",
        lat: null,
        lng: null,
        displayName: "",
        error: "",
      })),
    );
  }

  function exportCsv() {
    const header = ["名称", "住所", "ステータス", "緯度", "経度", "検索結果"];
    const lines = rows.map((row) =>
      [row.name ?? "", row.address, statusMeta[row.status]?.label ?? row.status, row.lat ?? "", row.lng ?? "", row.displayName ?? ""]
        .map((value) => `"${String(value).replaceAll('"', '""')}"`)
        .join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "address-map-results.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="app-shell">
      <aside className="console-panel" aria-label="住所操作パネル">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Bulk Address Map</p>
            <h1>住所マップ</h1>
          </div>
          <button className="icon-button" onClick={() => setFitSignal((value) => value + 1)} title="すべてのピンを表示">
            <LocateFixed size={18} />
          </button>
        </div>

        <section className="input-section" aria-label="住所入力">
          <label htmlFor="address-draft">住所を改行区切りで追加</label>
          <textarea
            id="address-draft"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setDraftEntries([]);
              setPastePreview(null);
            }}
            onPaste={handleDraftPaste}
            placeholder={"例: 京都市中京区寺町通御池上る上本能寺前町488\n福岡市博多区博多駅中央街1-1"}
          />
          {pasteNotice && <p className="paste-notice">{pasteNotice}</p>}
          {pastePreview && (
            <div className="paste-preview" aria-label="貼り付けプレビュー">
              <div className="paste-preview-head">
                <div>
                  <strong>貼り付けプレビュー</strong>
                  <span>
                    {pastePreview.rowCount}行 / {pastePreview.sourceColumnCount}列
                  </span>
                </div>
                <button className="text-button" onClick={cancelPastePreview}>
                  キャンセル
                </button>
              </div>
              <label htmlFor="paste-column">住所として使う列</label>
              <select
                id="paste-column"
                value={selectedPasteColumn}
                onChange={(event) => setSelectedPasteColumn(event.target.value)}
              >
                {pastePreview.columns.map((column) => (
                  <option key={column.key} value={column.key}>
                    {column.label}（{column.count}件）
                  </option>
                ))}
              </select>
              <div className="paste-samples">
                {(pastePreview.columns.find((column) => column.key === selectedPasteColumn)?.sample ?? []).map(
                  (sample) => (
                    <span key={sample}>{sample}</span>
                  ),
                )}
              </div>
              <button className="secondary-button" onClick={applyPastePreview}>
                <CopyPlus size={16} />
                この列を使う
              </button>
            </div>
          )}
          <div className="step-hint" aria-label="操作ステップ">
            <span>1. 住所を貼り付ける</span>
            <span>2. 住所リストに追加</span>
            <span>3. 地図に表示</span>
          </div>
          <div className="action-grid">
            <button className={addButtonClass} onClick={addDraftRows} disabled={!hasDraftContent}>
              <CopyPlus size={16} />
              住所リストに追加
            </button>
            <button className={mapButtonClass} onClick={searchAll} disabled={isSearching || !hasUnsearchedRows}>
              <Search size={16} />
              {isSearching ? "表示中" : "地図に表示"}
            </button>
          </div>
        </section>

        <section className="summary-strip" aria-label="検索状況">
          <div>
            <strong>{stats.total}</strong>
            <span>住所</span>
          </div>
          <div>
            <strong>{stats.success}</strong>
            <span>表示済み</span>
          </div>
          <div>
            <strong>{stats.waiting}</strong>
            <span>未検索</span>
          </div>
          <div>
            <strong>{stats.errors}</strong>
            <span>エラー</span>
          </div>
        </section>

        <section className="list-section" aria-label="住所一覧">
          <div className="section-toolbar">
            <h2>住所一覧</h2>
            <div className="toolbar-actions">
              <button className="icon-button" onClick={clearResults} title="検索結果をクリア">
                <Eraser size={16} />
              </button>
              <button className="icon-button" onClick={exportCsv} title="CSV保存">
                <Download size={16} />
              </button>
            </div>
          </div>

          <div className="address-list">
            {rows.map((row, index) => (
              <article
                key={row.id}
                className={`address-row ${row.id === selectedId ? "is-selected" : ""}`}
                onClick={() => setSelectedId(row.id)}
              >
                <div className="row-index">{index + 1}</div>
                <div className="row-main">
                  {row.name && <span className="row-place-name">{row.name}</span>}
                  <input
                    className="row-title row-address-input"
                    value={row.address}
                    placeholder="住所を入力"
                    onChange={(event) =>
                      updateRow(row.id, {
                        address: event.target.value,
                        name: row.name ?? "",
                        status: row.status === "success" ? "idle" : row.status,
                        lat: row.status === "success" ? null : row.lat,
                        lng: row.status === "success" ? null : row.lng,
                        displayName: row.status === "success" ? "" : row.displayName,
                      })
                    }
                    onFocus={() => setSelectedId(row.id)}
                    onClick={(event) => event.stopPropagation()}
                  />
                  <div className="row-meta">
                    <StatusPill status={row.status} />
                    {row.status === "success" && <span>{row.lat.toFixed(5)}, {row.lng.toFixed(5)}</span>}
                    {row.status === "error" && <span>{row.error}</span>}
                  </div>
                </div>
                <div className="row-actions">
                  <button
                    className="icon-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      searchRow(row);
                    }}
                    title="この住所を検索"
                  >
                    <Search size={15} />
                  </button>
                  <button
                    className="icon-button danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRow(row.id);
                    }}
                    title="削除"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <button
          className="add-line-button"
          onClick={() => {
            const next = {
              id: crypto.randomUUID(),
              name: "",
              address: "",
              status: "idle",
              lat: null,
              lng: null,
              displayName: "",
            };
            setRows((current) => [...current, next]);
            setSelectedId(next.id);
          }}
        >
          <Plus size={16} />
          空の住所を追加
        </button>
      </aside>

      <section className="map-panel" aria-label="地図表示">
        <div className="map-topbar">
          <div>
            <p className="eyebrow">OpenStreetMap + Leaflet</p>
            <h2>ピン表示</h2>
          </div>
          <div className="map-actions">
            <button className="secondary-button compact" onClick={() => setFitSignal((value) => value + 1)}>
              <LocateFixed size={16} />
              全体表示
            </button>
            <button className="secondary-button compact" onClick={exportCsv}>
              <Download size={16} />
              CSV保存
            </button>
          </div>
        </div>

        <div className="map-wrap">
          <AddressMap rows={rows} selectedId={selectedId} onSelect={setSelectedId} fitSignal={fitSignal} />
          {selectedRow && (
            <div className="selection-card">
              <div className="selection-number">
                <MapPin size={16} />
              </div>
              <div>
                <p>{selectedRow.name || selectedRow.address}</p>
                {selectedRow.name && <strong>{selectedRow.address}</strong>}
                <span>
                  {selectedRow.status === "success"
                    ? selectedRow.displayName
                    : selectedRow.status === "error"
                      ? selectedRow.error
                      : "検索すると地図上にピンが表示されます"}
                </span>
              </div>
            </div>
          )}
        </div>

        <footer className="map-footer">
          <div>
            <strong>{stats.success}</strong>
            <span>件のピンを表示中</span>
          </div>
          <div>
            <strong>国土地理院</strong>
            <span>住所検索の出典</span>
          </div>
          <div>
            <strong>Leaflet</strong>
            <span>地図表示ライブラリ</span>
          </div>
          <div>
            <strong>出典</strong>
            <a href="/third-party-notices.txt" target="_blank" rel="noreferrer">
              ライセンス表示
            </a>
          </div>
        </footer>
      </section>
    </main>
  );
}
