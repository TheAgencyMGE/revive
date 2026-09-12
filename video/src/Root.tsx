import './index.css';
import React from 'react';
import { AbsoluteFill, Composition, Sequence } from 'remotion';
import { Ground, SceneFade } from './components';
import { Breaks, Dating, Ecosystems, Fix, Hook, Outro, Paste, Pipeline } from './scenes';
import { FPS, SCENES, TOTAL_FRAMES } from './theme';

const ORDER = [
  ['Hook', SCENES.hook, Hook],
  ['Paste', SCENES.paste, Paste],
  ['It breaks', SCENES.breaks, Breaks],
  ['Archaeology', SCENES.dating, Dating],
  ['Pipeline', SCENES.pipeline, Pipeline],
  ['The fix', SCENES.fix, Fix],
  ['Ecosystems', SCENES.ecosystems, Ecosystems],
  ['Outro', SCENES.outro, Outro],
] as const;

export const ReviveDemo: React.FC = () => (
  <AbsoluteFill>
    <Ground />
    {ORDER.map(([name, timing, Scene]) => (
      <Sequence key={name} name={name} from={timing.from} durationInFrames={timing.duration}>
        <SceneFade duration={timing.duration}>
          <Scene />
        </SceneFade>
      </Sequence>
    ))}
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ReviveDemo"
    component={ReviveDemo}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
