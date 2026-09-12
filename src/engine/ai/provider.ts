import type {
  DetectionResult,
  Diagnosis,
  EnvironmentSpec,
  FailureCategory,
  VerificationResult,
} from '../types';
import type { AiConfig } from '../orchestrator';

/**
 * Optional AI assistance.
 *
 * Hard rules enforced here:
 *  - Revive never requires an AI provider. Every call site handles absence.
 *  - Keys are passed per-request and held only for the duration of the call.
 *    They are never written to disk, never logged, and never placed in the
 *    environment of a sandboxed process.
 *  - Only build output and manifest metadata are sent — never repository
 *    source files, and never anything the redactor has not already scrubbed.
 *  - Any failure (bad key, rate limit, malformed response) degrades silently
 *    back to deterministic behaviour.
 */

export interface AiDiagnoseInput {
  config: AiConfig;
  verification: VerificationResult;
  detection: DetectionResult;
  environment: EnvironmentSpec;
  signal?: AbortSignal;
}

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-4o-mini',
} as const;

const VALID_CATEGORIES: FailureCategory[] = [
  'runtime-version',
  'obsolete-dependency',
  'dead-package',
  'broken-lockfile',
  'deprecated-api',
  'native-module',
  'node-sass',
  'bundler-incompat',
  'module-system',
  'python-version',
  'java-version',
  'compiler-behavior',
  'missing-env',
  'outdated-script',
  'peer-conflict',
  'build-config',
  'network',
  'missing-toolchain',
  'test-failure',
  'unknown',
];

const SYSTEM_PROMPT = `You are a build-failure analyst for abandoned open-source repositories.

You will be given: the detected project type, the reconstructed original runtime, and the output of a failed build.

Your job is to identify why the project no longer builds. Prefer explanations grounded in ecosystem history: runtime version changes, packages that were unpublished or went ESM-only, build tools whose config format changed, standard-library removals, and similar.

Respond with ONLY a JSON array (no prose, no markdown fence). Each element:
{
  "category": one of ${VALID_CATEGORIES.join('|')},
  "title": short specific sentence,
  "detail": 2-4 sentences explaining the cause and what the minimal fix would be,
  "evidence": the exact lines from the output that show this,
  "confidence": 0-100,
  "severity": "blocker"|"major"|"minor"
}

Return at most 3 elements. If the output does not clearly show a cause, return [].
Never invent log lines that are not present in the input.`;

export async function aiDiagnose(input: AiDiagnoseInput): Promise<Diagnosis[]> {
  const failing = input.verification.steps.filter(
    (s) => s.status === 'failed' || s.status === 'timeout',
  );
  if (!failing.length) return [];

  const prompt = buildPrompt(input, failing);
  const timeout = AbortSignal.timeout(60_000);
  const signal = input.signal
    ? anySignal([input.signal, timeout])
    : timeout;

  const raw =
    input.config.provider === 'anthropic'
      ? await callAnthropic(input.config, prompt, signal)
      : await callOpenAI(input.config, prompt, signal);

  return parseDiagnoses(raw, failing[0].step);
}

function buildPrompt(
  input: AiDiagnoseInput,
  failing: VerificationResult['steps'],
): string {
  const parts: string[] = [];
  parts.push(`Project type: ${input.detection.language}`);
  if (input.detection.framework) parts.push(`Framework: ${input.detection.framework}`);
  parts.push(`Package manager: ${input.detection.packageManager}`);
  parts.push(
    `Reconstructed original runtime: ${input.environment.runtime ?? 'unknown'} ${input.environment.runtimeVersion ?? '?'}`,
  );
  parts.push(`Runtime actually used: ${input.environment.actualVersion ?? 'unknown'}`);
  parts.push('');

  for (const step of failing.slice(0, 2)) {
    parts.push(`--- ${step.step} failed (exit ${step.exitCode}) ---`);
    parts.push(`Command: ${step.command}`);
    // Cap what leaves the machine. The tail holds the actual error.
    parts.push(step.output.slice(-6000));
    parts.push('');
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function callAnthropic(
  config: AiConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODELS.anthropic,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    // Never include the response body verbatim — it can echo the key.
    throw new Error(`Anthropic API returned ${response.status}`);
  }

  const data = (await response.json()) as {
    content?: { type: string; text?: string }[];
  };
  return data.content?.find((c) => c.type === 'text')?.text ?? '';
}

async function callOpenAI(
  config: AiConfig,
  prompt: string,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model || DEFAULT_MODELS.openai,
      max_tokens: 1500,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API returned ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the model response defensively. A malformed or hallucinated response
 * must degrade to "no AI findings", never to a crash or a bogus diagnosis.
 */
export function parseDiagnoses(raw: string, step: Diagnosis['step']): Diagnosis[] {
  if (!raw.trim()) return [];

  // Tolerate a markdown fence even though the prompt forbids it.
  const cleaned = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: Diagnosis[] = [];
  for (const item of parsed.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;

    const category = VALID_CATEGORIES.includes(record.category as FailureCategory)
      ? (record.category as FailureCategory)
      : 'unknown';
    const title = typeof record.title === 'string' ? record.title.slice(0, 200) : null;
    const detail = typeof record.detail === 'string' ? record.detail.slice(0, 2000) : '';
    if (!title) continue;

    const severity =
      record.severity === 'blocker' || record.severity === 'major' || record.severity === 'minor'
        ? record.severity
        : 'major';

    const confidence = clampNumber(record.confidence, 0, 100, 50);

    out.push({
      category,
      title,
      detail,
      evidence: typeof record.evidence === 'string' ? record.evidence.slice(0, 1500) : '',
      step,
      // AI findings are capped below deterministic confidence so a rule match
      // always outranks a model guess when both fire.
      confidence: Math.min(confidence, 75),
      severity,
      suggestedRepairs: [],
      source: 'ai',
    });
  }

  return out;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/** Combine abort signals (AbortSignal.any is not available on all runtimes). */
function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

/** Validate a key's shape without ever logging or storing it. */
export function looksLikeValidKey(provider: 'anthropic' | 'openai', key: string): boolean {
  if (!key || key.length < 20 || key.length > 400) return false;
  if (provider === 'anthropic') return key.startsWith('sk-ant-');
  return key.startsWith('sk-');
}
