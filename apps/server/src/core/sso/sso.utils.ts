/** Only allow relative in-app redirects after login. */
export function safeRedirect(value: unknown): string {
  if (typeof value !== 'string') return '/home';
  if (
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\')
  ) {
    return '/home';
  }
  return value;
}
