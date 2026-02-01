import { NextRequest } from 'next/server';
import { getStepWithDetails } from '@/lib/actions/customer-steps';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const stepId = parseInt(id);
    
    if (isNaN(stepId)) {
      return Response.json({ error: 'Invalid step ID' }, { status: 400 });
    }
    
    const step = await getStepWithDetails(stepId);
    
    if (!step) {
      return Response.json({ error: 'Step not found' }, { status: 404 });
    }
    
    return Response.json(step);
  } catch (error) {
    console.error('Error fetching step details:', error);
    return Response.json(
      { error: 'Failed to fetch step details' },
      { status: 500 }
    );
  }
}
