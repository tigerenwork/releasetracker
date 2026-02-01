import { NextRequest } from 'next/server';
import { reorderSteps } from '@/lib/actions/step-templates';
import { StepCategory } from '@/lib/db/schema';

export async function POST(request: NextRequest) {
  try {
    const { releaseId, category, orderedIds } = await request.json();
    
    if (!releaseId || !category || !orderedIds || !Array.isArray(orderedIds)) {
      return Response.json(
        { error: 'Missing required fields: releaseId, category, orderedIds' },
        { status: 400 }
      );
    }
    
    await reorderSteps(releaseId, category as StepCategory, orderedIds);
    
    return Response.json({ success: true });
  } catch (error) {
    console.error('Error reordering steps:', error);
    return Response.json(
      { error: 'Failed to reorder steps' },
      { status: 500 }
    );
  }
}
