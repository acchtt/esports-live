function integer(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function confidence(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

export function readSimulatedResults(raw = process.env.GRUBS_CV_SIM_RESULTS ?? '') {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function simulatedDetection(gameId, env = process.env, observedAt = new Date().toISOString()) {
  const results = readSimulatedResults(env.GRUBS_CV_SIM_RESULTS ?? '');
  const entry = results[gameId] ?? results['*'];
  if (!entry || typeof entry !== 'object') return null;

  const blue = integer(entry.blue);
  const red = integer(entry.red);
  const score = confidence(entry.confidence ?? 0.99);
  if (blue === null || red === null || score === null) return null;

  return {
    schemaVersion: '1.0',
    gameId,
    blue,
    red,
    confidence: score,
    observedAt,
    source: 'broadcast-cv',
    mode: 'simulated'
  };
}

/**
 * Detector seam for the first cloud prototype.
 *
 * The frame path is intentionally accepted even though the simulated detector
 * does not inspect pixels yet. A later OpenCV/template implementation can
 * replace this function without changing the HTTP contract or API bridge.
 */
export async function detectGrubs({ gameId, framePath, env = process.env, observedAt }) {
  void framePath;
  return simulatedDetection(gameId, env, observedAt);
}
