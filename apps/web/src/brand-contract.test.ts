import assert from 'node:assert/strict';
import test from 'node:test';
import { ARENASIGNAL_COLORS } from './brand-contract.ts';

test('ArenaSignal brand palette stays stable', () => {
  assert.deepEqual(ARENASIGNAL_COLORS, {
    signalRed: '#ff1744',
    electricCyan: '#00e5ff',
    acidLime: '#c6ff00',
    ink: '#090b0f'
  });
});
