'use client';

import { useState } from 'react';
import { Plus, FileText } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

interface ExistingStep {
  id: number;
  name: string;
  orderIndex: number;
}

interface AddCustomStepDialogProps {
  releaseId: number;
  customerId: number;
  customerName: string;
  category: 'deploy' | 'verify';
  existingSteps: ExistingStep[];
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onAdd: (data: {
    name: string;
    category: 'deploy' | 'verify';
    type: 'bash' | 'sql' | 'text';
    content: string;
    orderIndex: number;
    addToTemplate: boolean;
  }) => Promise<void>;
}

export function AddCustomStepDialog({
  releaseId,
  customerId,
  customerName,
  category,
  existingSteps,
  isOpen: controlledIsOpen,
  onOpenChange: controlledOnOpenChange,
  onAdd,
}: AddCustomStepDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<'bash' | 'sql' | 'text'>('bash');
  const [content, setContent] = useState('');
  const [insertAfterId, setInsertAfterId] = useState<string>('__start__');
  const [addToTemplate, setAddToTemplate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isControlled = controlledIsOpen !== undefined;
  const openState = isControlled ? controlledIsOpen : isOpen;
  const setOpenState = isControlled ? controlledOnOpenChange! : setIsOpen;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) return;

    setIsSubmitting(true);

    // Calculate orderIndex based on insert position
    let orderIndex = existingSteps.length;
    if (insertAfterId && insertAfterId !== '__start__') {
      const afterStep = existingSteps.find(s => s.id.toString() === insertAfterId);
      if (afterStep) {
        // Use decimal to insert between (e.g., if after step with index 1, use 1.5)
        const nextStep = existingSteps.find(s => s.orderIndex > afterStep.orderIndex);
        if (nextStep) {
          orderIndex = (afterStep.orderIndex + nextStep.orderIndex) / 2;
        } else {
          orderIndex = afterStep.orderIndex + 1;
        }
      }
    } else if (insertAfterId === '__start__' && existingSteps.length > 0) {
      // Insert at beginning - use negative decimal or 0.5 before first
      const firstStep = existingSteps[0];
      orderIndex = firstStep.orderIndex / 2;
    }

    await onAdd({
      name: name.trim(),
      category,
      type,
      content: content.trim(),
      orderIndex,
      addToTemplate,
    });

    // Reset form
    setName('');
    setType('bash');
    setContent('');
    setInsertAfterId('');
    setAddToTemplate(false);
    setIsSubmitting(false);
    setOpenState(false);
  };

  const typeOptions = [
    { value: 'bash', label: 'Bash Script' },
    { value: 'sql', label: 'SQL' },
    { value: 'text', label: 'Text/Instructions' },
  ];

  return (
    <Dialog open={openState} onOpenChange={setOpenState}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Plus className="w-4 h-4 mr-1" />
            Add Custom Step
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Add Custom Step for {customerName}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4">
          <div className="space-y-2">
            <Label htmlFor="name">Step Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Run Custom Migration"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as 'bash' | 'sql' | 'text')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {typeOptions.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="position">Insert Position</Label>
              <Select value={insertAfterId} onValueChange={setInsertAfterId}>
                <SelectTrigger>
                  <SelectValue placeholder="At the beginning" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__start__">At the beginning</SelectItem>
                  {existingSteps.map((step) => (
                    <SelectItem key={step.id} value={step.id.toString()}>
                      After: {step.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="content">Content</Label>
            <Textarea
              id="content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={type === 'bash' ? '#!/bin/bash\necho "Hello World"' : type === 'sql' ? 'SELECT * FROM users;' : 'Enter instructions here...'}
              className="font-mono min-h-[200px]"
              required
            />
          </div>

          <div className="flex items-start space-x-3 p-4 bg-slate-50 rounded-lg">
            <Checkbox
              id="addToTemplate"
              checked={addToTemplate}
              onCheckedChange={(checked) => setAddToTemplate(checked as boolean)}
            />
            <div className="space-y-1">
              <Label
                htmlFor="addToTemplate"
                className="text-sm font-medium cursor-pointer"
              >
                Add to template (apply to all customers)
              </Label>
              <p className="text-sm text-slate-500">
                If checked, this step will be added to the release template and all customers will receive it.
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpenState(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim() || !content.trim()}>
              {isSubmitting ? 'Adding...' : 'Add Step'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
