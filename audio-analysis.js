export const INSECT_PROFILES = [
  { id: "kutsuwamushi", name: "クツワムシ", minHz: 1500, maxHz: 2700 },
  { id: "enma", name: "エンマコオロギ", minHz: 2700, maxHz: 3900 },
  { id: "suzumushi", name: "スズムシ", minHz: 3900, maxHz: 5200 },
  { id: "matsumushi", name: "マツムシ", minHz: 5200, maxHz: 6500 },
  { id: "kanetataki", name: "カネタタキ", minHz: 6500, maxHz: 8500 },
];

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function rmsToDb(samples) {
  if (!samples.length) return -100;
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / samples.length);
  return clamp(20 * Math.log10(Math.max(rms, 1e-5)), -100, 0);
}

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

function percentile(values, ratio) {
  if (!values.length) return -100;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * ratio)];
}

export function analyzeSpectrum(frequencyDb, sampleRate, fftSize, inputDb) {
  const hzPerBin = sampleRate / fftSize;
  const insectStart = Math.floor(1000 / hzPerBin);
  const insectEnd = Math.min(frequencyDb.length, Math.ceil(9000 / hzPerBin));
  const usableSpectrum = Array.from(frequencyDb.slice(insectStart, insectEnd)).filter(Number.isFinite);
  const spectralFloor = percentile(usableSpectrum, 0.35);
  const inputGate = clamp((inputDb + 68) / 26, 0, 1);

  const species = INSECT_PROFILES.map((profile) => {
    const levelDb = averagePowerDb(
      frequencyDb,
      profile.minHz / hzPerBin,
      profile.maxHz / hzPerBin,
    );
    const prominenceDb = levelDb - spectralFloor;
    const confidence = clamp((prominenceDb - 2) / 13, 0, 1) * inputGate;
    return { ...profile, levelDb, prominenceDb, confidence };
  });

  const strongest = Math.max(...species.map((entry) => entry.confidence), 0);
  const unknownConfidence = inputGate * clamp((0.34 - strongest) / 0.34, 0, 1);
  const broadLevelDb = averagePowerDb(frequencyDb, insectStart, insectEnd);

  return {
    species,
    unknown: {
      id: "unknown",
      name: "不明な音",
      levelDb: broadLevelDb,
      prominenceDb: broadLevelDb - spectralFloor,
      confidence: unknownConfidence,
    },
    spectralFloor,
  };
}

export function relativeDbToFontSize(relativeDb) {
  const normalized = clamp((relativeDb + 18) / 18, 0, 1);
  return 18 + normalized * 46;
}

export function confidenceToOpacity(confidence) {
  return clamp(0.18 + confidence * 0.82, 0.18, 1);
}
