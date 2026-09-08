import { aggregateTrainingSamples } from "../shared/audio-features.js";
import { decodeProfilePng } from "../shared/profile-png.js";

const elements = {
  input: document.querySelector("#fileInput"),
  drop: document.querySelector("#dropZone"),
  message: document.querySelector("#importMessage"),
  samplesPanel: document.querySelector("#samplesPanel"),
  exportPanel: document.querySelector("#exportPanel"),
  list: document.querySelector("#sampleList"),
  summary: document.querySelector("#summaryStrip"),
  exportButton: document.querySelector("#exportButton"),
  clearButton: document.querySelector("#clearButton"),
};

const samples = [];
const audioUrls = new Set();

function formatDate(iso) {
  try {
    return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return iso || "日時不明";
  }
}

function setMessage(text, error = false) {
  elements.message.textContent = text;
  elements.message.classList.toggle("error", error);
  elements.message.hidden = !text;
}

function updateSummary() {
  const counts = new Map();
  samples.forEach(({ metadata }) => counts.set(metadata.speciesName, (counts.get(metadata.speciesName) || 0) + 1));
  elements.summary.replaceChildren();
  for (const [name, count] of counts) {
    const badge = document.createElement("span");
    badge.textContent = `${name} ${count}件`;
    elements.summary.append(badge);
  }
  elements.samplesPanel.hidden = !samples.length;
  elements.exportPanel.hidden = !samples.length;
}

function removeSample(id) {
  const index = samples.findIndex((sample) => sample.id === id);
  if (index < 0) return;
  const [removed] = samples.splice(index, 1);
  if (removed.audioUrl) {
    URL.revokeObjectURL(removed.audioUrl);
    audioUrls.delete(removed.audioUrl);
  }
  document.querySelector(`[data-sample-id="${CSS.escape(id)}"]`)?.remove();
  updateSummary();
}

function addSampleCard(sample) {
  const item = document.createElement("li");
  item.className = "sample-item";
  item.dataset.sampleId = sample.id;
  const title = document.createElement("strong");
  title.textContent = sample.metadata.speciesName;
  const detail = document.createElement("p");
  detail.textContent = `${formatDate(sample.metadata.recordedAt)} ・ ${sample.metadata.durationSeconds}秒 ・ ${sample.metadata.features.frameCount}フレーム ・ ${sample.filename}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-button";
  remove.textContent = "除外";
  remove.addEventListener("click", () => removeSample(sample.id));
  item.append(title, remove, detail);
  if (sample.audioUrl) {
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "none";
    audio.src = sample.audioUrl;
    item.append(audio);
  }
  elements.list.append(item);
}

async function importFiles(files) {
  const pngFiles = [...files].filter((file) => file.type === "image/png" || file.name.toLowerCase().endsWith(".png"));
  if (!pngFiles.length) {
    setMessage("PNGファイルを選択してください。", true);
    return;
  }

  elements.input.disabled = true;
  setMessage(`${pngFiles.length}件を読み取り中…`);
  let imported = 0;
  const errors = [];
  for (const file of pngFiles) {
    try {
      const decoded = await decodeProfilePng(file);
      if (!decoded.metadata.speciesName || !decoded.metadata.features?.meanDb) throw new Error("虫名または特徴量がありません。");
      const id = crypto.randomUUID();
      const audioBlob = decoded.audioBytes.length
        ? new Blob([decoded.audioBytes], { type: decoded.metadata.audioMimeType || "application/octet-stream" })
        : null;
      const audioUrl = audioBlob ? URL.createObjectURL(audioBlob) : null;
      if (audioUrl) audioUrls.add(audioUrl);
      const sample = { id, filename: file.name, metadata: decoded.metadata, audioUrl };
      samples.push(sample);
      addSampleCard(sample);
      imported += 1;
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  elements.input.disabled = false;
  elements.input.value = "";
  updateSummary();
  setMessage(
    errors.length ? `${imported}件を読み込みました。${errors.length}件は読み込めませんでした：${errors.join(" / ")}` : `${imported}件を正常に読み込みました。`,
    errors.length > 0,
  );
}

elements.input.addEventListener("change", () => void importFiles(elements.input.files));
for (const eventName of ["dragenter", "dragover"]) {
  elements.drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.drop.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.drop.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.drop.classList.remove("is-dragging");
  });
}
elements.drop.addEventListener("drop", (event) => void importFiles(event.dataTransfer.files));

elements.exportButton.addEventListener("click", () => {
  const database = aggregateTrainingSamples(samples.map(({ metadata }) => metadata));
  const blob = new Blob([`${JSON.stringify(database, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "insect-profiles-v1.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  setMessage(`${database.profiles.length}種類・${samples.length}録音の判別データを作成しました。`);
});

elements.clearButton.addEventListener("click", () => {
  for (const url of audioUrls) URL.revokeObjectURL(url);
  audioUrls.clear();
  samples.splice(0);
  elements.list.replaceChildren();
  updateSummary();
  setMessage();
});

window.addEventListener("pagehide", () => {
  for (const url of audioUrls) URL.revokeObjectURL(url);
});
