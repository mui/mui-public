import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { signQrCodeUrl } from '@/lib/qrCode';
import { GET } from './route';

describe('GET /api/qr-code', () => {
  beforeEach(() => {
    vi.stubEnv('QR_CODE_SECRET', 'test-secret');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should respond with a cacheable SVG for a validly signed URL', async () => {
    const signedUrl = signQrCodeUrl('https://example.com/page');

    const response = await GET(new NextRequest(signedUrl!));

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml');
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toContain('<svg');
  });

  it('should respond with 403 for an invalid signature', async () => {
    const url = new URL('https://dashboard.test/api/qr-code');
    url.searchParams.set('url', 'https://example.com/page');
    url.searchParams.set('sig', 'AAAAAAAAAAAAAAAAAAAAAA');

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('should respond with 403 when the signed URL is tampered with', async () => {
    const signedUrl = new URL(signQrCodeUrl('https://example.com/page')!);
    signedUrl.searchParams.set('url', 'https://example.com/other');

    const response = await GET(new NextRequest(signedUrl));

    expect(response.status).toBe(403);
  });

  it('should respond with 400 when query parameters are missing', async () => {
    const response = await GET(new NextRequest('https://dashboard.test/api/qr-code'));

    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('should respond with 400 for a non-https URL', async () => {
    const url = new URL('https://dashboard.test/api/qr-code');
    url.searchParams.set('url', 'http://example.com/page');
    url.searchParams.set('sig', 'AAAAAAAAAAAAAAAAAAAAAA');

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(400);
  });

  it('should respond with 400 for an overly long URL', async () => {
    const url = new URL('https://dashboard.test/api/qr-code');
    url.searchParams.set('url', `https://example.com/${'a'.repeat(3000)}`);
    url.searchParams.set('sig', 'AAAAAAAAAAAAAAAAAAAAAA');

    const response = await GET(new NextRequest(url));

    expect(response.status).toBe(400);
  });

  it('should respond with 503 when no signing key is configured', async () => {
    const signedUrl = signQrCodeUrl('https://example.com/page');
    vi.stubEnv('QR_CODE_SECRET', '');

    const response = await GET(new NextRequest(signedUrl!));

    expect(response.status).toBe(503);
  });
});
