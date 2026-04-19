export { VoiceBase } from './VoiceBase.js';

export const VoiceRegistry = {};

export function registerVoice(name, Class) {
  VoiceRegistry[name] = Class;
}
