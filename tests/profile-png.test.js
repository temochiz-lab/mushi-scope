import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProfilePackage,
  decodePayloadFromPixels,
  encodePayloadToPixels,
  parseProfilePackage,
  pixelCapacity,
} from "../shared/profile-png.js";

test("メタデータと音声バイト列を学習パッケージへ往復できる", async () => {
  const metadata = { speciesName: "スズムシ", recordedAt: "2026-09-08T19:32:00+09:00" };
  const audio = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
  const packed = await buildProfilePackage(metadata, audio);
  const decoded = await parseProfilePackage(packed);
  assert.deepEqual(decoded.metadata, metadata);
  assert.deepEqual(decoded.audioBytes, audio);
});

test("PNG用RGBピクセルへ大きなデータを往復できる", () => {
  const payload = Uint8Array.from({ length: 200_000 }, (_, index) => (index * 31) & 255);
  const pixels = encodePayloadToPixels(payload, 1024, 832);
  assert.deepEqual(decodePayloadFromPixels(pixels, 1024, 832), payload);
  assert.ok(pixelCapacity(1024, 832) > 600_000);
});

test("軽微な色ずれがあっても量子化して復元できる", () => {
  const payload = Uint8Array.from({ length: 4096 }, (_, index) => index & 255);
  const pixels = encodePayloadToPixels(payload, 128, 64);
  for (let index = 0; index < 1000; index += 4) pixels[index] += index % 8 === 0 ? 5 : -5;
  assert.deepEqual(decodePayloadFromPixels(pixels, 128, 64), payload);
});

test("パッケージの破損をSHA-256で検出する", async () => {
  const packed = await buildProfilePackage({ speciesName: "マツムシ" }, new Uint8Array([1, 2, 3]));
  packed[20] ^= 1;
  await assert.rejects(() => parseProfilePackage(packed), /破損/);
});
