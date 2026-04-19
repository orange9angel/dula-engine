export const DirectorRegistry = {};

export function registerDirector(name, Class) {
  DirectorRegistry[name] = Class;
}
