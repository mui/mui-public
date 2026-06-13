import { type NextRequest, NextResponse } from 'next/server';
import { generateQrCodeSvg, verifyQrCodeSignature, QR_CODE_MAX_URL_LENGTH } from '@/lib/qrCode';

// A valid base64url signature is 22 chars; allow some slack but reject obvious abuse.
const MAX_SIGNATURE_LENGTH = 64;

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function GET(request: NextRequest): Promise<Response> {
  const url = request.nextUrl.searchParams.get('url');
  const signature = request.nextUrl.searchParams.get('sig');

  if (!url || !signature) {
    return errorResponse('Missing url or sig query parameter', 400);
  }

  if (url.length > QR_CODE_MAX_URL_LENGTH) {
    return errorResponse('url query parameter is too long', 400);
  }

  if (signature.length > MAX_SIGNATURE_LENGTH) {
    return errorResponse('sig query parameter is too long', 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return errorResponse('url query parameter is not a valid URL', 400);
  }

  if (parsedUrl.protocol !== 'https:') {
    return errorResponse('Only https URLs are supported', 400);
  }

  if (!process.env.QR_CODE_SECRET) {
    return errorResponse('QR code signing is not configured', 503);
  }

  if (!verifyQrCodeSignature(url, signature)) {
    return errorResponse('Invalid signature', 403);
  }

  const svg = await generateQrCodeSvg(url);

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      // QR output for a given URL never changes, cacheable forever (incl. GitHub camo)
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
    },
  });
}
