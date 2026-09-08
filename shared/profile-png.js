const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PACKAGE_MAGIC = textEncoder.encode("MSPK");
const IMAGE_MAGIC = textEncoder.encode("MSPKPNG1");
const PACKAGE_VERSION = 1;
const DATA_LEVELS = [32, 96, 160, 224];

function concatBytes(...parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function uint32(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

export async function buildProfilePackage(metadata, audioBytes = new Uint8Array()) {
  const metadataBytes = textEncoder.encode(JSON.stringify(metadata));
  const header = concatBytes(
    PACKAGE_MAGIC,
    new Uint8Array([PACKAGE_VERSION]),
    uint32(metadataBytes.length),
    uint32(audioBytes.length),
  );
  const contents = concatBytes(header, metadataBytes, audioBytes);
  return concatBytes(contents, await sha256(contents));
}

export async function parseProfilePackage(packageBytes) {
  if (packageBytes.length < 45 || !equalBytes(packageBytes.slice(0, 4), PACKAGE_MAGIC)) {
    throw new Error("学習データの形式を確認できません。");
  }
  if (packageBytes[4] !== PACKAGE_VERSION) throw new Error("未対応の学習データ形式です。");
  const metadataLength = readUint32(packageBytes, 5);
  const audioLength = readUint32(packageBytes, 9);
  const contentsLength = 13 + metadataLength + audioLength;
  if (contentsLength + 32 !== packageBytes.length) throw new Error("学習データの長さが正しくありません。");

  const contents = packageBytes.slice(0, contentsLength);
  const expectedHash = packageBytes.slice(contentsLength);
  if (!equalBytes(await sha256(contents), expectedHash)) throw new Error("画像内の学習データが破損しています。");

  let metadata;
  try {
    metadata = JSON.parse(textDecoder.decode(packageBytes.slice(13, 13 + metadataLength)));
  } catch {
    throw new Error("学習データの説明部分を読み取れません。");
  }

  return {
    metadata,
    audioBytes: packageBytes.slice(13 + metadataLength, contentsLength),
  };
}

function bytesToSymbols(bytes) {
  const symbols = new Uint8Array(bytes.length * 4);
  bytes.forEach((value, index) => {
    symbols[index * 4] = (value >> 6) & 3;
    symbols[index * 4 + 1] = (value >> 4) & 3;
    symbols[index * 4 + 2] = (value >> 2) & 3;
    symbols[index * 4 + 3] = value & 3;
  });
  return symbols;
}

function symbolsToBytes(symbols, byteLength) {
  const bytes = new Uint8Array(byteLength);
  for (let index = 0; index < byteLength; index += 1) {
    bytes[index] =
      (symbols[index * 4] << 6) |
      (symbols[index * 4 + 1] << 4) |
      (symbols[index * 4 + 2] << 2) |
      symbols[index * 4 + 3];
  }
  return bytes;
}

function quantize(channel) {
  return Math.min(3, Math.max(0, Math.round((channel - DATA_LEVELS[0]) / 64)));
}

export function pixelCapacity(width, dataHeight) {
  return Math.floor((width * dataHeight * 3) / 4) - 12;
}

export function encodePayloadToPixels(payload, width, dataHeight) {
  const framed = concatBytes(IMAGE_MAGIC, uint32(payload.length), payload);
  if (framed.length > pixelCapacity(width, dataHeight) + 12) {
    throw new Error(`学習データが画像容量を超えています（最大 ${pixelCapacity(width, dataHeight)} bytes）。`);
  }
  const symbols = bytesToSymbols(framed);
  const pixels = new Uint8ClampedArray(width * dataHeight * 4);
  let symbolIndex = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = DATA_LEVELS[symbols[symbolIndex++] ?? 0];
    pixels[index + 1] = DATA_LEVELS[symbols[symbolIndex++] ?? 0];
    pixels[index + 2] = DATA_LEVELS[symbols[symbolIndex++] ?? 0];
    pixels[index + 3] = 255;
  }
  return pixels;
}

export function decodePayloadFromPixels(pixels, width, dataHeight) {
  if (pixels.length !== width * dataHeight * 4) throw new Error("画像サイズが正しくありません。");
  const symbols = new Uint8Array(width * dataHeight * 3);
  let symbolIndex = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    symbols[symbolIndex++] = quantize(pixels[index]);
    symbols[symbolIndex++] = quantize(pixels[index + 1]);
    symbols[symbolIndex++] = quantize(pixels[index + 2]);
  }
  const prefix = symbolsToBytes(symbols, 12);
  if (!equalBytes(prefix.slice(0, 8), IMAGE_MAGIC)) throw new Error("Mushi Scopeの学習PNGではありません。");
  const payloadLength = readUint32(prefix, 8);
  if (payloadLength > pixelCapacity(width, dataHeight)) throw new Error("画像内のデータ長が正しくありません。");
  return symbolsToBytes(symbols, 12 + payloadLength).slice(12);
}

export async function createProfilePng(packageBytes, label, options = {}) {
  const width = options.width || 1024;
  const height = options.height || 1024;
  const headerHeight = options.headerHeight || 192;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });

  context.fillStyle = "#f4f1e8";
  context.fillRect(0, 0, width, headerHeight);
  context.fillStyle = "#2d714c";
  context.font = "700 24px system-ui, sans-serif";
  context.fillText("MUSHI SCOPE / LEARNING DATA", 48, 50);
  context.fillStyle = "#1f2922";
  context.font = "700 54px system-ui, sans-serif";
  context.fillText(label.speciesName, 48, 118, width - 96);
  context.fillStyle = "#687169";
  context.font = "24px system-ui, sans-serif";
  context.fillText(`${label.recordedAt}  •  ${label.durationSeconds}秒  •  MSPK v1`, 48, 164, width - 96);

  const pixels = encodePayloadToPixels(packageBytes, width, height - headerHeight);
  context.putImageData(new ImageData(pixels, width, height - headerHeight), 0, headerHeight);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("PNG画像を作成できませんでした。")), "image/png");
  });
  return { blob, width, height, headerHeight, capacity: pixelCapacity(width, height - headerHeight) };
}

async function fileToImage(file) {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function decodeProfilePng(file, options = {}) {
  const headerHeight = options.headerHeight || 192;
  const image = await fileToImage(file);
  if (image.width !== 1024 || image.height !== 1024) {
    image.close?.();
    throw new Error("画像が変更されています。元の1024×1024 PNGを読み込んでください。");
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height - headerHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, -headerHeight);
  image.close?.();
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  return parseProfilePackage(decodePayloadFromPixels(pixels, canvas.width, canvas.height));
}
