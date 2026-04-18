export { AnimationBase } from './AnimationBase.js';
export * from './common/index.js';
export * from './doraemon/index.js';
export * from './nobita/index.js';
export * from './shizuka/index.js';

import { CommonAnimations } from './common/index.js';
import { DoraemonAnimations } from './doraemon/index.js';
import { NobitaAnimations } from './nobita/index.js';
import { ShizukaAnimations } from './shizuka/index.js';

export const AnimationRegistry = {
  ...CommonAnimations,
  ...DoraemonAnimations,
  ...NobitaAnimations,
  ...ShizukaAnimations,
};
