import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { Body, Eyebrow, Headline, Mark, Screen, Stack } from './components';
import { C, MONO, SANS, clamp, ease } from './theme';

// ---------------------------------------------------------------------------
// 1. Hook
// ---------------------------------------------------------------------------
export const Hook: React.FC = () => (
  <Stack gap={44}>
    <Mark size={130} />
    <Headline size={86} delay={14}>
      Most dead repos aren&apos;t broken.
    </Headline>
    <Headline size={86} delay={40} color={C.brass}>
      They&apos;re stranded.
    </Headline>
  </Stack>
);

// ---------------------------------------------------------------------------
// 2. Paste
// ---------------------------------------------------------------------------
export const Paste: React.FC = () => (
  <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 40, padding: '80px 160px' }}>
    <Headline size={72}>Paste an abandoned GitHub repo.</Headline>
    <Screen src="home" width={1440} delay={10} zoomTo={1.1} focus="50% 55%" />
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// 3. It breaks — a real failure, typed out
// ---------------------------------------------------------------------------
const FAILURE = [
  { text: '$ npm run build', color: C.blueprint },
  { text: '> webpack --mode production', color: C.faint },
  { text: '', color: C.faint },
  { text: 'Error: error:0308010C:digital envelope routines::unsupported', color: C.rust },
  { text: "    at NormalModule._initBuildHash (webpack/lib/NormalModule.js:417)", color: C.faint },
  { text: "  code: 'ERR_OSSL_EVP_UNSUPPORTED'", color: C.rust },
  { text: '', color: C.faint },
  { text: 'build failed (exit 1)', color: C.rust },
];

export const Breaks: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stack gap={44}>
      <Eyebrow color={C.rust}>Step one: run it untouched</Eyebrow>
      <Headline size={76}>Revive watches it fail first.</Headline>
      <div
        style={{
          width: 1500,
          borderRadius: 18,
          border: `2px solid ${C.line}`,
          backgroundColor: C.sunken,
          padding: '40px 48px',
          textAlign: 'left',
          fontFamily: MONO,
          fontSize: 32,
          lineHeight: 1.6,
          opacity: interpolate(frame, [18, 36], [0, 1], { ...clamp, easing: ease }),
        }}
      >
        {FAILURE.map((line, i) => (
          <div
            key={i}
            style={{
              color: line.color,
              minHeight: 51,
              whiteSpace: 'pre',
              opacity: interpolate(frame, [34 + i * 9, 40 + i * 9], [0, 1], clamp),
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// 4. Dating the specimen
// ---------------------------------------------------------------------------
export const Dating: React.FC = () => (
  <AbsoluteFill style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 36, padding: '80px 160px' }}>
    <Eyebrow color={C.brass}>Step two: archaeology</Eyebrow>
    <Headline size={66}>It dates the project from its evidence.</Headline>
    <Screen src="webpack-findings" width={1400} delay={14} zoomTo={1.45} focus="68% 88%" />
  </AbsoluteFill>
);

// ---------------------------------------------------------------------------
// 5. Pipeline strata
// ---------------------------------------------------------------------------
const PHASES = [
  ['Analyze', 'Clone and detect the build'],
  ['Reconstruct', 'Date it from its own evidence'],
  ['Baseline', 'Run it untouched'],
  ['Diagnose', 'Name the real blocker'],
  ['Repair', 'Apply the smallest fix'],
  ['Verify', 'Re-run; roll back if worse'],
  ['Complete', 'Diff, patch, report'],
];

export const Pipeline: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 120, padding: '100px 160px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 30, width: 600 }}>
        <Eyebrow>Seven layers, in order</Eyebrow>
        <Headline size={80}>Nothing changes until something fails.</Headline>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 920 }}>
        {PHASES.map(([name, blurb], i) => {
          const start = 20 + i * 16;
          const done = interpolate(frame, [start, start + 14], [0, 1], { ...clamp, easing: ease });
          return (
            <div
              key={name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 28,
                padding: '16px 28px',
                borderLeft: `6px solid ${done > 0.5 ? C.verdigris : C.line}`,
                backgroundColor: done > 0.5 ? `${C.verdigris}14` : 'transparent',
                opacity: interpolate(done, [0, 1], [0.35, 1]),
                translate: interpolate(done, [0, 1], ['24px 0px', '0px 0px']),
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 34, letterSpacing: '0.12em', textTransform: 'uppercase', color: done > 0.5 ? C.verdigris : C.faint, width: 330, flexShrink: 0 }}>
                {name}
              </div>
              <div style={{ fontFamily: SANS, fontSize: 30, color: C.muted, whiteSpace: 'nowrap' }}>{blurb}</div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 6. The smallest fix
// ---------------------------------------------------------------------------
export const Fix: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <Stack gap={40}>
      <Eyebrow color={C.verdigris}>Step three: the smallest change that works</Eyebrow>
      <Headline size={76}>One line. No source files touched.</Headline>
      <div
        style={{
          width: 1300,
          borderRadius: 18,
          border: `2px solid ${C.line}`,
          backgroundColor: C.sunken,
          overflow: 'hidden',
          textAlign: 'left',
          fontFamily: MONO,
          fontSize: 36,
          lineHeight: 1.7,
          opacity: interpolate(frame, [16, 34], [0, 1], { ...clamp, easing: ease }),
        }}
      >
        <div style={{ padding: '16px 36px', borderBottom: `2px solid ${C.line}`, color: C.ink, fontSize: 28, display: 'flex', justifyContent: 'space-between' }}>
          <span>package.json</span>
          <span><span style={{ color: C.verdigris }}>+0</span> <span style={{ color: C.rust }}>-1</span></span>
        </div>
        <div style={{ padding: '18px 36px', color: C.muted, whiteSpace: 'pre' }}>{'  "version": "0.4.2",'}</div>
        <div
          style={{
            padding: '0 36px',
            color: C.rust,
            whiteSpace: 'pre',
            backgroundColor: interpolate(frame, [44, 60], [0, 0.16], clamp) > 0 ? `rgba(201,85,61,${interpolate(frame, [44, 60], [0, 0.16], clamp)})` : 'transparent',
          }}
        >
          {'- "type": "module",'}
        </div>
        <div style={{ padding: '18px 36px', color: C.muted, whiteSpace: 'pre' }}>{'  "main": "src/index.js",'}</div>
      </div>
      <Sequence from={84} layout="none">
        <Body delay={0}>
          Tests pass. Build health <span style={{ color: C.faint }}>30</span> →{' '}
          <span style={{ color: C.verdigris, fontWeight: 700 }}>100</span>. Every change shows its reason.
        </Body>
      </Sequence>
    </Stack>
  );
};

// ---------------------------------------------------------------------------
// 7. Five ecosystems — one at a time
// ---------------------------------------------------------------------------
const ECOSYSTEMS = [
  { src: 'python-changes', label: 'Python 2 → 3', note: 'verified by its original tests' },
  { src: 'java-findings', label: 'Java 6 target', note: 'raised to the lowest level JDK 21 accepts' },
  { src: 'webpack-changes', label: 'Webpack 4 on OpenSSL 3', note: 'fixed with zero file edits' },
];

export const Ecosystems: React.FC = () => (
  <AbsoluteFill>
    {ECOSYSTEMS.map((item, i) => (
      <Sequence key={item.src} from={i * 60} durationInFrames={60} name={item.label}>
        <EcosystemCard {...item} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

const EcosystemCard: React.FC<{ src: string; label: string; note: string }> = ({ src, label, note }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 34,
        padding: '80px 160px',
        opacity: interpolate(frame, [0, 8, 52, 60], [0, 1, 1, 0], clamp),
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 28 }}>
        <div style={{ fontFamily: MONO, fontWeight: 700, fontSize: 68, color: C.ink, letterSpacing: '-0.02em' }}>{label}</div>
        <div style={{ fontFamily: SANS, fontSize: 40, color: C.muted }}>{note}</div>
      </div>
      <Screen src={src} width={1360} zoomTo={1.04} />
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// 8. Outro
// ---------------------------------------------------------------------------
export const Outro: React.FC = () => (
  <Stack gap={40}>
    <Mark size={120} />
    <Headline size={120} delay={10}>revive</Headline>
    <Body delay={24}>Node · Python · Java · Go · Rust. No keys, no cloud, no setup.</Body>
    <Sequence from={40} layout="none">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 }}>
        <div style={{ fontFamily: MONO, fontSize: 40, color: C.brass }}>npm install &amp;&amp; npm run dev</div>
        <div style={{ fontFamily: MONO, fontSize: 32, color: C.faint }}>github.com/TheAgencyMGE/revive</div>
      </div>
    </Sequence>
  </Stack>
);
