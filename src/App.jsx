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

function normalizeCell(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseDelimitedText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (line.includes("\t")) return line.split("\t").map(normalizeCell);
      return line.split(",").map(normalizeCell);
    })
    .filter((cells) => cells.some(Boolean));
}

function parseHtmlTable(html) {
  if (!html || !html.includes("<table")) return [];

  const document = new DOMParser().parseFromString(html, "text/html");
  const rows = Array.from(document.querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll("th,td")).map((cell) => normalizeCell(cell.textContent ?? "")),
  );

  return rows.filter((cells) => cells.some(Boolean));
}

const addressHeaderPattern = /(住所|所在地|address)/i;
const addressPartHeaderPattern = /(都道府県|市区町村|市町村|区町村|町名|番地|丁目|地番|建物|ビル)/i;
const nonAddressHeaderPattern = /(電話|tel|fax|メール|mail|url|担当|氏名|名前|会社|店舗|名称|id|コード|備考)/i;

function addressScore(value) {
  const text = normalizeCell(value);
  if (!text) return 0;
  if (/https?:\/\/|@/.test(text)) return -5;
  if (/^[0-9０-９+\-ー()\s]{8,}$/.test(text)) return -4;

  let score = 0;
  if (/[都道府県]/.test(text)) score += 5;
  if (/(市|区|町|村)/.test(text)) score += 3;
  if (/(丁目|番地|番|号|-|ー|−|[0-9０-９])/.test(text)) score += 2;
  if (/〒/.test(text)) score += 1;
  if (text.length >= 8) score += 1;
  if (text.length >= 16) score += 1;
  return score;
}

function uniqueAddresses(values) {
  return Array.from(
    new Set(
      values
        .map(normalizeAddress)
        .filter(Boolean)
        .filter((value) => addressScore(value) >= 2),
    ),
  );
}

function tableRowsFromClipboard({ html, text }) {
  const htmlRows = parseHtmlTable(html);
  const textRows = parseDelimitedText(text);
  return htmlRows.length > 0 ? htmlRows : textRows;
}

function buildPastePreview({ html, text }) {
  const rows = tableRowsFromClipboard({ html, text });
  if (rows.length === 0) return null;

  const columnCount = Math.max(...rows.map((row) => row.length));
  const paddedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ""));
  const header = paddedRows[0];
  const hasHeader = header.some(
    (cell) => addressHeaderPattern.test(cell) || addressPartHeaderPattern.test(cell) || nonAddressHeaderPattern.test(cell),
  );
  const dataRows = hasHeader ? paddedRows.slice(1) : paddedRows;
  const partIndexes = header
    .map((cell, index) => (addressPartHeaderPattern.test(cell) && !nonAddressHeaderPattern.test(cell) ? index : -1))
    .filter((index) => index >= 0);
  const columns = [];

  if (hasHeader && partIndexes.length > 1 && !header.some((cell) => addressHeaderPattern.test(cell))) {
    const values = uniqueAddresses(dataRows.map((row) => partIndexes.map((index) => row[index]).filter(Boolean).join(" ")));
    if (values.length > 0) {
      columns.push({
        key: "combined",
        label: "住所系の列を結合",
        count: values.length,
        sample: values.slice(0, 3),
        values,
        score: 80 + values.length,
      });
    }
  }

  for (let index = 0; index < columnCount; index += 1) {
    const label = hasHeader && header[index] ? header[index] : `列${index + 1}`;
    const rawValues = dataRows.map((row) => row[index]).filter(Boolean);
    const values = uniqueAddresses(rawValues);
    const headerBoost =
      addressHeaderPattern.test(label) ? 70 : addressPartHeaderPattern.test(label) ? 35 : nonAddressHeaderPattern.test(label) ? -60 : 0;
    const contentScore = rawValues.reduce((total, value) => total + Math.max(addressScore(value), 0), 0);

    columns.push({
      key: `column-${index}`,
      label,
      count: values.length,
      sample: values.slice(0, 3),
      values,
      score: headerBoost + contentScore + values.length * 4,
    });
  }

  const scoredColumns = columns.filter((column) => column.count > 0).sort((a, b) => b.score - a.score || b.count - a.count);
  const usefulColumns = scoredColumns.some((column) => column.score > 0)
    ? scoredColumns.filter((column) => column.score > 0)
    : scoredColumns;

  return {
    columns: usefulColumns,
    rowCount: dataRows.length,
    sourceColumnCount: columnCount,
    selectedKey: usefulColumns[0]?.key ?? "",
  };
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

  function appendDraftLines(lines) {
    setDraft((current) => {
      const prefix = current.trim() ? `${current.trimEnd()}\n` : "";
      return `${prefix}${lines.join("\n")}`;
    });
  }

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
    setPasteNotice("");
    setPastePreview(null);
  }

  function handleDraftPaste(event) {
    const html = event.clipboardData.getData("text/html");
    const text = event.clipboardData.getData("text/plain");
    const looksLikeTable = html.includes("<table") || text.includes("\t");

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

    appendDraftLines(selected.values);
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
            onChange={(event) => {
              setDraft(event.target.value);
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
                この列を住所欄に反映
              </button>
            </div>
          )}
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
