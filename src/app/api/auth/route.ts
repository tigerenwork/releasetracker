import { NextRequest, NextResponse } from 'next/server';

// Environment configuration
const ENABLE_PASSCODE = process.env.ENABLE_PASSCODE === 'true';
const PASSCODE = process.env.PASSCODE;
const AUTH_COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'release_tracker_auth';

// Cookie configuration
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export async function POST(request: NextRequest) {
  // If passcode protection is disabled, return success
  if (!ENABLE_PASSCODE) {
    return NextResponse.json({ success: true });
  }

  // Check if passcode is configured
  if (!PASSCODE) {
    return NextResponse.json(
      { error: 'Passcode not configured' },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();
    const { passcode } = body;

    if (!passcode || typeof passcode !== 'string') {
      return NextResponse.json(
        { error: 'Passcode is required' },
        { status: 400 }
      );
    }

    // Verify passcode
    if (passcode !== PASSCODE) {
      return NextResponse.json(
        { error: 'Invalid passcode' },
        { status: 401 }
      );
    }

    // Set authentication cookie
    const response = NextResponse.json({ success: true });
    
    response.cookies.set({
      name: AUTH_COOKIE_NAME,
      value: 'authenticated',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}

// Optional: DELETE endpoint for logout (if needed in future)
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 0,
    path: '/',
  });

  return response;
}
