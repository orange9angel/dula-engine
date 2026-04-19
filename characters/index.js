export { CharacterBase } from './CharacterBase.js';

export const CharacterRegistry = {};

export function registerCharacter(name, Class) {
  CharacterRegistry[name] = Class;
}
