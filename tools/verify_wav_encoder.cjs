const assert = require('node:assert/strict');
const { encodePcm16Wav } = require('../js/wav-encoder.js');

async function main() {
  const left = new Float32Array([0, 0, 0, 0]);
  const right = new Float32Array([0.25, -0.25, 0.5, -0.5]);
  const blob = encodePcm16Wav([left, right], 48000);
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt16LE(22), 2, 'WAV must preserve two channels');
  assert.equal(bytes.readUInt32LE(24), 48000, 'WAV sample rate');
  assert.equal(bytes.readUInt32LE(40), 16, 'data chunk size');

  const decodedLeft = [];
  const decodedRight = [];
  for (let frame = 0; frame < left.length; frame += 1) {
    decodedLeft.push(bytes.readInt16LE(44 + frame * 4));
    decodedRight.push(bytes.readInt16LE(46 + frame * 4));
  }
  assert.deepEqual(decodedLeft, [0, 0, 0, 0]);
  assert.deepEqual(decodedRight, [8191, -8192, 16383, -16384]);
  console.log('Stereo WAV encoder preserves an active right-only Line-In channel.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});