import { validate } from 'class-validator';
import { OzoneExpressTrackingDto } from './ozoneexpress-parcel.dto';

describe('OzoneExpressTrackingDto', () => {
  it.each(['ZM-OZ-TEST-001', ['ZM-OZ-TEST-001', 'ZM-OZ-TEST-002']])(
    'accepts a single tracking code or an array',
    async (trackingNumber) => {
      const dto = Object.assign(new OzoneExpressTrackingDto(), {
        trackingNumber,
      });

      await expect(validate(dto)).resolves.toEqual([]);
    },
  );

  it.each([undefined, '', [123], ['']])(
    'rejects invalid tracking input: %p',
    async (trackingNumber) => {
      const dto = Object.assign(new OzoneExpressTrackingDto(), {
        trackingNumber,
      });

      await expect(validate(dto)).resolves.not.toEqual([]);
    },
  );
});
