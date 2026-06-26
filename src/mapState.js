import { createId } from "./createId";

const MAP_STATE_VERSION = 1;
const VALID_STATUSES = new Set(["idle", "success", "error"]);

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function exportMapState(rows) {
  return {
    version: MAP_STATE_VERSION,
    rows: rows
      .map((row) => ({
        name: cleanText(row.name),
        address: cleanText(row.address),
        status: row.status === "success" || row.status === "error" ? row.status : "idle",
        lat: cleanNumber(row.lat),
        lng: cleanNumber(row.lng),
        displayName: cleanText(row.displayName),
        error: cleanText(row.error),
      }))
      .filter((row) => row.address),
  };
}

export function importMapState(payload, { createId: makeRowId = createId } = {}) {
  if (!payload || payload.version !== MAP_STATE_VERSION || !Array.isArray(payload.rows)) {
    throw new Error("共有データの形式が正しくありません");
  }

  const rows = payload.rows
    .map((row) => {
      const address = cleanText(row.address);
      if (!address) return null;

      const lat = cleanNumber(row.lat);
      const lng = cleanNumber(row.lng);
      const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
      const incomingStatus = VALID_STATUSES.has(row.status) ? row.status : "idle";
      const status = incomingStatus === "success" && !hasCoordinates ? "idle" : incomingStatus;

      return {
        id: makeRowId(),
        name: cleanText(row.name),
        address,
        status,
        lat: status === "success" ? lat : null,
        lng: status === "success" ? lng : null,
        displayName: status === "success" ? cleanText(row.displayName) : "",
        error: status === "error" ? cleanText(row.error) : "",
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    throw new Error("共有データに住所がありません");
  }

  return rows;
}

export function encodeMapStateForUrl(payload) {
  const binary = unescape(encodeURIComponent(JSON.stringify(payload)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeMapStateFromUrl(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return JSON.parse(decodeURIComponent(escape(binary)));
}
