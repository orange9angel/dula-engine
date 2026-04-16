import * as THREE from 'three';
import { CharacterBase } from './CharacterBase.js';

export class Nobita extends CharacterBase {
  constructor() {
    super('Nobita');
  }

  build() {
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffdfc4, roughness: 0.5 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xffd700, roughness: 0.6 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: 0x1a3c8a, roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
    const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 });

    // Head group (raised to make room for neck)
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.95;

    // Face
    const faceGeo = new THREE.SphereGeometry(0.35, 32, 32);
    const face = new THREE.Mesh(faceGeo, skinMat);
    face.scale.set(1, 1.15, 0.9);
    face.castShadow = true;
    headGroup.add(face);

    // Hair (rounded cap)
    const hairGeo = new THREE.SphereGeometry(0.37, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2.2);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.y = 0.05;
    headGroup.add(hair);

    // Eyes
    const eyeGeo = new THREE.SphereGeometry(0.06, 16, 16);
    const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    leftEye.position.set(-0.12, 0.05, 0.3);
    leftEye.scale.z = 0.4;
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    rightEye.position.set(0.12, 0.05, 0.3);
    rightEye.scale.z = 0.4;
    headGroup.add(rightEye);

    const pupilGeo = new THREE.SphereGeometry(0.025, 16, 16);
    const leftPupil = new THREE.Mesh(pupilGeo, blackMat);
    leftPupil.position.set(-0.12, 0.05, 0.32);
    headGroup.add(leftPupil);

    const rightPupil = new THREE.Mesh(pupilGeo, blackMat);
    rightPupil.position.set(0.12, 0.05, 0.32);
    headGroup.add(rightPupil);

    const blueMat = new THREE.MeshStandardMaterial({ color: 0x1a3c8a, roughness: 0.6 });

    // Glasses
    const glassFrameGeo = new THREE.TorusGeometry(0.07, 0.01, 8, 24);
    const leftGlass = new THREE.Mesh(glassFrameGeo, blackMat);
    leftGlass.position.set(-0.12, 0.05, 0.32);
    headGroup.add(leftGlass);

    const rightGlass = new THREE.Mesh(glassFrameGeo, blackMat);
    rightGlass.position.set(0.12, 0.05, 0.32);
    headGroup.add(rightGlass);

    const glassBridgeGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8);
    const bridge = new THREE.Mesh(glassBridgeGeo, blackMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.05, 0.32);
    headGroup.add(bridge);

    // Mouth
    const mouthGeo = new THREE.SphereGeometry(0.04, 16, 16);
    const mouth = new THREE.Mesh(mouthGeo, blackMat);
    mouth.position.set(0, -0.12, 0.31);
    mouth.scale.set(1.5, 0.4, 0.5);
    headGroup.add(mouth);
    this.mouth = mouth;
    this.mouthBaseScaleX = mouth.scale.x;
    this.mouthBaseScaleY = mouth.scale.y;
    this.mouthBaseScaleZ = mouth.scale.z;

    this.headGroup = headGroup;
    this.mesh.add(headGroup);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.15, 16);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.55;
    this.mesh.add(neck);

    // Body (shirt)
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.35, 0.7, 32);
    const body = new THREE.Mesh(bodyGeo, shirtMat);
    body.position.y = 1.15;
    body.castShadow = true;
    this.mesh.add(body);

    // Shoulder bar (horizontal cylinder across shoulders)
    const shoulderBarGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 16);
    const shoulderBar = new THREE.Mesh(shoulderBarGeo, shirtMat);
    shoulderBar.rotation.z = Math.PI / 2;
    shoulderBar.position.y = 1.4;
    this.mesh.add(shoulderBar);

    // Shorts
    const shortsGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.4, 32);
    const shorts = new THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.6;
    this.mesh.add(shorts);

    // Arms + Hands: shoulder and hand positions defined in world space
    const handGeo = new THREE.SphereGeometry(0.1, 16, 16);

    const addArm = (sx, sy, sz, hx, hy, hz, isRight) => {
      const group = new THREE.Group();
      group.position.set(sx, sy, sz);
      group.lookAt(hx, hy, hz);
      group.rotateX(-Math.PI / 2);

      const len = Math.sqrt((hx - sx) ** 2 + (hy - sy) ** 2 + (hz - sz) ** 2);
      const capLen = Math.max(0.01, len - 0.16); // subtract two hemispheres (radius 0.08)
      const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, capLen, 4, 16), skinMat);
      armMesh.position.y = -len / 2;
      group.add(armMesh);

      const handMesh = new THREE.Mesh(handGeo, skinMat);
      handMesh.position.y = -len;
      group.add(handMesh);

      this.mesh.add(group);
      if (isRight) {
        this.rightArm = group;
        this.rightArmBaseZ = group.rotation.z;
      } else {
        this.leftArm = group;
        this.leftArmBaseZ = group.rotation.z;
      }
    };

    // Arms hang down more steeply from shoulder bar ends
    addArm(-0.35, 1.4, 0, -0.55, 0.7, 0, false);
    addArm(0.35, 1.4, 0, 0.55, 0.7, 0, true);

    // Legs + Shoes (grouped for animation)
    const legGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.45, 16);
    const shoeGeo = new THREE.SphereGeometry(0.12, 16, 16);

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.15, 0.5, 0);
    const leftLegMesh = new THREE.Mesh(legGeo, skinMat);
    leftLegMesh.position.y = -0.225;
    leftLegGroup.add(leftLegMesh);
    const leftShoe = new THREE.Mesh(shoeGeo, blueMat);
    leftShoe.position.set(0, -0.45, 0.05);
    leftShoe.scale.set(1, 0.6, 1.5);
    leftLegGroup.add(leftShoe);
    this.mesh.add(leftLegGroup);
    this.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.15, 0.5, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, skinMat);
    rightLegMesh.position.y = -0.225;
    rightLegGroup.add(rightLegMesh);
    const rightShoe = new THREE.Mesh(shoeGeo, blueMat);
    rightShoe.position.set(0, -0.45, 0.05);
    rightShoe.scale.set(1, 0.6, 1.5);
    rightLegGroup.add(rightShoe);
    this.mesh.add(rightLegGroup);
    this.rightLeg = rightLegGroup;
  }
}
