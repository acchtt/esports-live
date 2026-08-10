import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFfmpegArgs, normalizeCrop } from './frame-source.mjs';
import { readSimulatedResults, simulatedDetection } from './detector.mjs';

test('frame source builds a single-frame FFmpeg capture with an optional safe crop', () => {
  assert.equal(normalizeCrop('420:120:750:20'), '420:120:750:20');
  assert.equal(normalizeCrop('crop=420:120:750:20'), null);
  assert.deepEqual(
    buildFfmpegArgs({
      streamUrl: 'https://stream.example/live.m3u8',
      outputPath: '/tmp/frame.jpg',
      crop: '420:120:750:20'
    }),
    [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-i', 'https://stream.example/live.m3u8',
      '-frames:v', '1',
      '-vf', 'crop=420:120:750:20',
      '-q:v', '3', '/tmp/frame.jpg'
    ]
  );
});

test('simulated detector returns the same contract as a future vision detector', () => {
  const env = {
    GRUBS_CV_SIM_RESULTS: JSON.stringify({
      'game-1': { blue: 4, red: 2, confidence: 0.96 }
    })
  };
  const result = simulatedDetection('game-1', env, '2026-08-10T12:00:00.000Z');
  assert.deepEqual(result, {
    schemaVersion: '1.0',
    gameId: 'game-1',
    blue: 4,
    red: 2,
    confidence: 0.96,
    observedAt: '2026-08-10T12:00:00.000Z',
    source: 'broadcast-cv',
    mode: 'simulated'
  });
});

test('simulated detector supports a wildcard fixture and rejects malformed input', () => {
  assert.deepEqual(readSimulatedResults('{bad json'), {});
  const env = {
    GRUBS_CV_SIM_RESULTS: JSON.stringify({ '*': { blue: 5, red: 1 } })
  };
  const result = simulatedDetection('any-game', env, '2026-08-10T12:00:00.000Z');
  assert.equal(result?.blue, 5);
  assert.equal(result?.red, 1);
  assert.equal(result?.confidence, 0.99);
});
