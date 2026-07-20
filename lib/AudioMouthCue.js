/**
 * AudioBuffer -> continuous mouth-control cue.
 *
 * This lightweight analyzer uses decoded WebAudio buffers to extract RMS
 * energy, attack/release smoothing, onset accents, and a rough brightness
 * estimate. Text visemes still decide the mouth direction; this cue decides
 * how alive and how open the mouth should be over time.
 */

const DEFAULT_OPTIONS = {
  frameRate: 60,
  windowSeconds: 0.04,
  lookaheadFrames: 2,
  attackSeconds: 0.035,
  releaseSeconds: 0.12,
  energyGamma: 0.62,
  startOffsetSeconds: 0,
};

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function quantile(values, q) {
  if (!values.length) return 0;
  const pos = clamp(0, values.length - 1, (values.length - 1) * q);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return values[lo];
  return lerp(values[lo], values[hi], pos - lo);
}

function readMixedSample(audioBuffer, sampleIndex) {
  let sample = 0;
  const channels = audioBuffer.numberOfChannels || 1;
  for (let ch = 0; ch < channels; ch++) {
    sample += audioBuffer.getChannelData(ch)[sampleIndex] || 0;
  }
  return sample / channels;
}

export function generateMouthCue(audioBuffer, options = {}) {
  if (!audioBuffer || !audioBuffer.length || !audioBuffer.sampleRate) return null;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sampleRate = audioBuffer.sampleRate;
  const startSample = Math.min(
    audioBuffer.length - 1,
    Math.max(0, Math.round(Number(opts.startOffsetSeconds || 0) * sampleRate))
  );
  const usableLength = Math.max(1, audioBuffer.length - startSample);
  const hopSize = Math.max(1, Math.round(sampleRate / opts.frameRate));
  const windowSize = Math.max(hopSize, Math.round(sampleRate * opts.windowSeconds));
  const frameCount = Math.max(1, Math.ceil(usableLength / hopSize));

  const rmsValues = [];
  const zcrValues = [];

  for (let frame = 0; frame < frameCount; frame++) {
    const center = startSample + frame * hopSize;
    const start = Math.max(startSample, center - Math.floor(windowSize / 2));
    const end = Math.min(audioBuffer.length, start + windowSize);

    let sumSquares = 0;
    let crossings = 0;
    let prev = readMixedSample(audioBuffer, start);
    let count = 0;

    for (let i = start; i < end; i++) {
      const sample = readMixedSample(audioBuffer, i);
      sumSquares += sample * sample;
      if ((prev >= 0 && sample < 0) || (prev < 0 && sample >= 0)) crossings++;
      prev = sample;
      count++;
    }

    const rms = count > 0 ? Math.sqrt(sumSquares / count) : 0;
    rmsValues.push(rms);
    zcrValues.push(count > 1 ? crossings / count : 0);
  }

  const sortedRms = [...rmsValues].sort((a, b) => a - b);
  const noiseFloor = quantile(sortedRms, 0.16);
  const strongLevel = Math.max(quantile(sortedRms, 0.95), noiseFloor + 0.0001);
  const energyRange = Math.max(0.0001, strongLevel - noiseFloor);

  const rawEnergy = rmsValues.map((rms) => {
    const normalized = clamp(0, 1, (rms - noiseFloor) / energyRange);
    return Math.pow(normalized, opts.energyGamma);
  });

  const attackCoeff = 1 - Math.exp(-(1 / opts.frameRate) / opts.attackSeconds);
  const releaseCoeff = 1 - Math.exp(-(1 / opts.frameRate) / opts.releaseSeconds);
  const frames = [];
  let envelope = 0;
  let lastRaw = 0;
  let lastOnset = 0;

  for (let i = 0; i < frameCount; i++) {
    let target = rawEnergy[i];
    for (let j = 1; j <= opts.lookaheadFrames; j++) {
      const ahead = rawEnergy[i + j] || 0;
      target = Math.max(target, ahead * (1 - j * 0.22));
    }

    const coeff = target > envelope ? attackCoeff : releaseCoeff;
    envelope += (target - envelope) * coeff;
    if (envelope < 0.025) envelope = 0;

    const rawOnset = clamp(0, 1, (rawEnergy[i] - lastRaw) * 3.4);
    lastOnset += (rawOnset - lastOnset) * 0.42;
    lastRaw = rawEnergy[i];

    const brightness = clamp(0, 1, (zcrValues[i] - 0.015) / 0.14);
    const jawOpen = clamp(0, 1, envelope * 0.92 + lastOnset * 0.18);

    frames.push({
      t: i / opts.frameRate,
      energy: Number(envelope.toFixed(4)),
      jawOpen: Number(jawOpen.toFixed(4)),
      onset: Number(lastOnset.toFixed(4)),
      brightness: Number(brightness.toFixed(4)),
    });
  }

  return {
    type: 'audio-mouth-cue',
    frameRate: opts.frameRate,
    duration: usableLength / sampleRate,
    sourceOffset: startSample / sampleRate,
    noiseFloor: Number(noiseFloor.toFixed(6)),
    strongLevel: Number(strongLevel.toFixed(6)),
    frames,
  };
}

export function sampleMouthCue(cue, localTime) {
  if (!cue || !cue.frames || cue.frames.length === 0) {
    return {
      t: localTime,
      energy: 0,
      jawOpen: 0,
      onset: 0,
      brightness: 0,
    };
  }

  if (localTime <= 0) return cue.frames[0];
  if (localTime >= cue.duration) {
    const last = cue.frames[cue.frames.length - 1];
    const release = clamp(0, 1, 1 - (localTime - cue.duration) / 0.16);
    return {
      t: localTime,
      energy: last.energy * release,
      jawOpen: last.jawOpen * release,
      onset: 0,
      brightness: last.brightness * release,
    };
  }

  const position = localTime * cue.frameRate;
  const index = Math.floor(position);
  const blend = position - index;
  const a = cue.frames[Math.max(0, Math.min(cue.frames.length - 1, index))];
  const b = cue.frames[Math.max(0, Math.min(cue.frames.length - 1, index + 1))];

  return {
    t: localTime,
    energy: lerp(a.energy, b.energy, blend),
    jawOpen: lerp(a.jawOpen, b.jawOpen, blend),
    onset: lerp(a.onset, b.onset, blend),
    brightness: lerp(a.brightness, b.brightness, blend),
  };
}

export function applyMouthCueToShape(shape, cueSample) {
  if (!shape || !cueSample) return shape;

  const energy = clamp(0, 1, cueSample.energy || 0);
  const jaw = clamp(0, 1, cueSample.jawOpen || 0);
  const onset = clamp(0, 1, cueSample.onset || 0);
  const brightness = clamp(0, 1, cueSample.brightness || 0);

  const visemeAmount = 0.28 + energy * 0.72;
  const audioJaw = jaw * 0.56 + onset * 0.08;

  return {
    ...shape,
    lipHeight: clamp(0.22, 1.15, shape.lipHeight * (0.48 + energy * 0.7) + onset * 0.08),
    lipWidth: clamp(0.55, 1.95, 1 + (shape.lipWidth - 1) * visemeAmount + (brightness - 0.5) * 0.08),
    jawOpen: clamp(0, 0.72, Math.max(shape.jawOpen * (0.18 + jaw * 0.92), audioJaw)),
    audioEnergy: energy,
    audioJawOpen: jaw,
    audioOnset: onset,
  };
}

export default {
  generateMouthCue,
  sampleMouthCue,
  applyMouthCueToShape,
};
