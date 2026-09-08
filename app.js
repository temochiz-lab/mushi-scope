import {
  INSECT_PROFILES,
  analyzeSpectrum,
  clamp,
  confidenceToOpacity,
  relativeDbToFontSize,
  rmsToDb,
} from "./audio-analysis.js";

const elements = {
  button: document.querySelector("#toggleButton"),
  buttonText: document.querySelector("#buttonText"),
  status: document.querySelector("#status"),
  statusText: document.querySelector("#statusText"),
  idleMessage: document.querySelector("#idleMessage"),
  meterFill: document.querySelector("#meterFill"),
  levelOutput: document.querySelector("#levelOutput"),
  helperText: document.querySelector("#helperText"),
  errorMessage: document.querySelector("#errorMessage"),
  readings: document.querySelector("#readings"),
  readingsList: document.querySelector("#readingsList"),
};

const allProfiles = [...INSECT_PROFILES, { id: "unknown", name: "不明な音" }];
const displayState = new Map(
  allProfiles.map(({ id }) => [id, { levelDb: -100, confidence: 0, holdUntil: 0 }]),
);
const insectElements = new Map(
  [...document.querySelectorAll("[data-insect]")].map((element) => [element.dataset.insect, element]),
);
const readingElements = new Map();

let audioContext = null;
let microphoneStream = null;
let sourceNode = null;
let analyserNode = null;
let frameId = null;
let isRunning = false;
let frequencyData = null;
let timeData = null;

function buildReadings() {
  for (const profile of allProfiles) {
    const item = document.createElement("li");
    item.innerHTML = `
      <strong>${profile.name}</strong>
      <span class="reading-level">-- dB</span>
      <span class="reading-confidence">--%</span>
    `;
    elements.readingsList.append(item);
    readingElements.set(profile.id, {
      level: item.querySelector(".reading-level"),
      confidence: item.querySelector(".reading-confidence"),
    });
  }
}

function setStatus(label, live = false) {
  elements.statusText.textContent = label;
  elements.status.classList.toggle("is-live", live);
}

function setError(message = "") {
  elements.errorMessage.textContent = message;
  elements.errorMessage.hidden = !message;
}

function updateControls(running) {
  elements.button.classList.toggle("is-running", running);
  elements.buttonText.textContent = running ? "解析を停止する" : "解析をはじめる";
  elements.helperText.textContent = running
    ? "周囲の音を端末内で解析しています"
    : "音声は録音・送信されません";
  elements.readings.hidden = !running;
}

function smoothEntry(rawEntry, now) {
  const current = displayState.get(rawEntry.id);
  const detected = rawEntry.confidence >= 0.2;

  if (detected) current.holdUntil = now + 1600;
  const targetConfidence = detected
    ? rawEntry.confidence
    : now < current.holdUntil
      ? current.confidence * 0.96
      : 0;

  current.levelDb += (rawEntry.levelDb - current.levelDb) * 0.2;
  current.confidence += (targetConfidence - current.confidence) * (detected ? 0.18 : 0.08);
  if (current.confidence < 0.01) current.confidence = 0;
  return current;
}

function renderFrame(analysis, inputDb, now) {
  const rawEntries = [...analysis.species, analysis.unknown];
  const smoothed = rawEntries.map((entry) => ({ ...entry, ...smoothEntry(entry, now) }));
  const visibleEntries = smoothed.filter((entry) => entry.confidence >= 0.06);
  const loudestDb = Math.max(...visibleEntries.map((entry) => entry.levelDb), -100);

  for (const entry of smoothed) {
    const node = insectElements.get(entry.id);
    const visible = entry.confidence >= 0.06;
    node.classList.toggle("is-visible", visible);
    node.setAttribute("aria-hidden", String(!visible));
    node.style.opacity = visible ? confidenceToOpacity(entry.confidence).toFixed(2) : "0";
    node.style.fontSize = `${relativeDbToFontSize(entry.levelDb - loudestDb).toFixed(1)}px`;

    const reading = readingElements.get(entry.id);
    reading.level.textContent = Number.isFinite(entry.levelDb) ? `${entry.levelDb.toFixed(0)} dB` : "-- dB";
    reading.confidence.textContent = `${Math.round(entry.confidence * 100)}%`;
  }

  const meterPercent = clamp(((inputDb + 75) / 60) * 100, 0, 100);
  elements.meterFill.style.width = `${meterPercent.toFixed(1)}%`;
  elements.levelOutput.textContent = `${Math.round(inputDb)} dB`;
}

function analyzeLoop(now) {
  if (!isRunning || !analyserNode) return;

  analyserNode.getFloatFrequencyData(frequencyData);
  analyserNode.getFloatTimeDomainData(timeData);
  const inputDb = rmsToDb(timeData);
  const analysis = analyzeSpectrum(
    frequencyData,
    audioContext.sampleRate,
    analyserNode.fftSize,
    inputDb,
  );
  renderFrame(analysis, inputDb, now);
  frameId = requestAnimationFrame(analyzeLoop);
}

async function startAnalysis() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("このブラウザではマイク入力を利用できません。HTTPSで開き、最新版のSafariまたはChromeをお試しください。");
  }

  elements.button.disabled = true;
  setError();
  setStatus("マイクを確認中");

  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
    video: false,
  });

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioContextClass({ latencyHint: "interactive" });
  if (audioContext.state === "suspended") await audioContext.resume();

  sourceNode = audioContext.createMediaStreamSource(microphoneStream);
  const highPass = audioContext.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 140;
  highPass.Q.value = 0.7;

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 4096;
  analyserNode.smoothingTimeConstant = 0;
  analyserNode.minDecibels = -100;
  analyserNode.maxDecibels = -10;

  const silentOutput = audioContext.createGain();
  silentOutput.gain.value = 0;
  sourceNode.connect(highPass).connect(analyserNode).connect(silentOutput).connect(audioContext.destination);

  frequencyData = new Float32Array(analyserNode.frequencyBinCount);
  timeData = new Float32Array(analyserNode.fftSize);
  isRunning = true;
  elements.idleMessage.classList.add("is-hidden");
  updateControls(true);
  setStatus("解析中", true);
  elements.button.disabled = false;
  frameId = requestAnimationFrame(analyzeLoop);
}

async function stopAnalysis() {
  isRunning = false;
  if (frameId) cancelAnimationFrame(frameId);
  frameId = null;

  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  sourceNode?.disconnect();
  sourceNode = null;
  analyserNode = null;

  if (audioContext && audioContext.state !== "closed") await audioContext.close();
  audioContext = null;

  for (const state of displayState.values()) {
    state.levelDb = -100;
    state.confidence = 0;
    state.holdUntil = 0;
  }
  for (const node of insectElements.values()) {
    node.classList.remove("is-visible");
    node.style.opacity = "0";
  }

  elements.meterFill.style.width = "0";
  elements.levelOutput.textContent = "-- dB";
  elements.idleMessage.classList.remove("is-hidden");
  elements.idleMessage.querySelector("strong").textContent = "解析を停止しました";
  elements.idleMessage.querySelector("span:last-child").textContent = "もう一度始めるときは下のボタンを押してください";
  updateControls(false);
  setStatus("待機中");
}

function friendlyMicrophoneError(error) {
  if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
    return "マイクの使用が許可されませんでした。ブラウザのサイト設定でマイクを許可して、もう一度お試しください。";
  }
  if (error?.name === "NotFoundError") return "利用できるマイクが見つかりませんでした。";
  if (error?.name === "NotReadableError") return "マイクを使用できません。他のアプリがマイクを使っていないか確認してください。";
  return error?.message || "マイクの開始に失敗しました。ページを再読み込みしてお試しください。";
}

elements.button.addEventListener("click", async () => {
  if (isRunning) {
    elements.button.disabled = true;
    await stopAnalysis();
    elements.button.disabled = false;
    return;
  }

  try {
    await startAnalysis();
  } catch (error) {
    console.error(error);
    await stopAnalysis();
    setError(friendlyMicrophoneError(error));
    setStatus("開始できませんでした");
    elements.button.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  if (isRunning) void stopAnalysis();
});

buildReadings();
