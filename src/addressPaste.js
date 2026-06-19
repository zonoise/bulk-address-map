export function normalizeCell(value) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function parseDelimitedText(text) {
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
        .map(normalizeCell)
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

export function looksLikeDelimitedTable(text) {
  const rows = parseDelimitedText(text);
  const multiColumnRows = rows.filter((row) => row.length > 1);
  return multiColumnRows.length >= 2;
}

export function buildPastePreview({ html, text }) {
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
