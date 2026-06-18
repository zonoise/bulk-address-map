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
    address: "東京都千代田区丸の内1丁目",
    status: "success",
    lat: 35.681236,
    lng: 139.767125,
    displayName: "東京都千代田区丸の内1丁目付近",
  },
  {
    id: crypto.randomUUID(),
    address: "大阪市北区梅田3丁目",
    status: "success",
    lat: 34.702485,
    lng: 135.495951,
    displayName: "大阪府大阪市北区梅田3丁目付近",
  },
  {
    id: crypto.randomUUID(),
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildNominatimQueries(address) {
  const normalized = normalizeAddress(address);
  const spaced = normalized
    .replace(/(都|道|府|県)/g, "$1 ")
    .replace(/(市|区|町|村)/g, "$1 ")
    .replace(/([一-龥ぁ-んァ-ヶー])([0-9０-９])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(new Set([normalized, spaced]));
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

async function geocodeWithNominatim(address) {
  let lastError = new Error("候補が見つかりませんでした");

  for (const query of buildNominatimQueries(address)) {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      addressdetails: "1",
      limit: "1",
      countrycodes: "jp",
      "accept-language": "ja",
    });

    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
      if (!response.ok) {
        throw new Error("Nominatimから応答がありません");
      }
      const [result] = await response.json();
      if (!result) continue;

      return {
        lat: Number(result.lat),
        lng: Number(result.lon),
        displayName: `${result.display_name}（Nominatim）`,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : lastError;
    }
  }

  throw lastError;
}

async function geocodeAddress(address) {
  const normalized = normalizeAddress(address);
  const fallback = fallbackCoordinates.find((item) => normalized.includes(item.match));

  try {
    return await geocodeWithGsi(normalized);
  } catch (error) {
    try {
      return await geocodeWithNominatim(normalized);
    } catch (secondError) {
      if (fallback) return fallback;
      const message =
        secondError instanceof Error
          ? secondError.message
          : error instanceof Error
            ? error.message
            : "候補が見つかりませんでした";
      throw new Error(message);
    }
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map.current);

    markers.current.addTo(map.current);
  }, []);

  useEffect(() => {
    if (!map.current) return;

    markers.current.clearLayers();
    validRows.forEach((row, index) => {
      const marker = L.marker([row.lat, row.lng], {
        title: row.address,
        zIndexOffset: row.id === selectedId ? 1000 : index,
      });

      marker.bindPopup(`
        <strong>${row.address}</strong>
        <span>${row.displayName || "検索結果"}</span>
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

  function addDraftRows() {
    const additions = draft
      .split(/\n+/)
      .map(normalizeAddress)
      .filter(Boolean)
      .map((address) => ({
        id: crypto.randomUUID(),
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
    const targets = rows.filter((row) => row.address.trim() && row.status !== "loading");
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
    const header = ["住所", "ステータス", "緯度", "経度", "検索結果"];
    const lines = rows.map((row) =>
      [row.address, statusMeta[row.status]?.label ?? row.status, row.lat ?? "", row.lng ?? "", row.displayName ?? ""]
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
            <p className="eyebrow">Address Map Console</p>
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
            onChange={(event) => setDraft(event.target.value)}
            placeholder={"例: 京都市中京区寺町通御池上る上本能寺前町488\n福岡市博多区博多駅中央街1-1"}
          />
          <div className="action-grid">
            <button className="secondary-button" onClick={addDraftRows}>
              <CopyPlus size={16} />
              追加
            </button>
            <button className="primary-button" onClick={searchAll} disabled={isSearching || rows.length === 0}>
              <Search size={16} />
              {isSearching ? "検索中" : "一括検索"}
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
                  <input
                    className="row-title row-address-input"
                    value={row.address}
                    placeholder="住所を入力"
                    onChange={(event) =>
                      updateRow(row.id, {
                        address: event.target.value,
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
                <p>{selectedRow.address}</p>
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
            <span>Nominatimは補助検索</span>
          </div>
          <div>
            <strong>Leaflet</strong>
            <span>地図表示ライブラリ</span>
          </div>
        </footer>
      </section>
    </main>
  );
}
