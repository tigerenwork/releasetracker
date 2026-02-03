import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Environment configuration
const ENABLE_PASSCODE = process.env.ENABLE_PASSCODE === 'true';
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'release_tracker_auth';

// Paths that should be excluded from auth check
const PUBLIC_PATHS = ['/login', '/api/auth'];

export function middleware(request: NextRequest) {
  // If passcode protection is disabled, allow all requests
  if (!ENABLE_PASSCODE) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Check if the path is public (login page or auth API)
  if (PUBLIC_PATHS.some(path => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Check for auth cookie
  const authCookie = request.cookies.get(AUTH_COOKIE_NAME);

  if (!authCookie || authCookie.value !== 'authenticated') {
    // Redirect to login page
    const loginUrl = new URL('/login', request.url);
    // Store the original URL to redirect back after login
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // User is authenticated, allow the request
  return NextResponse.next();
}

// Configure which paths the middleware runs on
export const config = {
  matcher: [
    // Match all paths except static files and api routes that are public
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
