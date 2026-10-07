import type { ReactElement } from 'react';
import hero from '../assets/illustrations/hero.svg';
import workspace from '../assets/illustrations/workspace.svg';
import documents from '../assets/illustrations/documents.svg';
import sources from '../assets/illustrations/sources.svg';
import analyses from '../assets/illustrations/analyses.svg';
import search from '../assets/illustrations/search.svg';
import evidence from '../assets/illustrations/evidence.svg';
import reading from '../assets/illustrations/reading.svg';
import team from '../assets/illustrations/team.svg';
import magnifier from '../assets/illustrations/magnifier.svg';
import laptop from '../assets/illustrations/laptop.svg';
import thinking from '../assets/illustrations/thinking.svg';
import styles from './Illustration.module.css';

const scenes = {
  hero,
  workspace,
  documents,
  sources,
  analyses,
  search,
  evidence,
  reading,
  team,
  magnifier,
  laptop,
  thinking,
};

export type IllustrationScene = keyof typeof scenes;

/** Decorative reference artwork; the surrounding UI supplies meaning and actions. */
export function Illustration({
  scene,
  size = 'default',
}: {
  readonly scene: IllustrationScene;
  readonly size?: 'compact' | 'default' | 'hero';
}): ReactElement {
  return (
    <img
      src={scenes[scene]}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={scene === 'hero' ? 600 : 400}
      height={scene === 'hero' ? 420 : 300}
      className={[styles.illustration, styles[size]].join(' ')}
      data-illustration={scene}
    />
  );
}
