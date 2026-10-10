(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioMfcc = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    sampleRate: 22050,
    fftSize: 2048,
    hopSize: 512,
    melBands: 128,
    coefficientCount: 20,
    amin: 1e-10,
    topDb: 80,
    cmvnEpsilon: 1e-9
  });

  function fft(real, imaginary) {
    const length = real.length;
    if (length !== imaginary.length || (length & (length - 1)) !== 0) {
      throw new RangeError('FFT inputs must have equal power-of-two lengths');
    }

    for (let index = 1, reversed = 0; index < length; index += 1) {
      let bit = length >> 1;
      for (; reversed & bit; bit >>= 1) reversed ^= bit;
      reversed ^= bit;
      if (index < reversed) {
        [real[index], real[reversed]] = [real[reversed], real[index]];
        [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
      }
    }

    for (let blockSize = 2; blockSize <= length; blockSize <<= 1) {
      const halfSize = blockSize >> 1;
      const angle = -2 * Math.PI / blockSize;
      const stepReal = Math.cos(angle);
      const stepImaginary = Math.sin(angle);
      for (let block = 0; block < length; block += blockSize) {
        let twiddleReal = 1;
        let twiddleImaginary = 0;
        for (let offset = 0; offset < halfSize; offset += 1) {
          const even = block + offset;
          const odd = even + halfSize;
          const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
          const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
          const evenReal = real[even];
          const evenImaginary = imaginary[even];
          real[even] = evenReal + oddReal;
          imaginary[even] = evenImaginary + oddImaginary;
          real[odd] = evenReal - oddReal;
          imaginary[odd] = evenImaginary - oddImaginary;
          const nextTwiddleReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
          twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
          twiddleReal = nextTwiddleReal;
        }
      }
    }
  }

  function validateMelBank(melBank, melBands, binCount) {
    if (!melBank || melBank.length !== melBands * binCount) {
      throw new RangeError(`Expected ${melBands * binCount} mel filter weights`);
    }
  }

  function melCepstra(signal, melBank, options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const { fftSize, hopSize, melBands, coefficientCount } = settings;
    if (!signal?.length) return [];
    if (fftSize <= 0 || (fftSize & (fftSize - 1)) !== 0) {
      throw new RangeError('fftSize must be a positive power of two');
    }
    if (signal.length > 2 ** 24) throw new RangeError('Audio clip is too long for a single MFCC pass');

    const binCount = fftSize / 2 + 1;
    validateMelBank(melBank, melBands, binCount);
    const frameCount = Math.floor(signal.length / hopSize) + 1;
    const powerFrames = new Array(frameCount);
    const hann = new Float64Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      hann[index] = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / fftSize);
    }

    let maximumDb = Number.NEGATIVE_INFINITY;
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const frameStart = frameIndex * hopSize - fftSize / 2;
      const real = new Float64Array(fftSize);
      const imaginary = new Float64Array(fftSize);
      for (let offset = 0; offset < fftSize; offset += 1) {
        const sampleIndex = frameStart + offset;
        if (sampleIndex >= 0 && sampleIndex < signal.length) {
          real[offset] = signal[sampleIndex] * hann[offset];
        }
      }
      fft(real, imaginary);

      const melPower = new Float64Array(melBands);
      for (let band = 0; band < melBands; band += 1) {
        const bankOffset = band * binCount;
        let power = 0;
        for (let bin = 0; bin < binCount; bin += 1) {
          const realPart = real[bin];
          const imaginaryPart = imaginary[bin];
          power += (realPart * realPart + imaginaryPart * imaginaryPart) * melBank[bankOffset + bin];
        }
        const db = 10 * Math.log10(Math.max(settings.amin, power));
        melPower[band] = db;
        if (db > maximumDb) maximumDb = db;
      }
      powerFrames[frameIndex] = melPower;
    }

    const minimumDb = maximumDb - settings.topDb;
    const cepstra = Array.from({ length: coefficientCount }, () => new Float64Array(frameCount));
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const melDb = powerFrames[frameIndex];
      for (let coefficient = 0; coefficient < coefficientCount; coefficient += 1) {
        let sum = 0;
        for (let band = 0; band < melBands; band += 1) {
          const clippedDb = Math.max(minimumDb, melDb[band]);
          sum += clippedDb * Math.cos(Math.PI / melBands * (band + 0.5) * coefficient);
        }
        const normalization = coefficient === 0
          ? Math.sqrt(1 / melBands)
          : Math.sqrt(2 / melBands);
        cepstra[coefficient][frameIndex] = sum * normalization;
      }
    }

    const result = Array.from({ length: frameCount }, () => new Array(coefficientCount));
    for (let coefficient = 0; coefficient < coefficientCount; coefficient += 1) {
      const values = cepstra[coefficient];
      let mean = 0;
      for (const value of values) mean += value;
      mean /= frameCount;
      let variance = 0;
      for (const value of values) {
        const centered = value - mean;
        variance += centered * centered;
      }
      const standardDeviation = Math.sqrt(variance / frameCount);
      for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        result[frameIndex][coefficient] =
          (values[frameIndex] - mean) / (standardDeviation + settings.cmvnEpsilon);
      }
    }
    return result;
  }

  return Object.freeze({ DEFAULTS, fft, melCepstra });
});