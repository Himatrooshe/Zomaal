'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  assertSandboxKey,
  stripeClient,
  provisionCatalog,
  main,
} = require('./setup-stripe-catalog.cjs');

function fakeStripe() {
  const products = new Map();
  const prices = new Map();
  const writes = [];
  return {
    writes,
    prices,
    api: async (path, options = {}) => {
      const p = options.params;
      if (options.method === 'POST') {
        assert.ok(options.idempotencyKey);
        writes.push(path);
        if (path === '/products') {
          const product = {
            id: p.id,
            active: true,
            livemode: false,
            metadata: {
              app: p['metadata[app]'],
              plan_code: p['metadata[plan_code]'],
            },
          };
          products.set(p.id, product);
          return product;
        }
        if (path === '/prices') {
          const price = {
            id: `price_${prices.size}`,
            product: p.product,
            active: true,
            livemode: false,
            currency: p.currency,
            unit_amount: Number(p.unit_amount),
            billing_scheme: 'per_unit',
            recurring: {
              interval: p['recurring[interval]'],
              interval_count: Number(p['recurring[interval_count]']),
              usage_type: p['recurring[usage_type]'],
            },
          };
          prices.set(p.lookup_key, price);
          return price;
        }
      }
      if (path.startsWith('/products/'))
        return products.get(path.split('/').at(-1)) || null;
      if (path === '/prices')
        return {
          data: prices.has(p['lookup_keys[]'])
            ? [prices.get(p['lookup_keys[]'])]
            : [],
          has_more: false,
        };
      throw new Error(`Unexpected path ${path}`);
    },
  };
}

test('missing, publishable and live keys are refused before any transport call', () => {
  for (const key of [
    '',
    'pk_test_example',
    'sk_live_example',
    'rk_live_example',
  ]) {
    assert.throws(
      () => stripeClient(key, () => assert.fail('Must not contact Stripe')),
      /sandbox/,
    );
  }
  assert.doesNotThrow(() => assertSandboxKey('sk_test_example'));
  assert.doesNotThrow(() => assertSandboxKey('rk_test_example'));
});

test('dry run needs no key and makes no requests', async () => {
  const original = global.fetch;
  global.fetch = () => assert.fail('Dry run contacted Stripe');
  try {
    await main(['--dry-run']);
  } finally {
    global.fetch = original;
  }
});

test('creates approved monthly prices in minor units and reuses them on rerun', async () => {
  const fake = fakeStripe();
  const first = await provisionCatalog(fake.api);
  assert.equal(fake.writes.length, 4);
  assert.deepEqual(
    [...fake.prices.values()].map((p) => p.unit_amount),
    [9900, 19900],
  );
  const second = await provisionCatalog(fake.api);
  assert.deepEqual(first, second);
  assert.equal(fake.writes.length, 4);
});

test('fails on price mismatch without overwriting it', async () => {
  const fake = fakeStripe();
  await provisionCatalog(fake.api);
  fake.prices.values().next().value.unit_amount = 1;
  await assert.rejects(provisionCatalog(fake.api), /conflicts/);
  assert.equal(fake.writes.length, 4);
});

test('a partial run can resume without duplicating completed resources', async () => {
  const fake = fakeStripe();
  let interrupted = false;
  await assert.rejects(
    provisionCatalog(async (path, options) => {
      if (path === '/prices' && options?.method === 'POST' && !interrupted) {
        interrupted = true;
        throw new Error('Simulated outage');
      }
      return fake.api(path, options);
    }),
    /Simulated outage/,
  );
  await provisionCatalog(fake.api);
  assert.equal(fake.writes.filter((path) => path === '/products').length, 2);
  assert.equal(fake.writes.filter((path) => path === '/prices').length, 2);
});

test('Stripe error bodies are never reflected in errors', async () => {
  const api = stripeClient('sk_test_example', async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'sensitive request contents' } }),
  }));
  await assert.rejects(api('/products'), (error) => {
    assert.match(error.message, /HTTP 401/);
    assert.doesNotMatch(error.message, /sensitive/);
    return true;
  });
});
