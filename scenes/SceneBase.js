import * as THREE from 'three';

export class SceneBase {
  constructor(name) {
    this.name = name;
    this.scene = new THREE.Scene();
    this.scene.name = name;
    this.lights = [];
    this.characters = [];
  }

  build() {
    // Override in subclass
    this.addLights();
    return this.scene;
  }

  addLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    this.lights.push(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    this.scene.add(dir);
    this.lights.push(dir);
  }

  addCharacter(character) {
    if (!this.characters.includes(character)) {
      this.characters.push(character);
      this.scene.add(character.mesh);
    }
  }

  removeCharacter(character) {
    const idx = this.characters.indexOf(character);
    if (idx !== -1) {
      this.characters.splice(idx, 1);
      this.scene.remove(character.mesh);
    }
  }

  update(time, delta) {
    for (const c of this.characters) {
      c.update(time, delta);
    }
  }
}
