import {
  addFeatureFrame,
  createFeatureAccumulator,
  extractFeatureVector,
  finalizeFeatureAccumulator,
} from "../shared/audio-features.js";
import { buildProfilePackage, createProfilePng } from "../shared/profile-png.js";

const elements = {
  species: document.querySelector("#speciesName"),
  duration: document.querySelector("#duration"),
  button: document.querySelector("#recordButton"),
  orb: document.querySelector("#recordOrb"),
  time: document.querySelector("#recordTime"),
  level: document.querySelector("#levelFill"),
  status: document.querySelector("#recordStatus"),
  error: document.querySelector("#errorMessage"),
  result: document.querySelector("#resultPanel"),
  preview: document.querySelector("#pngPreview"),
  resultSpecies: document.querySelector("#resultSpecies"),
  resultDate: document.querySelector("#resultDate"),
  resultDuration: document.querySelector("#resultDuration"),
  resultSize: document.querySelector("#resultSize"),
  share: document.querySelector("#shareButton"),
  download: document.querySelector("#downloadButton"),
};

let stream = null;
let context = null;
let analyser = null;
let recorder = null;
let chunks = [];
let accumulator = null;
let animationId = null;
let startedAt = 0;
let stopTimer = null;
let currentFile = null;
let previewUrl = null;
let frequencyData = null;
let timeData = null;
let lastFeatureAt = 0;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function showError(message = "") {
  elements.error.textContent = message;
  elements.error.hidden = !message;
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function safeFilename(name) {
  return name.normalize("NFKC").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 32) || "unknown";
}

function chooseMimeType() {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || "";
}

function renderRecordingFrame(now) {
  if (!analyser || !recorder || recorder.state !== "recording") return;
  if (now - lastFeatureAt < 100) {
    animationId = requestAnimationFrame(renderRecordingFrame);
    return;
  }
  lastFeatureAt = now;
  analyser.getFloatFrequencyData(frequencyData);
  analyser.getFloatTimeDomainData(timeData);
  addFeatureFrame(accumulator, extractFeatureVector(frequencyData, context.sampleRate, analyser.fftSize));

  let sumSquares = 0;
  for (const sample of timeData) sumSquares += sample * sample;
  const db = 20 * Math.log10(Math.max(Math.sqrt(sumSquares / timeData.length), 1e-5));
  elements.level.style.width = `${clamp(((db + 70) / 55) * 100, 0, 100)}%`;
  const elapsed = Math.floor((performance.now() - startedAt) / 1000);
  elements.time.textContent = `00:${String(elapsed).padStart(2, "0")}`;
  animationId = requestAnimationFrame(renderRecordingFrame);
}

async function cleanupAudio() {
  if (animationId) cancelAnimationFrame(animationId);
  clearTimeout(stopTimer);
  animationId = null;
  stopTimer = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (context && context.state !== "closed") await context.close();
  context = null;
  analyser = null;
}

async function finishRecording() {
  if (!recorder || recorder.state === "inactive") return;
  elements.button.disabled = true;
  elements.status.textContent = "PNGを作成中…";
  recorder.stop();
}

async function createResult(audioBlob) {
  const recordedAt = new Date().toISOString();
  const durationSeconds = Math.max(1, Math.round((performance.now() - startedAt) / 1000));
  const features = finalizeFeatureAccumulator(accumulator);
  const metadata = {
    schemaVersion: 1,
    speciesName: elements.species.value.trim(),
    recordedAt,
    durationSeconds,
    sampleRate: context.sampleRate,
    audioMimeType: audioBlob.type || "application/octet-stream",
    audioBytes: audioBlob.size,
    audioBitsPerSecond: recorder.audioBitsPerSecond || null,
    features,
    source: "mushi-scope-learn",
  };
  const packageBytes = await buildProfilePackage(metadata, new Uint8Array(await audioBlob.arrayBuffer()));
  const png = await createProfilePng(packageBytes, {
    speciesName: metadata.speciesName,
    recordedAt: formatDate(recordedAt),
    durationSeconds,
  });
  const stamp = recordedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  currentFile = new File([png.blob], `${safeFilename(metadata.speciesName)}_${stamp}.png`, { type: "image/png" });

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(currentFile);
  elements.preview.src = previewUrl;
  elements.resultSpecies.textContent = metadata.speciesName;
  elements.resultDate.textContent = formatDate(recordedAt);
  elements.resultDuration.textContent = `${durationSeconds}秒 / ${features.frameCount}フレーム`;
  elements.resultSize.textContent = `${Math.round(packageBytes.length / 1024)}KB / 最大${Math.round(png.capacity / 1024)}KB`;
  elements.result.hidden = false;
  elements.result.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function startRecording() {
  const speciesName = elements.species.value.trim();
  if (!speciesName) {
    showError("虫の名前を入力してください。");
    elements.species.focus();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    showError("このブラウザでは録音できません。HTTPSで最新版のSafariまたはChromeをお試しください。");
    return;
  }

  showError();
  elements.button.disabled = true;
  elements.status.textContent = "マイクを確認中…";
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  context = new AudioContextClass({ latencyHint: "interactive" });
  if (context.state === "suspended") await context.resume();
  const source = context.createMediaStreamSource(stream);
  const highPass = context.createBiquadFilter();
  highPass.type = "highpass";
  highPass.frequency.value = 140;
  analyser = context.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  source.connect(highPass).connect(analyser);

  const mimeType = chooseMimeType();
  recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    audioBitsPerSecond: 64_000,
  });
  chunks = [];
  accumulator = createFeatureAccumulator();
  frequencyData = new Float32Array(analyser.frequencyBinCount);
  timeData = new Float32Array(analyser.fftSize);
  lastFeatureAt = 0;
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener("stop", async () => {
    try {
      const audioBlob = new Blob(chunks, { type: recorder.mimeType || mimeType || "application/octet-stream" });
      await createResult(audioBlob);
      elements.status.textContent = "学習PNGができました";
    } catch (error) {
      console.error(error);
      showError(error.message || "PNGの作成に失敗しました。");
      elements.status.textContent = "作成できませんでした";
    } finally {
      await cleanupAudio();
      recorder = null;
      elements.orb.classList.remove("is-recording");
      elements.button.textContent = "もう一度録音";
      elements.button.classList.remove("danger");
      elements.button.disabled = false;
      elements.level.style.width = "0";
    }
  }, { once: true });

  recorder.start(1000);
  startedAt = performance.now();
  elements.orb.classList.add("is-recording");
  elements.button.textContent = "録音を停止";
  elements.button.classList.add("danger");
  elements.button.disabled = false;
  elements.status.textContent = `${elements.duration.value}秒間録音します`;
  stopTimer = setTimeout(() => void finishRecording(), Number(elements.duration.value) * 1000);
  animationId = requestAnimationFrame(renderRecordingFrame);
}

elements.button.addEventListener("click", async () => {
  try {
    if (recorder?.state === "recording") await finishRecording();
    else await startRecording();
  } catch (error) {
    console.error(error);
    await cleanupAudio();
    recorder = null;
    elements.button.disabled = false;
    elements.status.textContent = "録音できませんでした";
    showError(error.name === "NotAllowedError"
      ? "マイクが許可されませんでした。Safariのサイト設定からマイクを許可してください。"
      : error.message || "録音を開始できませんでした。");
  }
});

elements.download.addEventListener("click", () => {
  if (!currentFile) return;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(currentFile);
  link.download = currentFile.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

elements.share.addEventListener("click", async () => {
  if (!currentFile) return;
  if (navigator.canShare?.({ files: [currentFile] })) {
    try {
      await navigator.share({ files: [currentFile], title: `${elements.resultSpecies.textContent}の学習データ` });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  elements.download.click();
  showError("共有機能を利用できないため、PNGをダウンロードしました。写真へ保存する場合はプレビュー画像を長押ししてください。");
});

window.addEventListener("pagehide", () => void cleanupAudio());
