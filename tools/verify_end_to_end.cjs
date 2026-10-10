const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const golden = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'golden-matches.json'), 'utf8'));
const core = require('../js/matcher-core.js');
const mfcc = require('../js/mfcc.js');
const preprocess = require('../js/audio-preprocess.js');

function decodeFloat32(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const samples = new Float32Array(bytes.byteLength / 4);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = view.getFloat32(index * 4, true);
  }
  return samples;
}

const melBank = decodeFloat32(golden.mel_filterbank_f32le_base64);
const failures = [];
let checked = 0;
for (const testCase of golden.cases) {
  if (!testCase.source_mono_f32le_base64) continue;
  const source = decodeFloat32(testCase.source_mono_f32le_base64);
  const analysis = preprocess.analyzePcm(
    source,
    testCase.source_sample_rate,
    golden.butterworth_sos,
  );
  const features = analysis.selectedEvent
    ? mfcc.melCepstra(analysis.selectedEvent, melBank, golden.mfcc)
    : null;
  const result = features
    ? core.matchFeatures(features, golden.reference_features, golden.matcher_options)
    : null;
  const category = result?.category ?? null;
  if (category !== testCase.expected_category) {
    failures.push(`${testCase.id}: ${category} != ${testCase.expected_category}`);
  }
  checked += 1;
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`End-to-end JavaScript audio pipeline matches ${checked} Python golden cases.`);
}