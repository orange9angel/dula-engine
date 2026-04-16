import * as THREE from 'three';
import { SceneBase } from './SceneBase.js';

export class RoomScene extends SceneBase {
  constructor() {
    super('RoomScene');
  }

  build() {
    super.build();

    // Floor
    const floorGeo = new THREE.PlaneGeometry(20, 20);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0xd9a066, roughness: 0.8 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Back wall
    const wallGeo = new THREE.PlaneGeometry(20, 10);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf5f5dc, roughness: 0.9 });
    const backWall = new THREE.Mesh(wallGeo, wallMat);
    backWall.position.set(0, 5, -5);
    backWall.receiveShadow = true;
    this.scene.add(backWall);

    // Left wall
    const leftWall = new THREE.Mesh(wallGeo, wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-10, 5, 0);
    leftWall.receiveShadow = true;
    this.scene.add(leftWall);

    // Desk
    const deskTopGeo = new THREE.BoxGeometry(3, 0.15, 1.5);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.6 });
    const deskTop = new THREE.Mesh(deskTopGeo, woodMat);
    deskTop.position.set(0, 1.2, -3);
    deskTop.castShadow = true;
    this.scene.add(deskTop);

    const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.2, 16);
    for (const [x, z] of [[-1.3, -0.6], [1.3, -0.6], [-1.3, 0.6], [1.3, 0.6]]) {
      const leg = new THREE.Mesh(legGeo, woodMat);
      leg.position.set(x, 0.6, -3 + z);
      leg.castShadow = true;
      this.scene.add(leg);
    }

    // Chair
    const seatGeo = new THREE.BoxGeometry(1, 0.1, 1);
    const seat = new THREE.Mesh(seatGeo, woodMat);
    seat.position.set(0, 0.7, -1.5);
    seat.castShadow = true;
    this.scene.add(seat);

    const backGeo = new THREE.BoxGeometry(1, 1, 0.1);
    const back = new THREE.Mesh(backGeo, woodMat);
    back.position.set(0, 1.2, -1.95);
    back.castShadow = true;
    this.scene.add(back);

    const chairLegGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 16);
    for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
      const leg = new THREE.Mesh(chairLegGeo, woodMat);
      leg.position.set(x, 0.35, -1.5 + z);
      leg.castShadow = true;
      this.scene.add(leg);
    }

    // Window
    const windowFrameGeo = new THREE.BoxGeometry(4, 3, 0.1);
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4 });
    const windowFrame = new THREE.Mesh(windowFrameGeo, frameMat);
    windowFrame.position.set(0, 4.5, -4.95);
    this.scene.add(windowFrame);

    const glassGeo = new THREE.PlaneGeometry(3.6, 2.6);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xadd8e6,
      transparent: true,
      opacity: 0.4,
      roughness: 0.1,
    });
    const glass = new THREE.Mesh(glassGeo, glassMat);
    glass.position.set(0, 4.5, -4.9);
    this.scene.add(glass);

    return this.scene;
  }
}
