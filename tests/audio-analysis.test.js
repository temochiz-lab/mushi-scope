import test from "node:test";
import assert from "node:assert/strict";

import {
  INSECT_PROFILES,
  analyzeSpectrum,
  confidenceToOpacity,
  relativeDbToFontSize,
  rmsToDb,
} from "../audio-analysis.js";

test("RMSをdBへ変換する", () => {
  assert.equal(rmsToDb(new Float32Array(8)), -100);
  assert.ok(Math.abs(rmsToDb(new Float32Array([0.5, -0.5])) + 6.02) < 0.1);
});

test("相対音量を18〜64pxへ正規化する", () => {
  assert.equal(relativeDbToFontSize(-30), 18);
  assert.equal(relativeDbToFontSize(0), 64);
  assert.ok(relativeDbToFontSize(-9) > 18 && relativeDbToFontSize(-9) < 64);
});

test("確信度を表示可能な透明度へ変換する", () => {
  assert.equal(confidenceToOpacity(0), 0.18);
  assert.equal(confidenceToOpacity(1), 1);
});

test("強い周波数帯を複数候補の中から検出する", () => {
  const sampleRate = 48000;
  const fftSize = 4096;
  const bins = new Float32Array(fftSize / 2).fill(-92);
  const target = INSECT_PROFILES.find((profile) => profile.id === "suzumushi");
  const hzPerBin = sampleRate / fftSize;

  for (let index = Math.floor(target.minHz / hzPerBin); index < target.maxHz / hzPerBin; index += 1) {
    bins[index] = -38;
  }

  const result = analyzeSpectrum(bins, sampleRate, fftSize, -30);
  const suzumushi = result.species.find((entry) => entry.id === "suzumushi");
  assert.ok(suzumushi.confidence > 0.8);
  assert.ok(suzumushi.confidence > result.unknown.confidence);
});

test("離れた2つの強い帯域を同時に候補にする", () => {
  const sampleRate = 48000;
  const fftSize = 4096;
  const hzPerBin = sampleRate / fftSize;
  const bins = new Float32Array(fftSize / 2).fill(-92);
  const targets = INSECT_PROFILES.filter(({ id }) => id === "enma" || id === "kanetataki");

  for (const target of targets) {
    for (let index = Math.floor(target.minHz / hzPerBin); index < target.maxHz / hzPerBin; index += 1) {
      bins[index] = -40;
    }
  }

  const result = analyzeSpectrum(bins, sampleRate, fftSize, -32);
  for (const target of targets) {
    assert.ok(result.species.find(({ id }) => id === target.id).confidence > 0.75);
  }
});

test("既知帯域が目立たない有音は不明候補になる", () => {
  const bins = new Float32Array(2048).fill(-60);
  const result = analyzeSpectrum(bins, 48000, 4096, -35);
  assert.ok(result.unknown.confidence > 0.5);
});
