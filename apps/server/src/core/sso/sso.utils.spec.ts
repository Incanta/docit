import { safeRedirect } from './sso.utils';

describe('safeRedirect', () => {
  it('keeps in-app paths', () => {
    expect(safeRedirect('/s/general/p/abc')).toBe('/s/general/p/abc');
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(safeRedirect('https://evil.example')).toBe('/home');
    expect(safeRedirect('//evil.example')).toBe('/home');
    expect(safeRedirect('/\\evil.example')).toBe('/home');
  });

  it('defaults when missing', () => {
    expect(safeRedirect(undefined)).toBe('/home');
    expect(safeRedirect(['/a'])).toBe('/home');
  });
});
