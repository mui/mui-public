import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DASHBOARD_ORIGIN } from '@/constants';
import { signQrCodeUrl, verifyQrCodeSignature, generateQrCodeSvg } from './qrCode';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('signQrCodeUrl', () => {
  beforeEach(() => {
    vi.stubEnv('QR_CODE_SECRET', 'test-secret');
  });

  it('should produce a URL to the qr-code endpoint on the dashboard origin', () => {
    const signedUrl = signQrCodeUrl('https://example.com/page');

    expect(signedUrl).not.toBeNull();
    const parsed = new URL(signedUrl!);
    expect(parsed.origin).toBe(new URL(DASHBOARD_ORIGIN).origin);
    expect(parsed.pathname).toBe('/api/qr-code');
    expect(parsed.searchParams.get('url')).toBe('https://example.com/page');
    expect(parsed.searchParams.get('sig')).toBeTruthy();
  });

  it('should be deterministic for the same URL', () => {
    expect(signQrCodeUrl('https://example.com/page')).toBe(
      signQrCodeUrl('https://example.com/page'),
    );
  });

  it('should return null when no signing key is configured', () => {
    vi.stubEnv('QR_CODE_SECRET', '');

    expect(signQrCodeUrl('https://example.com/page')).toBeNull();
  });
});

describe('verifyQrCodeSignature', () => {
  beforeEach(() => {
    vi.stubEnv('QR_CODE_SECRET', 'test-secret');
  });

  function signAndExtractSignature(targetUrl: string): string {
    const signedUrl = signQrCodeUrl(targetUrl);
    return new URL(signedUrl!).searchParams.get('sig')!;
  }

  it('should accept a signature produced by signQrCodeUrl', () => {
    const signature = signAndExtractSignature('https://example.com/page');

    expect(verifyQrCodeSignature('https://example.com/page', signature)).toBe(true);
  });

  it('should reject a signature for a different URL', () => {
    const signature = signAndExtractSignature('https://example.com/page');

    expect(verifyQrCodeSignature('https://example.com/other', signature)).toBe(false);
  });

  it('should reject a tampered signature', () => {
    const signature = signAndExtractSignature('https://example.com/page');
    const tampered = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);

    expect(verifyQrCodeSignature('https://example.com/page', tampered)).toBe(false);
  });

  it('should reject signatures with the wrong length', () => {
    const signature = signAndExtractSignature('https://example.com/page');

    expect(verifyQrCodeSignature('https://example.com/page', signature.slice(0, 10))).toBe(false);
    expect(verifyQrCodeSignature('https://example.com/page', `${signature}AAAA`)).toBe(false);
  });

  it('should reject garbage input without throwing', () => {
    expect(verifyQrCodeSignature('https://example.com/page', '!!!not-base64url!!!')).toBe(false);
    expect(verifyQrCodeSignature('https://example.com/page', '')).toBe(false);
  });

  it('should reject signatures made with a different key', () => {
    const signature = signAndExtractSignature('https://example.com/page');
    vi.stubEnv('QR_CODE_SECRET', 'other-secret');

    expect(verifyQrCodeSignature('https://example.com/page', signature)).toBe(false);
  });

  it('should reject everything when no signing key is configured', () => {
    const signature = signAndExtractSignature('https://example.com/page');
    vi.stubEnv('QR_CODE_SECRET', '');

    expect(verifyQrCodeSignature('https://example.com/page', signature)).toBe(false);
  });
});

describe('generateQrCodeSvg', () => {
  it('should render a small SVG image', async () => {
    const svg = await generateQrCodeSvg('https://deploy-preview-1--material-ui.netlify.app/');

    expect(svg).toContain('<svg');
    expect(svg.length).toBeLessThan(2048);
  });
});
