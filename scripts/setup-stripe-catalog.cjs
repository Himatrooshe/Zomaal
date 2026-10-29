#!/usr/bin/env node
'use strict';

// Sandbox-only provisioning. No payments, database writes or entitlement changes.
const CATALOG = [
  { code: 'STARTER', name: 'Zomaal Starter', amount: 9900 },
  { code: 'PRO', name: 'Zomaal Pro', amount: 19900 },
];

function assertSandboxKey(key) {
  if (!/^(sk|rk)_test_\S+$/.test(key || '')) {
    throw new Error(
      'Set STRIPE_SECRET_KEY to a sandbox sk_test_ or rk_test_ key. Live keys are refused.',
    );
  }
}

function stripeClient(key, transport = fetch) {
  assertSandboxKey(key);
  return async (path, { method = 'GET', params = {}, idempotencyKey } = {}) => {
    const encoded = new URLSearchParams(params);
    const headers = { Authorization: `Bearer ${key}` };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (method === 'POST')
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const response = await transport(
      `https://api.stripe.com/v1${path}${method === 'GET' && encoded.size ? `?${encoded}` : ''}`,
      {
        method,
        headers,
        ...(method === 'POST' ? { body: encoded } : {}),
        signal: AbortSignal.timeout(30000),
      },
    );
    const body = await response.json();
    if (!response.ok) {
      // Do not echo Stripe error text or request headers, which can contain secrets.
      if (response.status === 404 && method === 'GET') return null;
      throw new Error(
        `Stripe request failed (HTTP ${response.status}). Check Stripe request logs and key permissions, then rerun.`,
      );
    }
    return body;
  };
}

function validateProduct(product, plan) {
  if (
    !product ||
    product.livemode !== false ||
    product.active !== true ||
    product.metadata?.app !== 'zomaal' ||
    product.metadata?.plan_code !== plan.code
  ) {
    throw new Error(
      `Existing ${plan.code} product is inactive or has conflicting ownership/mode. Review it in Stripe.`,
    );
  }
}

function validatePrice(price, plan, productId) {
  if (
    price.livemode !== false ||
    price.active !== true ||
    price.product !== productId ||
    price.currency !== 'mad' ||
    price.unit_amount !== plan.amount ||
    price.recurring?.interval !== 'month' ||
    price.recurring?.interval_count !== 1 ||
    price.recurring?.usage_type !== 'licensed' ||
    price.billing_scheme !== 'per_unit'
  ) {
    throw new Error(
      `Existing ${plan.code} price conflicts with the approved monthly catalog. No price was overwritten.`,
    );
  }
}

async function provisionCatalog(api) {
  const result = {};
  for (const plan of CATALOG) {
    const productId = `zomaal_${plan.code.toLowerCase()}_v1`;
    let product = await api(`/products/${productId}`);
    if (!product) {
      product = await api('/products', {
        method: 'POST',
        idempotencyKey: `zomaal-catalog-v1-product-${plan.code}`,
        params: {
          id: productId,
          name: plan.name,
          'metadata[app]': 'zomaal',
          'metadata[plan_code]': plan.code,
        },
      });
    }
    validateProduct(product, plan);
    const lookupKey = `zomaal_${plan.code.toLowerCase()}_mad_monthly_v1`;
    const prices = await api('/prices', {
      params: { 'lookup_keys[]': lookupKey, limit: '2' },
    });
    if (
      !prices ||
      !Array.isArray(prices.data) ||
      prices.data.length > 1 ||
      prices.has_more
    ) {
      throw new Error(
        `Unexpected price lookup response for ${plan.code}. Review Stripe before retrying.`,
      );
    }
    let price = prices.data[0];
    if (!price) {
      price = await api('/prices', {
        method: 'POST',
        idempotencyKey: `zomaal-catalog-v1-price-${plan.code}`,
        params: {
          product: productId,
          currency: 'mad',
          unit_amount: String(plan.amount),
          'recurring[interval]': 'month',
          'recurring[interval_count]': '1',
          'recurring[usage_type]': 'licensed',
          lookup_key: lookupKey,
          'metadata[app]': 'zomaal',
          'metadata[plan_code]': plan.code,
        },
      });
    }
    validatePrice(price, plan, productId);
    result[`STRIPE_${plan.code}_MONTHLY_PRICE_ID`] = price.id;
  }
  return result;
}

async function main(args = process.argv.slice(2)) {
  if (
    args.some((arg) => !['--apply', '--dry-run'].includes(arg)) ||
    (args.includes('--apply') && args.includes('--dry-run'))
  ) {
    throw new Error('Usage: npm run billing:catalog -- [--dry-run | --apply]');
  }
  if (!args.includes('--apply')) {
    console.log('Dry run: no Stripe requests or local changes.');
    for (const plan of CATALOG)
      console.log(`${plan.name}: ${plan.amount / 100} MAD/month`);
    console.log(
      'Yearly prices, taxes and entitlement limits are not configured by this command.',
    );
    console.log(
      'After adding a sandbox key: npm run billing:catalog -- --apply',
    );
    return;
  }
  const result = await provisionCatalog(
    stripeClient(process.env.STRIPE_SECRET_KEY),
  );
  console.log(
    'Sandbox products/prices ready. Copy these IDs into your local .env:',
  );
  for (const [name, value] of Object.entries(result))
    console.log(`${name}=${value}`);
  console.log(
    'No Zomaal plan, entitlement, subscription, invoice or payment was changed.',
  );
}

module.exports = {
  CATALOG,
  assertSandboxKey,
  stripeClient,
  provisionCatalog,
  main,
};
if (require.main === module)
  main().catch((error) => {
    // Only print our sanitized errors. Never print arbitrary transport errors.
    console.error(
      error.message?.includes('Stripe') ||
        error.message?.startsWith('Set STRIPE_') ||
        error.message?.startsWith('Existing ') ||
        error.message?.startsWith('Unexpected ') ||
        error.message?.startsWith('Usage:')
        ? error.message
        : 'Stripe setup failed. Check connectivity and retry.',
    );
    process.exitCode = 1;
  });
