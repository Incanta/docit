import { credentialTarget } from './docit-adapter';

describe('DocIt better-auth adapter: credential accounts', () => {
  it('routes credential lookups by user id to users.password', () => {
    expect(
      credentialTarget([
        { field: 'userId', value: 'u1' },
        { field: 'providerId', value: 'credential' },
      ]),
    ).toEqual({ userId: 'u1' });
  });

  it('recognises the virtual credential account id', () => {
    expect(
      credentialTarget([{ field: 'id', value: 'credential:u2' }]),
    ).toEqual({ userId: 'u2' });
  });

  it('leaves OAuth account lookups alone', () => {
    expect(
      credentialTarget([
        { field: 'accountId', value: 'sub-123' },
        { field: 'providerId', value: '01a16f6c-e16a-7608-9186-7d1cb0f6eb8a' },
      ]),
    ).toBeNull();
    expect(credentialTarget([{ field: 'userId', value: 'u1' }])).toBeNull();
  });
});
