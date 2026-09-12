import { Easing } from 'remotion';

/** Same oxidised-metal palette as the app, so the video reads as the product. */
export const C = {
  ground: '#0c1017',
  surface: '#161c27',
  raised: '#1d2532',
  sunken: '#080b10',
  line: '#2a3444',
  ink: '#e6e9ef',
  muted: '#8b95a8',
  faint: '#5e687a',
  brass: '#d9a441',
  verdigris: '#4fb49a',
  rust: '#c9553d',
  blueprint: '#5aa8d6',
};

export const MONO =
  '"Cascadia Code", "SF Mono", Consolas, "Roboto Mono", Menlo, monospace';
export const SANS = '"Segoe UI", -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';

export const FPS = 30;

export const ease = Easing.bezier(0.16, 1, 0.3, 1);
export const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

/** Scene boundaries in frames. */
export const SCENES = {
  hook: { from: 0, duration: 120 },
  paste: { from: 120, duration: 150 },
  breaks: { from: 270, duration: 180 },
  dating: { from: 450, duration: 180 },
  pipeline: { from: 630, duration: 180 },
  fix: { from: 810, duration: 180 },
  ecosystems: { from: 990, duration: 180 },
  outro: { from: 1170, duration: 120 },
} as const;

export const TOTAL_FRAMES = 1290;
