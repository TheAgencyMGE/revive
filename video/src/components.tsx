import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { C, MONO, SANS, clamp, ease } from './theme';

/** Blueprint grid ground shared by every scene. */
export const Ground: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: C.ground,
      backgroundImage: `linear-gradient(${C.line}38 1px, transparent 1px), linear-gradient(90deg, ${C.line}38 1px, transparent 1px)`,
      backgroundSize: '64px 64px',
    }}
  />
);

/** Fades a scene in and out at its edges. */
export const SceneFade: React.FC<{ children: React.ReactNode; duration: number }> = ({
  children,
  duration,
}) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(frame, [0, 12, duration - 12, duration], [0, 1, 1, 0], clamp),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string; delay?: number }> = ({
  children,
  color = C.faint,
  delay = 0,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 30,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color,
        opacity: interpolate(frame, [delay, delay + 18], [0, 1], { ...clamp, easing: ease }),
        translate: interpolate(frame, [delay, delay + 18], ['0px 14px', '0px 0px'], {
          ...clamp,
          easing: ease,
        }),
      }}
    >
      {children}
    </div>
  );
};

export const Headline: React.FC<{
  children: React.ReactNode;
  size?: number;
  delay?: number;
  color?: string;
}> = ({ children, size = 96, delay = 6, color = C.ink }) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 1.08,
        letterSpacing: '-0.03em',
        color,
        opacity: interpolate(frame, [delay, delay + 22], [0, 1], { ...clamp, easing: ease }),
        translate: interpolate(frame, [delay, delay + 22], ['0px 24px', '0px 0px'], {
          ...clamp,
          easing: ease,
        }),
      }}
    >
      {children}
    </div>
  );
};

export const Body: React.FC<{ children: React.ReactNode; delay?: number }> = ({
  children,
  delay = 16,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: 44,
        lineHeight: 1.35,
        color: C.muted,
        maxWidth: 1300,
        opacity: interpolate(frame, [delay, delay + 20], [0, 1], { ...clamp, easing: ease }),
      }}
    >
      {children}
    </div>
  );
};

/**
 * A real product screenshot inside a browser frame, with a slow push-in and an
 * optional focus pan. Screenshots are 2880x1800 (16:10).
 */
export const Screen: React.FC<{
  src: string;
  width?: number;
  delay?: number;
  /** Zoom from 1 to this over the scene. */
  zoomTo?: number;
  /** Point the zoom moves toward, as CSS transform-origin, e.g. "75% 70%". */
  focus?: string;
}> = ({ src, width = 1500, delay = 0, zoomTo = 1.06, focus = '50% 0%' }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const height = width * (1800 / 2880);

  return (
    <div
      style={{
        width,
        borderRadius: 18,
        overflow: 'hidden',
        border: `2px solid ${C.line}`,
        backgroundColor: C.surface,
        boxShadow: '0 40px 120px rgba(0,0,0,0.55)',
        opacity: interpolate(frame, [delay, delay + 20], [0, 1], { ...clamp, easing: ease }),
        translate: interpolate(frame, [delay, delay + 24], ['0px 60px', '0px 0px'], {
          ...clamp,
          easing: ease,
        }),
      }}
    >
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          paddingLeft: 20,
          borderBottom: `2px solid ${C.line}`,
          backgroundColor: C.raised,
        }}
      >
        {[C.rust, C.brass, C.verdigris].map((color) => (
          <div key={color} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color, opacity: 0.8 }} />
        ))}
        <div style={{ marginLeft: 18, fontFamily: MONO, fontSize: 20, color: C.faint }}>
          localhost:3000
        </div>
      </div>
      <div style={{ width, height, overflow: 'hidden' }}>
        <Img
          src={staticFile(`screens/${src}.png`)}
          style={{
            width,
            height,
            transformOrigin: focus,
            scale: interpolate(frame, [delay + 10, durationInFrames - 15], [1, zoomTo], {
              ...clamp,
              easing: ease,
            }),
          }}
        />
      </div>
    </div>
  );
};

/** Centered column scene layout with reserved slots. */
export const Stack: React.FC<{ children: React.ReactNode; gap?: number; align?: 'center' | 'flex-start' }> = ({
  children,
  gap = 36,
  align = 'center',
}) => (
  <AbsoluteFill
    style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: align,
      justifyContent: 'center',
      gap,
      padding: '100px 160px',
      textAlign: align === 'center' ? 'center' : 'left',
    }}
  >
    {children}
  </AbsoluteFill>
);

/** The Revive mark: a stratigraphy column. */
export const Mark: React.FC<{ size?: number }> = ({ size = 120 }) => {
  const frame = useCurrentFrame();
  const layers = [C.rust, C.brass, C.verdigris, C.line];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: size * 0.07, width: size }}>
      {layers.map((color, i) => (
        <div
          key={color}
          style={{
            height: size * 0.16,
            borderRadius: size * 0.04,
            backgroundColor: color,
            transformOrigin: 'left center',
            scale: interpolate(frame, [i * 5, i * 5 + 18], ['0 1', '1 1'], { ...clamp, easing: ease }),
          }}
        />
      ))}
    </div>
  );
};
