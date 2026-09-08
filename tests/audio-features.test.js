import test from "node:test";
import assert from "node:assert/strict";

import {
  FEATURE_BAND_COUNT,
  addFeatureFrame,
  aggregateTrainingSamples,
  analyzeLearnedSpectrum,
  createFeatureAccumulator,
  extractFeatureVector,
  finalizeFeatureAccumulator,
} from "../shared/audio-features.js";

test("FFTから32帯域の正規化特徴量を作る", () => {
  const bins = new Float32Array(2048).fill(-90);
  const hzPerBin = 48000 / 4096;
  for (let index = Math.floor(4000 / hzPerBin); index < 5000 / hzPerBin; index += 1) bins[index] = -30;
  const vector = extractFeatureVector(bins, 48000, 4096);
  assert.equal(vector.length, FEATURE_BAND_COUNT);
  assert.equal(Math.max(...vector), 0);
  assert.ok(Math.min(...vector) >= -48);
});

test("複数フレームの平均と標準偏差を作る", () => {
  const accumulator = createFeatureAccumulator();
  const first = Array(FEATURE_BAND_COUNT).fill(-30);
  const second = Array(FEATURE_BAND_COUNT).fill(-30);
  first[0] = -10;
  second[0] = -12;
  addFeatureFrame(accumulator, first);
  addFeatureFrame(accumulator, second);
  const result = finalizeFeatureAccumulator(accumulator);
  assert.equal(result.frameCount, 2);
  assert.equal(result.bandsHz.length, FEATURE_BAND_COUNT);
  assert.equal(result.meanDb[0], -11);
  assert.equal(result.stdDb[0], 1);
  assert.equal(result.stdDb[1], 0);
});

test("虫名ごとに録音を統合して判別データを作る", () => {
  const features = {
    frameCount: 10,
    meanDb: Array.from({ length: FEATURE_BAND_COUNT }, (_, index) => -index),
    stdDb: Array(FEATURE_BAND_COUNT).fill(1),
  };
  const database = aggregateTrainingSamples([
    { speciesName: "スズムシ", features },
    { speciesName: "スズムシ", features },
    { speciesName: "マツムシ", features },
  ], "2026-09-08T00:00:00Z");
  assert.equal(database.profiles.length, 2);
  assert.equal(database.profiles.find(({ name }) => name === "スズムシ").recordingCount, 2);
});

test("学習プロファイルと近いスペクトルを判別する", () => {
  const bins = new Float32Array(2048).fill(-90);
  const hzPerBin = 48000 / 4096;
  for (let index = Math.floor(3900 / hzPerBin); index < 5200 / hzPerBin; index += 1) bins[index] = -30;
  const meanDb = extractFeatureVector(bins, 48000, 4096);
  const database = {
    profiles: [{ id: "learned-test", name: "スズムシ", meanDb }],
  };
  const result = analyzeLearnedSpectrum(bins, 48000, 4096, -28, database);
  assert.ok(result.species[0].confidence > 0.9);
  assert.ok(result.species[0].confidence > result.unknown.confidence);
});
