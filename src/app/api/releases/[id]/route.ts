import { NextRequest, NextResponse } from 'next/server';
import { getReleaseById } from '@/lib/actions/releases';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const release = await getReleaseById(parseInt(id));
    
    if (!release) {
      return NextResponse.json({ error: 'Release not found' }, { status: 404 });
    }
    
    return NextResponse.json(release);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
