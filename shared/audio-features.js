export const FEATURE_MIN_HZ = 1200;
export const FEATURE_MAX_HZ = 9000;
export const FEATURE_BAND_COUNT = 32;

export const FEATURE_BANDS_HZ = Array.from(
  { length: FEATURE_BAND_COUNT },
  (_, index) => Math.round(
    FEATURE_MIN_HZ * (FEATURE_MAX_HZ / FEATURE_MIN_HZ) ** (index / (FEATURE_BAND_COUNT - 1)),
  ),
);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function averagePowerDb(values, start, end) {
  const first = clamp(Math.floor(start), 0, values.length - 1);
  const last = clamp(Math.ceil(end), first + 1, values.length);
  let power = 0;
  let count = 0;

  for (let index = first; index < last; index += 1) {
    const db = Number.isFinite(values[index]) ? values[index] : -100;
    power += 10 ** (db / 10);
    count += 1;
  }

  return count ? 10 * Math.log10(Math.max(power / count, 1e-10)) : -100;
}

export function extractFeatureVector(frequencyDb, sampleRate, fftSize) {
  const hzPerBin = sampleRate / fftSize;
  const values = FEATURE_BANDS_HZ.map((centerHz, index) => {
    const previous = FEATURE_BANDS_HZ[Math.max(0, index - 1)];
    const next = FEATURE_BANDS_HZ[Math.min(FEATURE_BANDS_HZ.length - 1, index + 1)];
    const minHz = index === 0 ? FEATURE_MIN_HZ : Math.sqrt(previous * centerHz);
    const maxHz = index === FEATURE_BANDS_HZ.length - 1 ? FEATURE_MAX_HZ : Math.sqrt(centerHz * next);
    return averagePowerDb(frequencyDb, minHz / hzPerBin, maxHz / hzPerBin);
  });
  const peak = Math.max(...values);
  return values.map((value) => Math.round(clamp(value - peak, -48, 0) * 10) / 10);
}

export function createFeatureAccumulator(size = FEATURE_BAND_COUNT) {
  return { count: 0, sum: new Float64Array(size), sumSquares: new Float64Array(size) };
}

export function addFeatureFrame(accumulator, vector) {
  if (vector.length !== accumulator.sum.length) throw new Error("特徴量の帯域数が一致しません。");
  accumulator.count += 1;
  vector.forEach((value, index) => {
    accumulator.sum[index] += value;
    accumulator.sumSquares[index] += value * value;
  });
}

export function finalizeFeatureAccumulator(accumulator) {
  if (!accumulator.count) throw new Error("有効な音声フレームがありません。");
  const meanDb = Array.from(accumulator.sum, (sum) => Math.round((sum / accumulator.count) * 10) / 10);
  const stdDb = Array.from(accumulator.sumSquares, (sumSquares, index) => {
    const variance = Math.max(0, sumSquares / accumulator.count - meanDb[index] ** 2);
    return Math.round(Math.sqrt(variance) * 10) / 10;
  });
  return { frameCount: accumulator.count, bandsHz: FEATURE_BANDS_HZ, meanDb, stdDb };
}

function stableId(name) {
  let hash = 2166136261;
  for (const character of name.normalize("NFKC")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `learned-${(hash >>> 0).toString(36)}`;
}

export function aggregateTrainingSamples(samples, generatedAt = new Date().toISOString()) {
  const groups = new Map();
  for (const sample of samples) {
    const name = String(sample.speciesName || "").trim();
    const features = sample.features;
    if (!name || !features?.meanDb?.length || features.meanDb.length !== FEATURE_BAND_COUNT) continue;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(features);
  }

  const profiles = [...groups.entries()].map(([name, recordings]) => {
    const totalFrames = recordings.reduce((sum, recording) => sum + Math.max(1, recording.frameCount || 1), 0);
    const meanDb = FEATURE_BANDS_HZ.map((_, index) => {
      const weighted = recordings.reduce(
        (sum, recording) => sum + recording.meanDb[index] * Math.max(1, recording.frameCount || 1),
        0,
      );
      return Math.round((weighted / totalFrames) * 10) / 10;
    });
    const stdDb = FEATURE_BANDS_HZ.map((_, index) => {
      const secondMoment = recordings.reduce((sum, recording) => {
        const frames = Math.max(1, recording.frameCount || 1);
        const std = recording.stdDb?.[index] || 0;
        return sum + (std ** 2 + recording.meanDb[index] ** 2) * frames;
      }, 0) / totalFrames;
      return Math.round(Math.sqrt(Math.max(0, secondMoment - meanDb[index] ** 2)) * 10) / 10;
    });
    return {
      id: stableId(name),
      name,
      recordingCount: recordings.length,
      frameCount: totalFrames,
      meanDb,
      stdDb,
    };
  });

  return {
    schemaVersion: 1,
    generatedAt,
    bandsHz: FEATURE_BANDS_HZ,
    profiles: profiles.sort((a, b) => a.name.localeCompare(b.name, "ja")),
  };
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftLength += left[index] ** 2;
    rightLength += right[index] ** 2;
  }
  return dot / Math.max(Math.sqrt(leftLength * rightLength), 1e-9);
}

export function analyzeLearnedSpectrum(frequencyDb, sampleRate, fftSize, inputDb, database) {
  const observedDb = extractFeatureVector(frequencyDb, sampleRate, fftSize);
  const observedEnergy = observedDb.map((value) => 10 ** (value / 12));
  const inputGate = clamp((inputDb + 68) / 26, 0, 1);
  const hzPerBin = sampleRate / fftSize;

  const species = database.profiles.map((profile) => {
    const referenceEnergy = profile.meanDb.map((value) => 10 ** (value / 12));
    const similarity = cosineSimilarity(observedEnergy, referenceEnergy);
    const confidence = clamp((similarity - 0.68) / 0.3, 0, 1) * inputGate;
    let weightedPower = 0;
    let weightSum = 0;
    profile.meanDb.forEach((value, index) => {
      const weight = 10 ** (value / 10);
      const centerHz = FEATURE_BANDS_HZ[index];
      const bin = clamp(Math.round(centerHz / hzPerBin), 0, frequencyDb.length - 1);
      weightedPower += 10 ** (frequencyDb[bin] / 10) * weight;
      weightSum += weight;
    });
    const levelDb = 10 * Math.log10(Math.max(weightedPower / Math.max(weightSum, 1e-9), 1e-10));
    return { id: profile.id, name: profile.name, levelDb, confidence, similarity };
  });

  const strongest = Math.max(...species.map((entry) => entry.confidence), 0);
  return {
    species,
    unknown: {
      id: "unknown",
      name: "不明な音",
      levelDb: inputDb,
      confidence: inputGate * clamp((0.42 - strongest) / 0.42, 0, 1),
    },
  };
}
