const fs = require('node:fs');
const path = require('node:path');
const mfcc = require('../js/mfcc.js');

const goldenPath = path.join(__dirname, '..', 'tests', 'golden-matches.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const encodedMel = Buffer.from(golden.mel_filterbank_f32le_base64, 'base64');
const melWeightCount = encodedMel.length / 4;
const melBank = new Float32Array(melWeightCount);
for (let index = 0; index < melWeightCount; index += 1) {
  melBank[index] = encodedMel.readFloatLE(index * 4);
}

const failures = [];
let maxAbsoluteError = 0;
for (const testCase of golden.cases) {
  if (!testCase.query_event_f32le_base64) continue;
  const encodedSignal = Buffer.from(testCase.query_event_f32le_base64, 'base64');
  const signal = new Float32Array(encodedSignal.length / 4);
  for (let index = 0; index < signal.length; index += 1) {
    signal[index] = encodedSignal.readFloatLE(index * 4);
  }
  const actual = mfcc.melCepstra(signal, melBank, golden.mfcc);
  const expected = testCase.query_mfcc;
  if (actual.length !== expected.length) {
    failures.push(`${testCase.id}: frame count ${actual.length} != ${expected.length}`);
    continue;
  }
  for (let frame = 0; frame < actual.length; frame += 1) {
    for (let coefficient = 0; coefficient < actual[frame].length; coefficient += 1) {
      const error = Math.abs(actual[frame][coefficient] - expected[frame][coefficient]);
      if (error > maxAbsoluteError) maxAbsoluteError = error;
    }
  }
}

const tolerance = 0.002;
if (maxAbsoluteError > tolerance) failures.push(`max MFCC absolute error ${maxAbsoluteError} > ${tolerance}`);
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`max absolute error: ${maxAbsoluteError}`);
  process.exitCode = 1;
} else {
  console.log(`MFCC/CMVN matches ${golden.cases.filter(testCase => testCase.query_event_f32le_base64).length} Python cases; max error ${maxAbsoluteError}.`);
}