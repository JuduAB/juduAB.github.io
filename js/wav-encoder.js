(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WavEncoder = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  function encodePcm16Wav(channels, sampleRate) {
    if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
      throw new RangeError('sampleRate must be a positive integer');
    }
    if (!channels.length) throw new Error('Audio must contain at least one channel');
    const channelSamples = channels.map(channel => Float32Array.from(channel));
    const sampleCount = channelSamples[0].length;
    if (!sampleCount || channelSamples.some(channel => channel.length !== sampleCount)) {
      throw new Error('Audio channels must be non-empty and have equal lengths');
    }

    const channelCount = channelSamples.length;
    const bytesPerSample = 2;
    const bytesPerFrame = channelCount * bytesPerSample;
    const dataBytes = sampleCount * bytesPerFrame;
    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let index = 0; index < text.length; index += 1) {
        view.setUint8(offset + index, text.charCodeAt(index));
      }
    };

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channelCount, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * bytesPerFrame, true);
    view.setUint16(32, bytesPerFrame, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeText(36, 'data');
    view.setUint32(40, dataBytes, true);

    let offset = 44;
    for (let frame = 0; frame < sampleCount; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = Math.max(-1, Math.min(1, channelSamples[channel][frame]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += bytesPerSample;
      }
    }
    return new Blob([buffer], { type: 'audio/wav' });
  }

  return Object.freeze({ encodePcm16Wav });
});