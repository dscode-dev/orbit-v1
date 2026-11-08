import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = readFileSync(new URL('../app/_landing/analytics.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function setup({
  id = 'AW-809397759',
  label = 'Synthetic_Label',
  consent = null,
  writeBlocked = false,
  readBlocked = false,
  server = false,
} = {}) {
  const storage = new Map(consent ? [['lp:cookie-consent', consent]] : []);
  const win = new EventTarget();
  win.localStorage = {
    getItem: (key) => {
      if (readBlocked) throw new Error('Storage blocked');
      return storage.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (writeBlocked) throw new Error('Storage blocked');
      storage.set(key, value);
    },
  };
  const testedModule = { exports: {} };
  runInNewContext(compiled, {
    module: testedModule,
    exports: testedModule.exports,
    process: {
      env: { NEXT_PUBLIC_GOOGLE_ADS_ID: id, NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_LABEL: label },
    },
    ...(server ? {} : { window: win }),
    CustomEvent,
  });
  return {
    api: testedModule.exports,
    win,
    storage,
    commands: () =>
      Array.from(win.dataLayer ?? [], (entry) => JSON.parse(JSON.stringify(Array.from(entry)))),
  };
}

test('does not initialize marketing before explicit consent or after rejection', () => {
  for (const consent of [null, 'denied', 'invalid']) {
    const { api, win } = setup({ consent });
    assert.equal(api.prepareGoogleAds(), false);
    api.trackWhatsAppConversion();
    assert.equal(win.gtag, undefined);
    assert.equal(win.dataLayer, undefined);
  }
});

test('queues Consent Mode defaults and grant before js/config are inserted by the Google component', () => {
  const { api, commands } = setup({ consent: 'granted' });
  assert.equal(api.prepareGoogleAds(), true);
  const queued = commands();
  assert.deepEqual(
    queued.map((entry) => entry.slice(0, 2)),
    [
      ['consent', 'default'],
      ['consent', 'update'],
    ],
  );
  assert.ok(Object.values(queued[0][2]).every((value) => value === 'denied'));
  assert.ok(Object.values(queued[1][2]).every((value) => value === 'granted'));
  api.prepareGoogleAds();
  assert.equal(commands().filter((entry) => entry[1] === 'default').length, 1);
});

test('queues the WhatsApp conversion while the Google SDK is still downloading', () => {
  const { api, commands } = setup({ consent: 'granted' });
  api.prepareGoogleAds();
  api.trackWhatsAppConversion();
  assert.deepEqual(commands().at(-1), [
    'event',
    'conversion',
    { send_to: 'AW-809397759/Synthetic_Label' },
  ]);
});

test('sends only the static destination and never the visitor or WhatsApp message', () => {
  const { api, commands } = setup({ consent: 'granted' });
  api.prepareGoogleAds();
  api.trackWhatsAppConversion({
    email: 'do-not-send@example.invalid',
    phone: '123',
    message: 'Private',
  });
  assert.deepEqual(Object.keys(commands().at(-1)[2]), ['send_to']);
});

test('revokes consent immediately and blocks further conversions', () => {
  const { api, commands } = setup({ consent: 'granted' });
  api.prepareGoogleAds();
  api.setMarketingConsent('denied');
  const revoked = commands().at(-1);
  assert.deepEqual(revoked.slice(0, 2), ['consent', 'update']);
  assert.ok(Object.values(revoked[2]).every((value) => value === 'denied'));
  const count = commands().length;
  api.trackWhatsAppConversion();
  assert.equal(commands().length, count);
  assert.equal(api.hasMarketingConsent(), false);
});

test('honors consent in this document when storage writes are blocked', () => {
  const { api } = setup({ writeBlocked: true });
  api.setMarketingConsent('granted');
  assert.equal(api.hasMarketingConsent(), true);
  assert.equal(api.prepareGoogleAds(), true);
  api.setMarketingConsent('denied');
  assert.equal(api.hasMarketingConsent(), false);
});

test('honors consent when all access to storage is blocked', () => {
  const { api } = setup({ readBlocked: true, writeBlocked: true });
  assert.equal(api.readConsent(), null);
  api.setMarketingConsent('granted');
  assert.equal(api.prepareGoogleAds(), true);
});

test('re-reads consent changes from other tabs, including cleared storage', () => {
  const { api, storage } = setup({ consent: 'granted' });
  api.prepareGoogleAds();
  storage.set(api.CONSENT_STORAGE_KEY, 'denied');
  api.refreshStoredConsent();
  assert.equal(api.readConsent(), 'denied');
  storage.clear();
  api.refreshStoredConsent();
  assert.equal(api.readConsent(), null);
});

test('allows the base tag without a conversion label', () => {
  const { api, commands } = setup({ consent: 'granted', label: '' });
  assert.equal(api.prepareGoogleAds(), true);
  api.trackWhatsAppConversion();
  assert.equal(commands().filter((entry) => entry[0] === 'event').length, 0);
});

test('disables empty, malformed and wrong-product IDs', () => {
  for (const id of ['', 'AW-TESTE123', 'GTM-123', 'G-123', "AW-123';alert(1)"]) {
    const { api, win } = setup({ consent: 'granted', id });
    assert.equal(api.GOOGLE_ADS_ID, '');
    assert.equal(api.prepareGoogleAds(), false);
    assert.equal(win.gtag, undefined);
  }
});

test('trims environment values and uses the provided ID in the conversion destination', () => {
  const { api, commands } = setup({
    consent: 'granted',
    id: ' AW-809397759 ',
    label: ' Synthetic_Label ',
  });
  api.prepareGoogleAds();
  api.trackWhatsAppConversion();
  assert.equal(commands().at(-1)[2].send_to, 'AW-809397759/Synthetic_Label');
});

test('preserves a gtag queue already installed in the document', () => {
  const { api, win } = setup({ consent: 'granted' });
  const calls = [];
  const existing = (...args) => calls.push(args);
  win.gtag = existing;
  assert.equal(api.prepareGoogleAds(), true);
  assert.equal(win.gtag, existing);
  assert.equal(calls.length, 2);
});

test('does not access browser globals during server rendering', () => {
  const { api } = setup({ server: true });
  assert.equal(api.readConsent(), null);
  assert.equal(api.prepareGoogleAds(), false);
  assert.doesNotThrow(() => api.trackWhatsAppConversion());
});
