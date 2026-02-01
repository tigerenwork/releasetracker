'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { createRelease, updateRelease } from '@/lib/actions/releases';
import type { Release, ReleaseType } from '@/lib/db/schema';

interface ReleaseFormProps {
  release?: Release;
  isEdit?: boolean;
}

const releaseTypes: { value: ReleaseType; label: string }[] = [
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'release', label: 'Regular Release' },
  { value: 'hotfix', label: 'Hotfix' },
];

export function ReleaseForm({ release, isEdit = false }: ReleaseFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ReleaseType>(release?.type || 'release');

  async function handleSubmit(formData: FormData) {
    setIsSubmitting(true);
    setError(null);

    try {
      const data = {
        name: formData.get('name') as string,
        type: formData.get('type') as ReleaseType,
        versionNumber: formData.get('versionNumber') as string || undefined,
        releaseDate: formData.get('releaseDate') 
          ? new Date(formData.get('releaseDate') as string) 
          : undefined,
        description: formData.get('description') as string || undefined,
      };

      if (isEdit && release) {
        await updateRelease(release.id, data);
      } else {
        await createRelease(data);
      }

      router.push('/releases');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isEdit ? 'Edit Release' : 'Create New Release'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-md text-sm">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="name">Release Name *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={release?.name}
              placeholder="e.g., Q1 2024 Major Release"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="type">Release Type *</Label>
            <Select 
              name="type" 
              defaultValue={release?.type || 'release'}
              onValueChange={(value) => setSelectedType(value as ReleaseType)}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {releaseTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedType === 'release' && (
            <div className="space-y-2">
              <Label htmlFor="versionNumber">Version Number</Label>
              <Input
                id="versionNumber"
                name="versionNumber"
                defaultValue={release?.versionNumber || ''}
                placeholder="e.g., v2.5.0"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="releaseDate">Release Date</Label>
            <Input
              id="releaseDate"
              name="releaseDate"
              type="date"
              defaultValue={release?.releaseDate 
                ? new Date(release.releaseDate).toISOString().split('T')[0] 
                : ''}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description / Release Notes</Label>
            <Textarea
              id="description"
              name="description"
              defaultValue={release?.description || ''}
              placeholder="Describe this release, changes, notes..."
              rows={5}
            />
          </div>

          <div className="flex gap-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : isEdit ? 'Update Release' : 'Create Release'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/releases')}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
