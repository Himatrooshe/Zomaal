export { strictInteger } from './calendar-date.util';

export const MAX_QUERY_PAGE = 1_000_000;

/** Leave malformed/duplicate values intact so validation rejects them. */
export const strictBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
