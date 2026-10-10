(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AudioPreprocess = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const DEFAULTS = Object.freeze({
    targetSampleRate: 22050,
    frameLength: 512,
    hopLength: 256,
    cropPadSeconds: 0.05,
    eventGapSeconds: 0.15,
    eventNoiseRatio: 0.25,
    silenceRms: 1e-4,
    minimumEventSeconds: 0.1,
    resampleRadius: 32,
    resamplePhases: 2048
  });

  const kernelCache = new Map();

  function sinc(value) {
    if (Math.abs(value) < 1e-12) return 1;
    const angle = Math.PI * value;
    return Math.sin(angle) / angle;
  }

  function resampleSinc(input, sourceRate, targetRate, radius = DEFAULTS.resampleRadius) {
    if (!(sourceRate > 0 && targetRate > 0)) throw new RangeError('Sample rates must be positive');
    if (sourceRate === targetRate) return Float32Array.from(input);
    if (!input.length) return new Float32Array();
    const outputLength = Math.ceil(input.length * targetRate / sourceRate);
    const output = new Float32Array(outputLength);
    const ratio = sourceRate / targetRate;
    const cutoff = Math.min(1, targetRate / sourceRate);
    const phases = DEFAULTS.resamplePhases;
    const cacheKey = `${cutoff}:${radius}:${phases}`;
    let kernel = kernelCache.get(cacheKey);
    if (!kernel) {
      const tapCount = radius * 2;
      kernel = new Float64Array(phases * tapCount);
      for (let phase = 0; phase < phases; phase += 1) {
        const fraction = phase / phases;
        for (let tap = 0; tap < tapCount; tap += 1) {
          const offset = tap - radius + 1;
          const distance = fraction - offset;
          const normalizedDistance = distance / radius;
          const window = 0.42 + 0.5 * Math.cos(Math.PI * normalizedDistance)
            + 0.08 * Math.cos(2 * Math.PI * normalizedDistance);
          kernel[phase * tapCount + tap] =
            cutoff * sinc(cutoff * distance) * window;
        }
      }
      kernelCache.set(cacheKey, kernel);
    }
    const tapCount = radius * 2;

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
      const sourcePosition = outputIndex * ratio;
      const center = Math.floor(sourcePosition);
      const phase = Math.min(phases - 1, Math.floor((sourcePosition - center) * phases));
      const firstOffset = -radius + 1;
      let weightedSum = 0;
      let weightTotal = 0;
      const kernelOffset = phase * tapCount;
      for (let tap = 0; tap < tapCount; tap += 1) {
        const sourceIndex = center + firstOffset + tap;
        if (sourceIndex < 0 || sourceIndex >= input.length) continue;
        const weight = kernel[kernelOffset + tap];
        weightedSum += input[sourceIndex] * weight;
        weightTotal += weight;
      }
      output[outputIndex] = weightTotal ? weightedSum / weightTotal : 0;
    }
    return output;
  }

  function filterSos(input, sos, initialSample) {
    let current = Float64Array.from(input);
    let precedingGain = 1;
    for (const section of sos) {
      const [b0, b1, b2, a0, a1, a2] = section;
      if (a0 !== 1) throw new RangeError('SOS sections must be normalized (a0 = 1)');
      const dcGain = (b0 + b1 + b2) / (a0 + a1 + a2);
      const steadyOutput = precedingGain * dcGain;
      let state0 = (steadyOutput - b0 * precedingGain) * initialSample;
      let state1 = (b2 * precedingGain - a2 * steadyOutput) * initialSample;
      const output = new Float64Array(current.length);
      for (let index = 0; index < current.length; index += 1) {
        const value = current[index];
        const result = b0 * value + state0;
        state0 = b1 * value - a1 * result + state1;
        state1 = b2 * value - a2 * result;
        output[index] = result;
      }
      current = output;
      precedingGain *= dcGain;
    }
    return current;
  }

  function sosFiltFilt(input, sos) {
    const sectionCount = sos.length;
    const numeratorZeros = sos.reduce((count, section) => count + (section[2] === 0 ? 1 : 0), 0);
    const denominatorZeros = sos.reduce((count, section) => count + (section[5] === 0 ? 1 : 0), 0);
    const edgeLength = 3 * (2 * sectionCount + 1 - Math.min(numeratorZeros, denominatorZeros));
    if (input.length <= edgeLength) throw new RangeError('Audio clip is too short for zero-phase filtering');

    const extended = new Float64Array(input.length + 2 * edgeLength);
    for (let index = 0; index < edgeLength; index += 1) {
      extended[edgeLength - 1 - index] = 2 * input[0] - input[index + 1];
      extended[edgeLength + input.length + index] =
        2 * input[input.length - 1] - input[input.length - 2 - index];
    }
    extended.set(input, edgeLength);

    let forward = filterSos(extended, sos, extended[0]);
    forward.reverse();
    let backward = filterSos(forward, sos, forward[0]);
    backward.reverse();
    return Float32Array.from(backward.subarray(edgeLength, edgeLength + input.length));
  }

  function frameRms(samples, frameLength = DEFAULTS.frameLength, hopLength = DEFAULTS.hopLength) {
    const frameCount = Math.floor(samples.length / hopLength) + 1;
    const halfFrame = Math.floor(frameLength / 2);
    const rms = new Float64Array(frameCount);
    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
      const firstSample = frameIndex * hopLength - halfFrame;
      let sum = 0;
      for (let offset = 0; offset < frameLength; offset += 1) {
        const sampleIndex = firstSample + offset;
        if (sampleIndex >= 0 && sampleIndex < samples.length) {
          sum += samples[sampleIndex] * samples[sampleIndex];
        }
      }
      rms[frameIndex] = Math.sqrt(sum / frameLength);
    }
    return rms;
  }

  function median(values) {
    if (!values.length) return 0;
    const ordered = Array.from(values).sort((left, right) => left - right);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function activeFrames(rms) {
    const middle = median(rms);
    const deviations = Float64Array.from(rms, value => Math.abs(value - middle));
    const threshold = middle + 2 * median(deviations);
    return { mask: Uint8Array.from(rms, value => value > threshold ? 1 : 0), threshold };
  }

  function splitEvents(samples, options = {}) {
    const settings = { ...DEFAULTS, ...options };
    const rms = frameRms(samples, settings.frameLength, settings.hopLength);
    const { mask } = activeFrames(rms);
    const gapFrames = Math.floor(settings.eventGapSeconds * settings.targetSampleRate / settings.hopLength);
    const padFrames = Math.floor(settings.cropPadSeconds * settings.targetSampleRate / settings.hopLength);
    const regions = [];
    let start = null;
    let gap = 0;
    for (let index = 0; index < mask.length; index += 1) {
      if (mask[index]) {
        if (start === null) start = index;
        gap = 0;
      } else if (start !== null) {
        gap += 1;
        if (gap >= gapFrames) {
          regions.push([start, index - gap]);
          start = null;
          gap = 0;
        }
      }
    }
    if (start !== null) regions.push([start, mask.length - 1]);

    const minimumSamples = Math.floor(settings.targetSampleRate * settings.minimumEventSeconds);
    const events = [];
    for (const [firstFrame, lastFrame] of regions) {
      const firstSample = Math.max(0, (firstFrame - padFrames) * settings.hopLength);
      const lastSample = Math.min(samples.length, (lastFrame + 1 + padFrames) * settings.hopLength);
      if (lastSample - firstSample >= minimumSamples) {
        events.push(samples.slice(firstSample, lastSample));
      }
    }
    if (!events.length && Math.max(...rms) > settings.silenceRms) return [Float32Array.from(samples)];
    return events;
  }

  function selectEvent(events, noiseRatio = DEFAULTS.eventNoiseRatio) {
    if (!events.length) return null;
    const levels = events.map(event => {
      let sum = 0;
      for (const sample of event) sum += sample * sample;
      return Math.sqrt(sum / event.length);
    });
    const loudest = Math.max(...levels);
    const index = levels.findIndex(level => level >= loudest * noiseRatio);
    return events[index < 0 ? 0 : index];
  }

  function analyzePcm(samples, sourceRate, sos, options = {}) {
    const resampled = resampleSinc(samples, sourceRate, DEFAULTS.targetSampleRate, options.resampleRadius);
    const filtered = sosFiltFilt(resampled, sos);
    const events = splitEvents(filtered, options);
    return { resampled, filtered, events, selectedEvent: selectEvent(events, options.eventNoiseRatio) };
  }

  return Object.freeze({
    DEFAULTS,
    resampleSinc,
    sosFiltFilt,
    frameRms,
    activeFrames,
    splitEvents,
    selectEvent,
    analyzePcm
  });
});