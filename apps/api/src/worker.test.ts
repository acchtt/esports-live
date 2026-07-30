import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkerHandler } from './worker.ts';

test('Worker health disables LoL when the secret is absent', async () => {
  const response = await createWorkerHandler({})(new Request('https://example.test/health'));
  const payload = await response.json() as { adapters: string[] };
  assert.deepEqual(payload.adapters, []);
});

test('Worker health enables LoL when the secret is configured', async () => {
  const response = await createWorkerHandler({ LOL_ESPORTS_API_KEY: 'configured' })(
    new Request('https://example.test/health')
  );
  const payload = await response.json() as { adapters: string[] };
  assert.deepEqual(payload.adapters, ['lol']);
});