import { describe, it, expect } from 'vitest';
import { resolveIndianPinCode } from '../utils/pincodeResolver';

describe('M9-K PIN Code Location Search & Location Selection Suite', () => {
  it('E. validates invalid PIN code formats correctly', async () => {
    // Too short
    const shortRes = await resolveIndianPinCode('123');
    expect(shortRes.success).toBe(false);
    expect(shortRes.error).toContain('valid 6-digit Indian PIN code');

    // Letters included
    const alphaRes = await resolveIndianPinCode('5600a1');
    expect(alphaRes.success).toBe(false);
    expect(alphaRes.error).toContain('valid 6-digit Indian PIN code');

    // Empty
    const emptyRes = await resolveIndianPinCode('');
    expect(emptyRes.success).toBe(false);
  });

  it('D. resolves PIN 560001 to Bengaluru, Karnataka context', async () => {
    const res = await resolveIndianPinCode('560001');
    expect(res.success).toBe(true);
    expect(res.location).toBeDefined();
    expect(res.location?.city).toBe('Bengaluru');
    expect(res.location?.state).toBe('Karnataka');
    expect(res.location?.postalCode).toBe('560001');
  });

  it('D2. resolves PIN 584101 to Raichur, Karnataka context', async () => {
    const res = await resolveIndianPinCode('584101');
    expect(res.success).toBe(true);
    expect(res.location).toBeDefined();
    expect(res.location?.city).toBe('Raichur');
    expect(res.location?.state).toBe('Karnataka');
  });

  it('D3. resolves PIN 400001 to Mumbai, Maharashtra context', async () => {
    const res = await resolveIndianPinCode('400001');
    expect(res.success).toBe(true);
    expect(res.location).toBeDefined();
    expect(res.location?.city).toBe('Mumbai');
    expect(res.location?.state).toBe('Maharashtra');
  });

  it('D4. resolves PIN 110001 to Delhi context', async () => {
    const res = await resolveIndianPinCode('110001');
    expect(res.success).toBe(true);
    expect(res.location).toBeDefined();
    expect(res.location?.city).toBe('Delhi');
  });

  it('G. handles unknown or unmapped PIN codes gracefully via regional circle fallback', async () => {
    const res = await resolveIndianPinCode('599999');
    expect(res.success).toBe(true);
    expect(res.location).toBeDefined();
    expect(res.location?.city).toBe('Bengaluru');
    expect(res.location?.state).toBe('Karnataka');
    expect(res.location?.postalCode).toBe('599999');
  });
});
