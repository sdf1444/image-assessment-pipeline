import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessImage, isSupportedImage } from '../src/assessment/mock';

test('mock assessment is deterministic and bounded', () => {
  const image = Buffer.from('simulated image');
  const result = assessImage(image);
  assert.deepEqual(assessImage(image), result);
  assert.ok(result.score >= 0 && result.score <= 1);
  assert.equal(result.outcome, result.score >= 0.5 ? 'review' : 'routine');
});

test('image signatures reject unsupported and truncated inputs', () => {
  assert.equal(isSupportedImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true);
  assert.equal(isSupportedImage(Buffer.from([0xff, 0xd8, 0xff])), true);
  assert.equal(isSupportedImage(Buffer.from([0xff, 0xd8])), false);
  assert.equal(isSupportedImage(Buffer.from('not an image')), false);
});
