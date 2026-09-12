import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { JobPage } from '@/components/job/job-view';
import { getJobView } from '@/server/store';
import { ensureQueueStarted } from '@/server/queue';
import { jobIdSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  if (!jobIdSchema.safeParse(id).success) return { title: 'Revival' };
  const job = await getJobView(id);
  const name = job?.metadata ? `${job.metadata.owner}/${job.metadata.name}` : 'Revival';
  return { title: name };
}

export default async function Page({ params }: Params) {
  const { id } = await params;
  if (!jobIdSchema.safeParse(id).success) notFound();

  await ensureQueueStarted();
  const job = await getJobView(id);
  if (!job) notFound();

  return <JobPage initialJob={job} />;
}
