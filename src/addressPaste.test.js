// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildPastePreview, looksLikeDelimitedTable, parseDelimitedText } from "./addressPaste";

describe("住所貼り付け解析: CSVや表データから住所列を取り出す", () => {
  it("複数列のCSVは通常テキストではなく表データとして扱う", () => {
    const csv = [
      "名称,住所,電話",
      "都庁,東京都新宿区西新宿2-8-1,03-5321-1111",
      "大阪市役所,大阪市北区中之島1-3-20,06-6208-8181",
    ].join("\n");

    expect(looksLikeDelimitedTable(csv)).toBe(true);
  });

  it("改行区切りの住所リストは表データとして誤検出しない", () => {
    const text = ["東京都新宿区西新宿2-8-1", "大阪市北区中之島1-3-20"].join("\n");

    expect(looksLikeDelimitedTable(text)).toBe(false);
  });

  it("CSVでは住所列を優先し、名称や電話番号を混ぜずに抽出する", () => {
    const csv = [
      "名称,住所,電話",
      "都庁,東京都新宿区西新宿2-8-1,03-5321-1111",
      "大阪市役所,大阪市北区中之島1-3-20,06-6208-8181",
      "札幌市役所,札幌市中央区北1条西2丁目,011-211-2111",
    ].join("\n");

    const preview = buildPastePreview({ html: "", text: csv });
    const selected = preview.columns.find((column) => column.key === preview.selectedKey);

    expect(preview.rowCount).toBe(3);
    expect(selected.label).toBe("住所");
    expect(selected.values).toEqual([
      "東京都新宿区西新宿2-8-1",
      "大阪市北区中之島1-3-20",
      "札幌市中央区北1条西2丁目",
    ]);
  });

  it("HTMLテーブルでは見出しから住所列を判断して抽出する", () => {
    const html = `
      <table>
        <tr><th>施設名</th><th>住所</th><th>電話</th></tr>
        <tr><td>都庁</td><td>東京都新宿区西新宿2-8-1</td><td>03-5321-1111</td></tr>
        <tr><td>大阪市役所</td><td>大阪市北区中之島1-3-20</td><td>06-6208-8181</td></tr>
      </table>
    `;

    const preview = buildPastePreview({ html, text: "" });
    const selected = preview.columns.find((column) => column.key === preview.selectedKey);

    expect(selected.label).toBe("住所");
    expect(selected.values).toEqual(["東京都新宿区西新宿2-8-1", "大阪市北区中之島1-3-20"]);
  });

  it("所在地ヘッダーも住所列として扱う", () => {
    const csv = [
      "名称,所在地,電話",
      "横浜市役所,神奈川県横浜市中区本町6-50-10,045-671-2121",
      "名古屋市役所,愛知県名古屋市中区三の丸3-1-1,052-961-1111",
    ].join("\n");

    const preview = buildPastePreview({ html: "", text: csv });
    const selected = preview.columns.find((column) => column.key === preview.selectedKey);

    expect(selected.label).toBe("所在地");
    expect(selected.values).toEqual(["神奈川県横浜市中区本町6-50-10", "愛知県名古屋市中区三の丸3-1-1"]);
  });

  it("電話番号やURLなどの非住所列は住所列より優先しない", () => {
    const csv = [
      "施設名,電話,URL,住所",
      "都庁,03-5321-1111,https://www.metro.tokyo.lg.jp/,東京都新宿区西新宿2-8-1",
      "大阪市役所,06-6208-8181,https://www.city.osaka.lg.jp/,大阪市北区中之島1-3-20",
    ].join("\n");

    const preview = buildPastePreview({ html: "", text: csv });
    const labels = preview.columns.map((column) => column.label);
    const selected = preview.columns.find((column) => column.key === preview.selectedKey);

    expect(selected.label).toBe("住所");
    expect(labels).not.toContain("電話");
    expect(labels).not.toContain("URL");
  });

  it("都道府県・市区町村・番地のように分割された住所列は結合して抽出する", () => {
    const csv = [
      "名称,都道府県,市区町村,番地,電話",
      "都庁,東京都,新宿区西新宿,2-8-1,03-5321-1111",
      "大阪市役所,大阪府,大阪市北区中之島,1-3-20,06-6208-8181",
    ].join("\n");

    const preview = buildPastePreview({ html: "", text: csv });
    const selected = preview.columns.find((column) => column.key === preview.selectedKey);

    expect(selected.label).toBe("住所系の列を結合");
    expect(selected.values).toEqual(["東京都 新宿区西新宿 2-8-1", "大阪府 大阪市北区中之島 1-3-20"]);
  });

  it("タブ区切りの表テキストは行と列に分解する", () => {
    expect(parseDelimitedText("名称\t住所\n都庁\t東京都新宿区西新宿2-8-1")).toEqual([
      ["名称", "住所"],
      ["都庁", "東京都新宿区西新宿2-8-1"],
    ]);
  });
});
