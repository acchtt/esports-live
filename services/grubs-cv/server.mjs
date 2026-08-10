import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { captureFrame } from './frame-source.mjs';
import { detectGrubs, simulatedDetection } from './detector.mjs';

const env = process.env;
const port = Number.parseInt(env.PORT ?? '8080', 10) || 8080;
const token = env.GRUBS_CV_TOKEN?.trim() ?? '';
const streamUrl = env.GRUBS_CV_STREAM_URL?.trim() ?? '';
const configuredGameId = env.GRUBS_CV_GAME_ID?.trim() ?? '';
const crop = env.GRUBS_CV_CROP?.trim() ?? '';
const sampleIntervalMs = Math.max(1_000, Number.parseInt(env.GRUBS_CV_SAMPLE_INTERVAL_MS ?? '2000', 10) || 2_000);
const frameDir = env.GRUBS_CV_FRAME_DIR?.trim() || '/tmp/grubs-cv';
const latest = new Map();
let sampling = false;

function json(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(value));
}

function authorized(request) {
  if (!token) return true;
  return request.headers.authorization === `Bearer ${token}`;
}

function gameIdFrom(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return null;
  const value = pathname.slice(prefix.length);
  if (!value || value.includes('/')) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

async function sample(gameId) {
  if (!streamUrl) throw new Error('GRUBS_CV_STREAM_URL is not configured');
  await mkdir(frameDir, { recursive: true });
  const safeGameId = gameId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const outputPath = `${frameDir}/${safeGameId}.jpg`;
  const frame = await captureFrame({ streamUrl, outputPath, crop });
  const result = await detectGrubs({
    gameId,
    framePath: outputPath,
    env,
    observedAt: frame.capturedAt
  });
  if (result) latest.set(gameId, result);
  return { frame, result };
}

async function backgroundSample() {
  if (!streamUrl || !configuredGameId || sampling) return;
  sampling = true;
  try {
    await sample(configuredGameId);
  } catch (error) {
    console.error('[grubs-cv] sample failed:', error instanceof Error ? error.message : error);
  } finally {
    sampling = false;
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://grubs-cv.local');

  if (request.method === 'GET' && url.pathname === '/health') {
    return json(response, 200, {
      ok: true,
      service: 'grubs-cv',
      schemaVersion: '1.0',
      streamConfigured: Boolean(streamUrl),
      gameConfigured: Boolean(configuredGameId),
      detectorMode: 'simulated'
    });
  }

  if (!authorized(request)) {
    return json(response, 401, { error: 'unauthorized' });
  }

  const resultGameId = gameIdFrom(url.pathname, '/v1/grubs/');
  if (request.method === 'GET' && resultGameId) {
    const existing = latest.get(resultGameId);
    if (existing) return json(response, 200, existing);

    const simulated = simulatedDetection(resultGameId, env);
    if (simulated) {
      latest.set(resultGameId, simulated);
      return json(response, 200, simulated);
    }
    return json(response, 404, { error: 'no_detection', gameId: resultGameId });
  }

  const captureGameId = gameIdFrom(url.pathname, '/v1/capture/');
  if (request.method === 'POST' && captureGameId) {
    if (configuredGameId && configuredGameId !== captureGameId) {
      return json(response, 409, { error: 'game_not_configured', gameId: captureGameId });
    }
    if (!streamUrl) {
      return json(response, 409, { error: 'stream_not_configured' });
    }
    try {
      const value = await sample(captureGameId);
      return json(response, 200, {
        ok: true,
        gameId: captureGameId,
        capturedAt: value.frame.capturedAt,
        bytes: value.frame.bytes,
        detection: value.result
      });
    } catch (error) {
      return json(response, 502, {
        error: 'capture_failed',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return json(response, 404, { error: 'not_found' });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`[grubs-cv] listening on :${port}`);
  console.log(`[grubs-cv] stream=${streamUrl ? 'configured' : 'not-configured'} detector=simulated`);
});

if (streamUrl && configuredGameId) {
  void backgroundSample();
  setInterval(() => void backgroundSample(), sampleIntervalMs).unref();
}
