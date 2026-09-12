import { z } from 'zod';

/**
 * Repository URL validation.
 *
 * This is the primary untrusted input surface. The parser is an allowlist: only
 * https://github.com/<owner>/<repo> is accepted. Everything else — SSH remotes,
 * `ext::` protocol handlers, credentials in the URL, internal hostnames, IP
 * literals, and non-GitHub hosts — is rejected before git is ever invoked.
 */

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** Hosts that must never be reachable, even if someone points DNS at them. */
const BLOCKED_HOST_PATTERN =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fc00:|\[?fd00:|.*\.local|.*\.internal|metadata\.google\.internal)/i;

export interface ParsedRepo {
  owner: string;
  name: string;
  /** Normalised clone URL — this is what actually reaches git. */
  cloneUrl: string;
  /** Canonical browse URL for display. */
  webUrl: string;
  ref?: string;
}

export class RepoUrlError extends Error {
  readonly code: string;
  constructor(message: string, code = 'INVALID_URL') {
    super(message);
    this.name = 'RepoUrlError';
    this.code = code;
  }
}

export function parseRepoUrl(input: string): ParsedRepo {
  const raw = String(input ?? '').trim();

  if (!raw) throw new RepoUrlError('Enter a GitHub repository URL.', 'EMPTY');
  if (raw.length > 500) throw new RepoUrlError('That URL is too long.', 'TOO_LONG');
  if (/[\u0000-\u001F\u007F]/.test(raw)) {
    throw new RepoUrlError('That URL contains control characters.', 'CONTROL_CHARS');
  }

  // Accept the common shorthand "owner/repo".
  let candidate = raw;
  if (/^[A-Za-z0-9][\w.-]*\/[\w.-]+$/.test(raw) && !raw.includes('://')) {
    candidate = `https://github.com/${raw}`;
  }
  // Accept a scheme-less github.com URL.
  if (/^(www\.)?github\.com\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^www\./i, '')}`;
  }

  // Reject SSH / git / ext protocols explicitly so the error is actionable.
  if (/^(git|ssh|ftp|file|ext|data|javascript):/i.test(candidate) || candidate.includes('git@')) {
    throw new RepoUrlError(
      'Only public HTTPS GitHub URLs are supported (SSH and git:// remotes are rejected).',
      'UNSUPPORTED_PROTOCOL',
    );
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new RepoUrlError(
      'That is not a valid URL. Expected https://github.com/owner/repo',
      'MALFORMED',
    );
  }

  if (url.protocol !== 'https:') {
    throw new RepoUrlError('Repository URLs must use HTTPS.', 'NOT_HTTPS');
  }
  if (url.username || url.password) {
    throw new RepoUrlError('Remove credentials from the URL.', 'CREDENTIALS_IN_URL');
  }
  if (url.port && url.port !== '443') {
    throw new RepoUrlError('Custom ports are not allowed.', 'PORT_NOT_ALLOWED');
  }

  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOST_PATTERN.test(host)) {
    throw new RepoUrlError('That host is not reachable from Revive.', 'BLOCKED_HOST');
  }
  if (host !== 'github.com' && host !== 'www.github.com') {
    throw new RepoUrlError(
      `Only github.com repositories are supported (got "${host}").`,
      'HOST_NOT_ALLOWED',
    );
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw new RepoUrlError(
      'That URL is missing the owner or repository name. Expected https://github.com/owner/repo',
      'INCOMPLETE_PATH',
    );
  }

  const owner = segments[0];
  let name = segments[1].replace(/\.git$/i, '');

  if (!OWNER_PATTERN.test(owner)) {
    throw new RepoUrlError(`"${owner}" is not a valid GitHub owner name.`, 'BAD_OWNER');
  }
  if (!REPO_PATTERN.test(name) || name === '.' || name === '..') {
    throw new RepoUrlError(`"${name}" is not a valid repository name.`, 'BAD_REPO');
  }

  // Support /tree/<ref> links by extracting the ref.
  let ref: string | undefined;
  if (segments[2] === 'tree' && segments[3]) {
    const candidateRef = segments.slice(3).join('/');
    if (/^[A-Za-z0-9._/-]{1,200}$/.test(candidateRef) && !candidateRef.includes('..')) {
      ref = candidateRef;
    }
  }

  return {
    owner,
    name,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    webUrl: `https://github.com/${owner}/${name}`,
    ref,
  };
}

export function isValidRepoUrl(input: string): boolean {
  try {
    parseRepoUrl(input);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// API schemas
// ---------------------------------------------------------------------------

export const createJobSchema = z
  .object({
    repoUrl: z.string().trim().max(500).optional(),
    fixtureId: z
      .string()
      .trim()
      .regex(/^[a-z0-9-]{1,64}$/, 'Invalid fixture id')
      .optional(),
    ai: z
      .object({
        provider: z.enum(['anthropic', 'openai']),
        apiKey: z.string().min(10).max(400),
        model: z.string().max(100).optional(),
      })
      .optional(),
  })
  .refine((value) => Boolean(value.repoUrl || value.fixtureId), {
    message: 'Provide either a repository URL or a fixture id.',
  });

export type CreateJobInput = z.infer<typeof createJobSchema>;

export const jobIdSchema = z.string().regex(/^[a-z0-9]{20,40}$/i, 'Invalid job id');

/** Validate a job id from a route param before it reaches the database. */
export function parseJobId(value: string): string {
  const result = jobIdSchema.safeParse(value);
  if (!result.success) throw new RepoUrlError('Invalid job id.', 'BAD_JOB_ID');
  return result.data;
}
