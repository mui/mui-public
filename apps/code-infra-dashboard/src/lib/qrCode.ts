import * as crypto from 'node:crypto';
import QRCode from 'qrcode';
import { DASHBOARD_ORIGIN } from '@/constants';

export const QR_CODE_MAX_URL_LENGTH = 2048;

// Truncated HMAC-SHA256, 128 bits is plenty for URL integrity
const SIGNATURE_BYTES = 16;

function getSigningKey(): string | null {
  return process.env.QR_CODE_SECRET || null;
}

function computeSignature(targetUrl: string, key: string): Buffer {
  return crypto.createHmac('sha256', key).update(targetUrl).digest().subarray(0, SIGNATURE_BYTES);
}

/**
 * Builds a signed URL to the QR code endpoint for the given target URL.
 * Returns null when no signing key is configured (e.g. local development).
 */
export function signQrCodeUrl(targetUrl: string): string | null {
  const key = getSigningKey();
  if (!key) {
    return null;
  }
  const signature = computeSignature(targetUrl, key).toString('base64url');
  const qrCodeUrl = new URL('/api/qr-code', DASHBOARD_ORIGIN);
  qrCodeUrl.searchParams.set('url', targetUrl);
  qrCodeUrl.searchParams.set('sig', signature);
  return qrCodeUrl.toString();
}

/**
 * Verifies that the signature was produced by signQrCodeUrl for the given target URL.
 */
export function verifyQrCodeSignature(targetUrl: string, signature: string): boolean {
  const key = getSigningKey();
  if (!key) {
    return false;
  }
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== SIGNATURE_BYTES) {
    return false;
  }
  return crypto.timingSafeEqual(computeSignature(targetUrl, key), provided);
}

/**
 * Renders the target URL as an SVG QR code. Lowest error correction level and a
 * small quiet zone keep the output as small as possible.
 */
export async function generateQrCodeSvg(targetUrl: string): Promise<string> {
  return QRCode.toString(targetUrl, { type: 'svg', errorCorrectionLevel: 'L', margin: 2 });
}
