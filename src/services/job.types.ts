import { z } from 'zod';
import type { SavedJob, JobType, JobStatus } from '../db/job.repo.js';

export const JobExtractionZodSchema = z.object({
  type: z.enum(['email', 'form', 'other']).default('other'),
  jobTitle: z.string().nullable().default(null),
  company: z.string().nullable().default(null),
  applyEmail: z.string().nullable().default(null),
  requiredSubject: z.string().nullable().default(null),
  requiredInstructions: z.string().nullable().default(null),
  formLink: z.string().nullable().default(null),
  formQuestions: z.array(z.string()).default([]),
  deadline: z.string().nullable().default(null),
  summary: z.string().nullable().default(null),
  status: z.enum(['to-apply', 'applied', 'needs-review']).default('to-apply'),
});

export type JobExtractionResult = z.infer<typeof JobExtractionZodSchema>;

export interface JobActionButton {
  text: string;
  callbackData: string;
}

export interface JobMessagePayload {
  text: string;
  buttons?: JobActionButton[][];
}

export interface JobMessagingAdapter {
  sendMessage(chatId: number | string, payload: JobMessagePayload): Promise<{ messageId: number | string }>;
  editMessage(chatId: number | string, messageId: number | string, payload: JobMessagePayload): Promise<boolean>;
}

export type { SavedJob, JobType, JobStatus };
