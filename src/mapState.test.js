import { describe, expect, it } from "vitest";
import { decodeMapStateFromUrl, encodeMapStateForUrl, exportMapState, importMapState } from "./mapState";

describe("地図状態共有: URLに入れる保存データを作る", () => {
  it("住所一覧から共有用データを作る", () => {
    const payload = exportMapState([
      {
        id: "row-1",
        name: "大阪市役所",
        address: "大阪市北区中之島1-3-20",
        status: "success",
        lat: 34.69387,
        lng: 135.50128,
        displayName: "大阪府大阪市北区中之島一丁目３番２０号（国土地理院）",
      },
    ]);

    expect(payload).toEqual({
      version: 1,
      rows: [
        {
          name: "大阪市役所",
          address: "大阪市北区中之島1-3-20",
          status: "success",
          lat: 34.69387,
          lng: 135.50128,
          displayName: "大阪府大阪市北区中之島一丁目３番２０号（国土地理院）",
          error: "",
        },
      ],
    });
  });

  it("共有用データから画面の住所行を復元する", () => {
    const rows = importMapState(
      {
        version: 1,
        rows: [
          {
            name: "都庁",
            address: "東京都新宿区西新宿2-8-1",
            status: "success",
            lat: 35.68963,
            lng: 139.69177,
            displayName: "東京都新宿区西新宿二丁目８番１号（国土地理院）",
          },
        ],
      },
      { createId: () => "restored-1" },
    );

    expect(rows).toEqual([
      {
        id: "restored-1",
        name: "都庁",
        address: "東京都新宿区西新宿2-8-1",
        status: "success",
        lat: 35.68963,
        lng: 139.69177,
        displayName: "東京都新宿区西新宿二丁目８番１号（国土地理院）",
        error: "",
      },
    ]);
  });

  it("座標がないsuccess行は未検索として復元する", () => {
    const rows = importMapState(
      {
        version: 1,
        rows: [
          {
            name: "都庁",
            address: "東京都新宿区西新宿2-8-1",
            status: "success",
            lat: null,
            lng: null,
            displayName: "検索済みのように見える値",
          },
        ],
      },
      { createId: () => "restored-1" },
    );

    expect(rows[0]).toMatchObject({
      status: "idle",
      lat: null,
      lng: null,
      displayName: "",
    });
  });

  it("日本語を含む共有用データをURL用文字列に変換して戻せる", () => {
    const payload = {
      version: 1,
      rows: [
        {
          name: "大阪市役所",
          address: "大阪市北区中之島1-3-20",
          status: "success",
          lat: 34.69387,
          lng: 135.50128,
          displayName: "大阪府大阪市北区中之島一丁目３番２０号（国土地理院）",
          error: "",
        },
      ],
    };

    expect(decodeMapStateFromUrl(encodeMapStateForUrl(payload))).toEqual(payload);
  });
});
