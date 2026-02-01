import { NextRequest, NextResponse } from 'next/server';
import { addStepTemplate, getNextOrderIndex } from '@/lib/actions/step-templates';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { releaseId, category, name, type, content, description } = body;

    const orderIndex = await getNextOrderIndex(releaseId, category);

    const step = await addStepTemplate({
      releaseId,
      category,
      name,
      type,
      content,
      orderIndex,
      description,
    });

    return NextResponse.json(step);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
