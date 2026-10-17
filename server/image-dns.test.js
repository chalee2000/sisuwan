import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicLookup } from './images.js';

test('direct image metadata connections receive only the DNS answers actually checked', async () => {
  let queries = 0;
  const checked = createPublicLookup(async () => {
    queries++;
    return queries === 1 ? [{ address: '8.8.8.8', family: 4 }, { address: '2606:4700::1111', family: 6 }] : [{ address: '127.0.0.1', family: 4 }];
  });
  const all = await new Promise((resolve, reject) => checked('publisher.com', { all: true, family: 4 }, (error, value) => error ? reject(error) : resolve(value)));
  assert.deepEqual(all, [{ address: '8.8.8.8', family: 4 }]);
  await assert.rejects(new Promise((resolve, reject) => checked('publisher.com', {}, (error, value) => error ? reject(error) : resolve(value))), /Unsafe destination/);
  const single = createPublicLookup(async () => [{ address: '8.8.4.4', family: 4 }]);
  await new Promise((resolve, reject) => single('publisher.com', {}, (error, address, family) => {
    if (error) return reject(error);
    assert.equal(address, '8.8.4.4');
    assert.equal(family, 4);
    resolve();
  }));
});
