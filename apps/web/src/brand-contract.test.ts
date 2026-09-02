import assert from 'node:assert/strict';
import test from 'node:test';
import { NEXUS_LIVE_COLORS } from './brand-contract.ts';

test('Nexus Live brand palette stays stable', () => {
  assert.deepEqual(NEXUS_LIVE_COLORS, {
    signalRed: '#ff0033',
    electricCyan: '#00e5ff',
    acidLime: '#c6ff00',
    ink: '#080f12'
  });
});
