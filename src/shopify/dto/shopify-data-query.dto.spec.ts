import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ShopifyDataPageQueryDto } from './shopify-data-query.dto';

describe('ShopifyDataPageQueryDto', () => {
  it('uses the default page size and transforms supported query values', () => {
    const defaults = toDto({});
    const query = toDto({
      first: '25',
      after: ' cursor-next ',
      query: ' status:active ',
    });

    expect(defaults.first).toBe(20);
    expect(errorsFor(defaults)).toHaveLength(0);
    expect(query).toMatchObject({
      first: 25,
      after: 'cursor-next',
      query: 'status:active',
    });
    expect(errorsFor(query)).toHaveLength(0);
  });

  it.each([
    [{ first: '0' }, 'first below minimum'],
    [{ first: '101' }, 'first above maximum'],
    [{ first: '1.5' }, 'non-integer first'],
    [{ first: 'many' }, 'non-numeric first'],
    [{ after: 'x'.repeat(2049) }, 'cursor over maximum length'],
    [{ query: 'x'.repeat(501) }, 'query over maximum length'],
    [{ unexpected: 'value' }, 'unexpected query parameter'],
  ])('rejects %s (%s)', (input) => {
    expect(errorsFor(toDto(input))).not.toHaveLength(0);
  });

  it('treats blank optional cursor and search values as omitted', () => {
    const query = toDto({
      after: ' ',
      query: '',
    });

    expect(query).toMatchObject({ first: 20 });
    expect(query.after).toBeUndefined();
    expect(query.query).toBeUndefined();
    expect(errorsFor(query)).toHaveLength(0);
  });
});

function toDto(input: Record<string, unknown>): ShopifyDataPageQueryDto {
  return plainToInstance(ShopifyDataPageQueryDto, input);
}

function errorsFor(value: ShopifyDataPageQueryDto) {
  return validateSync(value, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
