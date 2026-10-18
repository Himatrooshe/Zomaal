import {
  WHATSAPP_LANGUAGES,
  WHATSAPP_TEMPLATES,
  WHATSAPP_TRIGGERS,
  renderTemplateBody,
} from './whatsapp.constants';
import { resolveCountryCode, toE164 } from './whatsapp-phone.util';

describe('WhatsApp templates', () => {
  it('has one template per trigger with valid Meta names', () => {
    const names = WHATSAPP_TRIGGERS.map((t) => WHATSAPP_TEMPLATES[t].name);
    expect(new Set(names).size).toBe(WHATSAPP_TRIGGERS.length);
    for (const name of names) expect(name).toMatch(/^[a-z0-9_]{1,512}$/);
  });

  it.each(
    WHATSAPP_TRIGGERS.flatMap((t) => WHATSAPP_LANGUAGES.map((l) => [t, l])),
  )(
    '%s/%s uses {{1}}..{{3}} and neither starts nor ends with a variable',
    (trigger, language) => {
      const body =
        WHATSAPP_TEMPLATES[trigger as (typeof WHATSAPP_TRIGGERS)[number]]
          .bodies[language as (typeof WHATSAPP_LANGUAGES)[number]];
      expect(body).toContain('{{1}}');
      expect(body).toContain('{{2}}');
      expect(body).toContain('{{3}}');
      expect(body).not.toMatch(/\{\{\d+\}\}\s*$/);
      expect(body).not.toMatch(/^\s*\{\{\d+\}\}/);
    },
  );

  it('renders variables in order', () => {
    expect(
      renderTemplateBody('Hi {{1}}, {{2}} from {{3}}.', ['A', 'B', 'C']),
    ).toBe('Hi A, B from C.');
  });
});

describe('WhatsApp phone normalization', () => {
  it('resolves store country names and codes', () => {
    expect(resolveCountryCode('Morocco')).toBe('MA');
    expect(resolveCountryCode('fr')).toBe('FR');
    expect(resolveCountryCode('Atlantis', 'BD')).toBe('BD');
    expect(resolveCountryCode(null, 'nope')).toBe('MA');
  });

  it('turns local and 00-prefixed mobile numbers into E.164', () => {
    expect(toE164('0612345678', 'MA')).toBe('+212612345678');
    expect(toE164('00212612345678', 'FR')).toBe('+212612345678');
    expect(toE164(' +212 6 12 34 56 78 ', 'MA')).toBe('+212612345678');
  });

  it('rejects empty, invalid and landline numbers', () => {
    expect(toE164('', 'MA')).toBeNull();
    expect(toE164('12', 'MA')).toBeNull();
    expect(toE164('0522123456', 'MA')).toBeNull();
  });
});
