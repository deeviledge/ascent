import { describe, expect, it } from 'vitest';
import { monthKeyJst, stampJst } from '../src/lib/time';

describe('monthKeyJst', () => {
  it('JST の暦月で切り替わる', () => {
    // 2026-01-31 15:00 UTC = 2026-02-01 00:00 JST
    expect(monthKeyJst(Date.parse('2026-01-31T14:59:59Z'))).toBe('2026-01');
    expect(monthKeyJst(Date.parse('2026-01-31T15:00:00Z'))).toBe('2026-02');
  });

  it('月は2桁ゼロ埋め', () => {
    expect(monthKeyJst(Date.parse('2026-08-18T00:00:00Z'))).toBe('2026-08');
  });
});

describe('stampJst', () => {
  it('JST の MM/DD HH:mm で出す', () => {
    expect(stampJst(Date.parse('2026-08-18T05:05:00Z'))).toBe('08/18 14:05');
  });
});
