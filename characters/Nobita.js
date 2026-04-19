import * as THREE from 'three';
import { CharacterBase } from './CharacterBase.js';

export class Nobita extends CharacterBase {
  constructor() {
    super('Nobita');
  }

  build() {
    const toonGradient = (() => {
      const canvas = document.createElement('canvas');
      canvas.width = 4; canvas.height = 1;
      const ctx = canvas.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 4, 0);
      g.addColorStop(0, '#aaa'); g.addColorStop(0.4, '#ccc'); g.addColorStop(0.7, '#eee'); g.addColorStop(1, '#fff');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 1);
      const tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      return tex;
    })();

    const skinMat = new THREE.MeshToonMaterial({ color: 0xffdfc4, gradientMap: toonGradient });
    const shirtMat = new THREE.MeshToonMaterial({ color: 0xffd700, gradientMap: toonGradient });
    const shortsMat = new THREE.MeshToonMaterial({ color: 0x1a3c8a, gradientMap: toonGradient });
    const hairMat = new THREE.MeshToonMaterial({ color: 0x1a1a1a, gradientMap: toonGradient });
    const eyeWhiteMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient });
    const blackMat = new THREE.MeshToonMaterial({ color: 0x111111, gradientMap: toonGradient });
    const blueMat = new THREE.MeshToonMaterial({ color: 0x1a3c8a, gradientMap: toonGradient });
    const lipMat = new THREE.MeshToonMaterial({ color: 0xcc5555, gradientMap: toonGradient });

    // ========== HEAD GROUP ==========
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.95;

    // Face base: round face (original Nobita style)
    const faceGeo = new THREE.SphereGeometry(0.33, 32, 32);
    const face = new THREE.Mesh(faceGeo, skinMat);
    face.scale.set(1.0, 1.05, 0.95);
    face.position.y = 0.02;
    face.castShadow = true;
    headGroup.add(face);

    // ========== EARS ==========
    const earGeo = new THREE.SphereGeometry(0.05, 16, 16);
    const leftEar = new THREE.Mesh(earGeo, skinMat);
    leftEar.position.set(-0.35, 0.04, 0.04);
    leftEar.scale.set(0.45, 1.0, 0.55);
    headGroup.add(leftEar);

    const rightEar = new THREE.Mesh(earGeo, skinMat);
    rightEar.position.set(0.35, 0.04, 0.04);
    rightEar.scale.set(0.45, 1.0, 0.55);
    headGroup.add(rightEar);

    // ========== HAIR (watermelon / bowl cut style) ==========
    // Main bowl - classic watermelon/bowl cut covering the whole head
    const bowlGeo = new THREE.SphereGeometry(0.36, 32, 32, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const bowlHair = new THREE.Mesh(bowlGeo, hairMat);
    bowlHair.position.set(0, 0.10, -0.04);
    bowlHair.scale.set(1.03, 0.88, 0.92);
    headGroup.add(bowlHair);

    // ========== EYES ==========
    const eyeGeo = new THREE.SphereGeometry(0.055, 16, 16);

    const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    leftEye.position.set(-0.12, 0.04, 0.30);
    leftEye.scale.set(1.05, 1.1, 0.42);
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    rightEye.position.set(0.12, 0.04, 0.30);
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

    // ========== EYEBROWS (thin, barely visible under the bangs) ==========
    const browGeo = new THREE.CapsuleGeometry(0.003, 0.04, 4, 8);
    const leftBrow = new THREE.Mesh(browGeo, blackMat);
    leftBrow.position.set(-0.12, 0.17, 0.30);
    leftBrow.rotation.z = Math.PI / 2 + 0.05;
    headGroup.add(leftBrow);

    const rightBrow = new THREE.Mesh(browGeo, blackMat);
    rightBrow.position.set(0.12, 0.17, 0.30);
    rightBrow.rotation.z = Math.PI / 2 - 0.05;
    headGroup.add(rightBrow);

    // ========== GLASSES (big round frames, iconic Nobita style) ==========
    const frameRadius = 0.14; // smaller round glasses
    const tubeRadius = 0.004; // very thin frame
    const frameGeo = new THREE.TorusGeometry(frameRadius, tubeRadius, 8, 24);

    const leftFrame = new THREE.Mesh(frameGeo, blackMat);
    leftFrame.position.set(-0.14, 0.04, 0.345);
    headGroup.add(leftFrame);

    const rightFrame = new THREE.Mesh(frameGeo, blackMat);
    rightFrame.position.set(0.14, 0.04, 0.345);
    headGroup.add(rightFrame);

    const glassBridgeGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.12, 8);
    const bridge = new THREE.Mesh(glassBridgeGeo, blackMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.04, 0.34);
    headGroup.add(bridge);

    // Lenses (pure white, nearly opaque - classic anime glasses look)
    const lensGeo = new THREE.CircleGeometry(frameRadius - 0.005, 24);
    const lensMat = new THREE.MeshToonMaterial({
      color: 0xffffff,
      gradientMap: toonGradient,
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
    });
    const leftLens = new THREE.Mesh(lensGeo, lensMat);
    leftLens.position.set(-0.14, 0.04, 0.345);
    headGroup.add(leftLens);

    const rightLens = new THREE.Mesh(lensGeo, lensMat);
    rightLens.position.set(0.14, 0.04, 0.345);
    headGroup.add(rightLens);

    // ========== NOSE ==========
    const noseGeo = new THREE.SphereGeometry(0.016, 16, 16);
    // ========== NOSE (small tip well below the bridge, slightly behind to not overlap) ==========
    const nose = new THREE.Mesh(noseGeo, skinMat);
    nose.position.set(0, -0.14, 0.28);
    nose.scale.set(1, 0.8, 1.2);
    headGroup.add(nose);

    // ========== MOUTH ==========
    // Smile: black, longer,贴合 face surface
    const mouthCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.12, 0, 0),
      new THREE.Vector3(0, -0.015, 0),
      new THREE.Vector3(0.12, 0, 0)
    );
    const mouthGeo = new THREE.TubeGeometry(mouthCurve, 16, 0.006, 8, false);
    const mouth = new THREE.Mesh(mouthGeo, blackMat);
    mouth.position.set(0, -0.18, 0.26);
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

    // White collar ring
    const whiteMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient });
    const collarGeo = new THREE.TorusGeometry(0.17, 0.035, 8, 16);
    const collar = new THREE.Mesh(collarGeo, whiteMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.53;
    this.mesh.add(collar);

    // Collar flaps (big polo shirt style)
    const flapGeo = new THREE.BoxGeometry(0.14, 0.22, 0.03);
    const leftFlap = new THREE.Mesh(flapGeo, whiteMat);
    leftFlap.position.set(-0.12, 1.42, 0.20);
    leftFlap.rotation.z = 0.40;
    leftFlap.rotation.x = -0.30;
    this.mesh.add(leftFlap);

    const rightFlap = new THREE.Mesh(flapGeo, whiteMat);
    rightFlap.position.set(0.12, 1.42, 0.20);
    rightFlap.rotation.z = -0.40;
    rightFlap.rotation.x = -0.30;
    this.mesh.add(rightFlap);

    // Shirt button (small yellow dot at collar base)
    const buttonGeo = new THREE.SphereGeometry(0.018, 8, 8);
    const button = new THREE.Mesh(buttonGeo, shirtMat);
    button.position.set(0, 1.44, 0.17);
    button.scale.set(1, 1, 0.6);
    this.mesh.add(button);

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
