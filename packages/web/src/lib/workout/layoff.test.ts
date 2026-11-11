import { describe, it, expect } from 'vitest';
import { layoffHint } from './layoff';

describe('layoffHint', () => {
  it('rounds days to weeks', () => {
    expect(layoffHint(21)).toBe('Back after 3 weeks: lighter start');
    expect(layoffHint(89)).toBe('Back after 13 weeks: lighter start');
  });
  it('never says 0 weeks and singularizes', () => {
    expect(layoffHint(3)).toBe('Back after 1 week: lighter start');
  });
});
