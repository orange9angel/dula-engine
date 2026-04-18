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
    const blueMat = new THREE.MeshStandardMaterial({ color: 0x1a3c8a, roughness: 0.6 });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0xcc5555, roughness: 0.5 });

    // ========== HEAD GROUP ==========
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.95;

    // Face base (round, slightly wider)
    const faceGeo = new THREE.SphereGeometry(0.35, 32, 32);
    const face = new THREE.Mesh(faceGeo, skinMat);
    face.scale.set(1.08, 1.12, 0.95);
    face.castShadow = true;
    headGroup.add(face);

    // Chin ellipsoid - rounder than Shizuka
    const chinGeo = new THREE.SphereGeometry(0.2, 24, 24);
    const chin = new THREE.Mesh(chinGeo, skinMat);
    chin.position.set(0, -0.22, 0.12);
    chin.scale.set(1.15, 0.75, 0.95);
    headGroup.add(chin);

    // ========== HAIR ==========
    // Top hair (rounded dome for bowl-cut look) - keep it high, don't cover forehead
    const topHairGeo = new THREE.SphereGeometry(0.37, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2.2);
    const topHair = new THREE.Mesh(topHairGeo, hairMat);
    topHair.position.set(0, 0.14, 0.02);
    topHair.scale.set(1.08, 0.75, 1.05);
    headGroup.add(topHair);

    // Back hair volume
    const backHairGeo = new THREE.SphereGeometry(0.36, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const backHair = new THREE.Mesh(backHairGeo, hairMat);
    backHair.position.set(0, 0.02, -0.1);
    backHair.rotation.x = Math.PI * 0.88;
    headGroup.add(backHair);

    // Sideburns (temple coverage)
    const sideburnGeo = new THREE.SphereGeometry(0.09, 16, 16);
    const leftSideburn = new THREE.Mesh(sideburnGeo, hairMat);
    leftSideburn.position.set(-0.32, -0.04, 0.08);
    leftSideburn.scale.set(0.55, 1.3, 0.75);
    headGroup.add(leftSideburn);

    const rightSideburn = new THREE.Mesh(sideburnGeo, hairMat);
    rightSideburn.position.set(0.32, -0.04, 0.08);
    rightSideburn.scale.set(0.55, 1.3, 0.75);
    headGroup.add(rightSideburn);

    // Bangs (very short fringe high on forehead)
    const bangGeo = new THREE.BoxGeometry(0.08, 0.05, 0.015);
    for (let i = -2; i <= 2; i++) {
      const bang = new THREE.Mesh(bangGeo, hairMat);
      bang.position.set(i * 0.075, 0.26, 0.32);
      bang.rotation.x = -0.1;
      bang.rotation.z = i * 0.03;
      headGroup.add(bang);
    }

    // ========== EYES ==========
    const eyeGeo = new THREE.SphereGeometry(0.055, 16, 16);

    const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    leftEye.position.set(-0.12, 0.04, 0.3);
    leftEye.scale.set(1.05, 1.1, 0.42);
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    rightEye.position.set(0.12, 0.04, 0.3);
    rightEye.scale.set(1.05, 1.1, 0.42);
    headGroup.add(rightEye);

    const pupilGeo = new THREE.SphereGeometry(0.028, 16, 16);
    const leftPupil = new THREE.Mesh(pupilGeo, blackMat);
    leftPupil.position.set(-0.12, 0.03, 0.32);
    leftPupil.userData.baseX = leftPupil.position.x;
    headGroup.add(leftPupil);
    this.leftPupil = leftPupil;

    const rightPupil = new THREE.Mesh(pupilGeo, blackMat);
    rightPupil.position.set(0.12, 0.03, 0.32);
    rightPupil.userData.baseX = rightPupil.position.x;
    headGroup.add(rightPupil);
    this.rightPupil = rightPupil;

    // Highlights
    const hlGeo = new THREE.SphereGeometry(0.009, 8, 8);
    const leftHl = new THREE.Mesh(hlGeo, eyeWhiteMat);
    leftHl.position.set(-0.11, 0.055, 0.335);
    headGroup.add(leftHl);

    const rightHl = new THREE.Mesh(hlGeo, eyeWhiteMat);
    rightHl.position.set(0.13, 0.055, 0.335);
    headGroup.add(rightHl);

    // ========== EYEBROWS ==========
    const browGeo = new THREE.CapsuleGeometry(0.004, 0.06, 4, 8);
    const leftBrow = new THREE.Mesh(browGeo, blackMat);
    leftBrow.position.set(-0.12, 0.15, 0.3);
    leftBrow.rotation.z = 0.12;
    headGroup.add(leftBrow);

    const rightBrow = new THREE.Mesh(browGeo, blackMat);
    rightBrow.position.set(0.12, 0.15, 0.3);
    rightBrow.rotation.z = -0.12;
    headGroup.add(rightBrow);

    // ========== GLASSES (frames + lenses) ==========
    const glassFrameGeo = new THREE.TorusGeometry(0.07, 0.012, 8, 24);
    const leftGlass = new THREE.Mesh(glassFrameGeo, blackMat);
    leftGlass.position.set(-0.12, 0.04, 0.33);
    headGroup.add(leftGlass);

    const rightGlass = new THREE.Mesh(glassFrameGeo, blackMat);
    rightGlass.position.set(0.12, 0.04, 0.33);
    headGroup.add(rightGlass);

    const glassBridgeGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.08, 8);
    const bridge = new THREE.Mesh(glassBridgeGeo, blackMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.04, 0.33);
    headGroup.add(bridge);

    // Lenses (translucent white circles)
    const lensGeo = new THREE.CircleGeometry(0.065, 24);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.1,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
    });
    const leftLens = new THREE.Mesh(lensGeo, lensMat);
    leftLens.position.set(-0.12, 0.04, 0.34);
    headGroup.add(leftLens);

    const rightLens = new THREE.Mesh(lensGeo, lensMat);
    rightLens.position.set(0.12, 0.04, 0.34);
    headGroup.add(rightLens);

    // ========== MOUTH ==========
    const mouthGeo = new THREE.SphereGeometry(0.022, 16, 16);
    const mouth = new THREE.Mesh(mouthGeo, lipMat);
    mouth.position.set(0, -0.14, 0.32);
    mouth.scale.set(1.8, 0.6, 0.6);
    headGroup.add(mouth);
    this.mouth = mouth;
    this.mouthBaseScaleX = mouth.scale.x;
    this.mouthBaseScaleY = mouth.scale.y;
    this.mouthBaseScaleZ = mouth.scale.z;

    this.headGroup = headGroup;
    this.mesh.add(headGroup);

    // ========== NECK ==========
    const neckGeo = new THREE.CylinderGeometry(0.055, 0.06, 0.14, 16);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.56;
    this.mesh.add(neck);

    // ========== BODY (shirt with slight belly) ==========
    const bodyGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.72, 32);
    const body = new THREE.Mesh(bodyGeo, shirtMat);
    body.position.y = 1.16;
    body.castShadow = true;
    this.mesh.add(body);

    // Collar
    const collarGeo = new THREE.TorusGeometry(0.15, 0.02, 8, 16);
    const collar = new THREE.Mesh(collarGeo, shirtMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.53;
    this.mesh.add(collar);

    // Puff sleeves
    const sleeveGeo = new THREE.SphereGeometry(0.095, 16, 16);
    const leftSleeve = new THREE.Mesh(sleeveGeo, shirtMat);
    leftSleeve.position.set(-0.34, 1.42, 0);
    leftSleeve.scale.set(1, 0.85, 1);
    this.mesh.add(leftSleeve);

    const rightSleeve = new THREE.Mesh(sleeveGeo, shirtMat);
    rightSleeve.position.set(0.34, 1.42, 0);
    rightSleeve.scale.set(1, 0.85, 1);
    this.mesh.add(rightSleeve);

    // ========== SHORTS ==========
    const shortsGeo = new THREE.CylinderGeometry(0.35, 0.36, 0.4, 32);
    const shorts = new THREE.Mesh(shortsGeo, shortsMat);
    shorts.position.y = 0.6;
    this.mesh.add(shorts);

    // Shorts hem (pant cuffs)
    const hemGeo = new THREE.TorusGeometry(0.18, 0.012, 8, 16);
    const leftHem = new THREE.Mesh(hemGeo, shortsMat);
    leftHem.rotation.x = Math.PI / 2;
    leftHem.position.set(-0.14, 0.42, 0);
    this.mesh.add(leftHem);

    const rightHem = new THREE.Mesh(hemGeo, shortsMat);
    rightHem.rotation.x = Math.PI / 2;
    rightHem.position.set(0.14, 0.42, 0);
    this.mesh.add(rightHem);

    // ========== ARMS + HANDS ==========
    const handGeo = new THREE.SphereGeometry(0.09, 16, 16);

    const addArm = (sx, sy, sz, hx, hy, hz, isRight) => {
      const group = new THREE.Group();
      group.position.set(sx, sy, sz);
      group.lookAt(hx, hy, hz);
      group.rotateX(-Math.PI / 2);

      const len = Math.sqrt((hx - sx) ** 2 + (hy - sy) ** 2 + (hz - sz) ** 2);
      const capLen = Math.max(0.01, len - 0.16);
      const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, capLen, 4, 16), skinMat);
      armMesh.position.y = -len / 2;
      group.add(armMesh);

      const handMesh = new THREE.Mesh(handGeo, skinMat);
      handMesh.position.y = -len;
      group.add(handMesh);

      this.mesh.add(group);
      if (isRight) {
        this.rightArm = group;
        this.rightArmLength = len;
        this.rightArmBaseZ = group.rotation.z;
      } else {
        this.leftArm = group;
        this.leftArmBaseZ = group.rotation.z;
      }
    };

    // Arms from sleeve edges
    addArm(-0.36, 1.38, 0, -0.52, 0.7, 0, false);
    addArm(0.36, 1.38, 0, 0.52, 0.7, 0, true);

    // ========== LEGS + SHOES ==========
    const legGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.42, 16);
    const shoeGeo = new THREE.SphereGeometry(0.115, 16, 16);

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.15, 0.5, 0);
    const leftLegMesh = new THREE.Mesh(legGeo, skinMat);
    leftLegMesh.position.y = -0.21;
    leftLegGroup.add(leftLegMesh);
    const leftShoe = new THREE.Mesh(shoeGeo, blueMat);
    leftShoe.position.set(0, -0.42, 0.05);
    leftShoe.scale.set(1, 0.6, 1.5);
    leftLegGroup.add(leftShoe);
    this.mesh.add(leftLegGroup);
    this.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.15, 0.5, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, skinMat);
    rightLegMesh.position.y = -0.21;
    rightLegGroup.add(rightLegMesh);
    const rightShoe = new THREE.Mesh(shoeGeo, blueMat);
    rightShoe.position.set(0, -0.42, 0.05);
    rightShoe.scale.set(1, 0.6, 1.5);
    rightLegGroup.add(rightShoe);
    this.mesh.add(rightLegGroup);
    this.rightLeg = rightLegGroup;
  }
}
