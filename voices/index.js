export { VoiceBase } from './VoiceBase.js';

import DoraemonVoice from './DoraemonVoice.js';
import NobitaVoice from './NobitaVoice.js';

export const VoiceRegistry = {
  Doraemon: DoraemonVoice,
  Nobita: NobitaVoice,
};
