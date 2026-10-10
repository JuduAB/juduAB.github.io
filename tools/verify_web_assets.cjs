require('../data/audio-assets.js');
const assets = globalThis.AUDIO_WEB_ASSETS;
const core = require('../js/matcher-core.js');
const mfcc = require('../js/mfcc.js');
const preprocess = require('../js/audio-preprocess.js');

function decodeBase64(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeWav(encoded) {
  const view = decodeBase64(encoded);
  let offset = 12;
  let dataOffset = -1;
  while (offset + 8 <= view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset), view.getUint8(offset + 1),
      view.getUint8(offset + 2), view.getUint8(offset + 3),
    );
    const chunkSize = view.getUint32(offset + 4, true);
    if (chunkId === 'data') {
      dataOffset = offset + 8;
      break;
    }
    offset += 8 + chunkSize + (chunkSize & 1);
  }
  if (dataOffset < 0) throw new Error('WAV data chunk is missing');
  const channels = view.getUint16(22, true);
  const bitsPerSample = view.getUint16(34, true);
  const sampleRate = view.getUint32(24, true);
  if (bitsPerSample !== 16) throw new Error(`Unsupported reference PCM depth ${bitsPerSample}`);
  const sampleCount = (view.byteLength - dataOffset) / 2 / channels;
  const samples = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += view.getInt16(dataOffset + (index * channels + channel) * 2, true) / 32768;
    }
    samples[index] = sum / channels;
  }
  return { samples, sampleRate };
}

const melBank = new Float32Array(decodeBase64(assets.melBankF32leBase64).byteLength / 4);
const melView = decodeBase64(assets.melBankF32leBase64);
for (let index = 0; index < melBank.length; index += 1) melBank[index] = melView.getFloat32(index * 4, true);

const map = assets.maps.audio_map;
const failures = [];
let checked = 0;
for (const [category, reference] of Object.entries(assets.referenceAudio)) {
  if (!map[category]) failures.push(`${category}: category missing from audio map`);
  const wav = decodeWav(reference.base64);
  const analysis = preprocess.analyzePcm(wav.samples, wav.sampleRate, assets.butterworthSos);
  const features = analysis.selectedEvent
    ? mfcc.melCepstra(analysis.selectedEvent, melBank, assets.mfccOptions)
    : null;
  const match = features ? core.matchFeatures(features, assets.features, assets.matcherOptions) : null;
  if (match?.category !== category) failures.push(`${category}: runtime bundle matched ${match?.category ?? null}`);
  checked += 1;
}
for (const category of Object.keys(assets.features)) {
  if (!map[category]) failures.push(`${category}: matcher category missing from audio map`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Verified ${checked} packed reference WAVs, matcher categories, and audio map.`);
}