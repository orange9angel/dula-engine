import * as THREE from 'three';
import { CharacterBase } from './CharacterBase.js';

export class Shizuka extends CharacterBase {
  constructor() {
    super('Shizuka');
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
    const dressMat = new THREE.MeshToonMaterial({ color: 0xff8da1, gradientMap: toonGradient });
    const hairMat = new THREE.MeshToonMaterial({ color: 0x1a1a1a, gradientMap: toonGradient });
    const whiteMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient });
    const eyeWhiteMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient });
    const blackMat = new THREE.MeshToonMaterial({ color: 0x111111, gradientMap: toonGradient });
    const shoeMat = new THREE.MeshToonMaterial({ color: 0xff4444, gradientMap: toonGradient });
    const lipMat = new THREE.MeshToonMaterial({ color: 0xff6b8a, gradientMap: toonGradient });
    const blushMat = new THREE.MeshToonMaterial({ color: 0xffaaaa, gradientMap: toonGradient, transparent: true, opacity: 0.45 });

    // ========== HEAD GROUP ==========
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.78;

    // Face base (slightly wider than tall for anime look)
    const faceGeo = new THREE.SphereGeometry(0.32, 32, 32);
    const face = new THREE.Mesh(faceGeo, skinMat);
    face.scale.set(1.05, 1.12, 0.95);
    face.castShadow = true;
    headGroup.add(face);

    // Chin椭球 - softens the bottom, makes it egg-shaped
    const chinGeo = new THREE.SphereGeometry(0.18, 24, 24);
    const chin = new THREE.Mesh(chinGeo, skinMat);
    chin.position.set(0, -0.2, 0.12);
    chin.scale.set(1.1, 0.7, 0.9);
    headGroup.add(chin);

    // Hair cap (covers top and back more generously)
    const hairGeo = new THREE.SphereGeometry(0.35, 32, 32, 0, Math.PI * 2, 0, Math.PI / 1.7);
    const hair = new THREE.Mesh(hairGeo, hairMat);
    hair.position.set(0, 0.04, -0.05);
    headGroup.add(hair);

    // Extra back-hair volume (a slightly larger partial sphere behind)
    const backHairGeo = new THREE.SphereGeometry(0.33, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
    const backHair = new THREE.Mesh(backHairGeo, hairMat);
    backHair.position.set(0, 0.02, -0.1);
    backHair.rotation.x = Math.PI * 0.85;
    headGroup.add(backHair);

    // Bangs (5 thin black plates fanning across forehead)
    const bangGeo = new THREE.BoxGeometry(0.07, 0.16, 0.015);
    for (let i = -2; i <= 2; i++) {
      const bang = new THREE.Mesh(bangGeo, hairMat);
      bang.position.set(i * 0.065, 0.2, 0.3);
      bang.rotation.x = -0.3;
      bang.rotation.z = i * 0.12;
      headGroup.add(bang);
    }

    // ========== EYES ==========
    const eyeGeo = new THREE.SphereGeometry(0.06, 16, 16);

    // Left eye white
    const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    leftEye.position.set(-0.11, 0.04, 0.28);
    leftEye.scale.set(1, 1.15, 0.45);
    headGroup.add(leftEye);

    // Right eye white
    const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
    rightEye.position.set(0.11, 0.04, 0.28);
    rightEye.scale.set(1, 1.15, 0.45);
    headGroup.add(rightEye);

    // Pupils (larger for cute look)
    const pupilGeo = new THREE.SphereGeometry(0.032, 16, 16);
    const leftPupil = new THREE.Mesh(pupilGeo, blackMat);
    leftPupil.position.set(-0.11, 0.03, 0.31);
    leftPupil.userData.baseX = leftPupil.position.x;
    headGroup.add(leftPupil);
    this.leftPupil = leftPupil;

    const rightPupil = new THREE.Mesh(pupilGeo, blackMat);
    rightPupil.position.set(0.11, 0.03, 0.31);
    rightPupil.userData.baseX = rightPupil.position.x;
    headGroup.add(rightPupil);
    this.rightPupil = rightPupil;

    // Highlights (small white dots for liveliness)
    const hlGeo = new THREE.SphereGeometry(0.009, 8, 8);
    const leftHl = new THREE.Mesh(hlGeo, whiteMat);
    leftHl.position.set(-0.1, 0.06, 0.33);
    headGroup.add(leftHl);

    const rightHl = new THREE.Mesh(hlGeo, whiteMat);
    rightHl.position.set(0.12, 0.06, 0.33);
    headGroup.add(rightHl);

    // Eyelashes (thin black cylinders above eyes)
    const lashGeo = new THREE.CylinderGeometry(0.002, 0.002, 0.05, 4);
    const leftLash = new THREE.Mesh(lashGeo, blackMat);
    leftLash.position.set(-0.11, 0.12, 0.29);
    leftLash.rotation.z = 0.25;
    leftLash.rotation.x = -0.2;
    headGroup.add(leftLash);

    const rightLash = new THREE.Mesh(lashGeo, blackMat);
    rightLash.position.set(0.11, 0.12, 0.29);
    rightLash.rotation.z = -0.25;
    rightLash.rotation.x = -0.2;
    headGroup.add(rightLash);

    // ========== EYEBROWS ==========
    const browGeo = new THREE.CapsuleGeometry(0.0035, 0.055, 4, 8);
    const leftBrow = new THREE.Mesh(browGeo, blackMat);
    leftBrow.position.set(-0.11, 0.16, 0.29);
    leftBrow.rotation.z = 0.2;
    headGroup.add(leftBrow);

    const rightBrow = new THREE.Mesh(browGeo, blackMat);
    rightBrow.position.set(0.11, 0.16, 0.29);
    rightBrow.rotation.z = -0.2;
    headGroup.add(rightBrow);

    // ========== MOUTH (smile curve) ==========
    const smileCurve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.028, -0.1, 0.3),
      new THREE.Vector3(0, -0.118, 0.3),
      new THREE.Vector3(0.028, -0.1, 0.3)
    );
    const smileGeo = new THREE.TubeGeometry(smileCurve, 12, 0.0045, 8, false);
    const smile = new THREE.Mesh(smileGeo, lipMat);
    headGroup.add(smile);
    this.mouth = smile;
    // Store base scale for speaking animation ( TubeGeometry doesn't scale well, so we use a proxy sphere )
    const mouthProxy = new THREE.Mesh(new THREE.SphereGeometry(0.035), lipMat);
    mouthProxy.visible = false;
    headGroup.add(mouthProxy);
    this.mouthBaseScaleX = 1;
    this.mouthBaseScaleY = 1;
    this.mouthBaseScaleZ = 1;

    // ========== BLUSH (cheeks) ==========
    const blushGeo = new THREE.SphereGeometry(0.032, 16, 16);
    const leftBlush = new THREE.Mesh(blushGeo, blushMat);
    leftBlush.position.set(-0.2, -0.03, 0.24);
    leftBlush.scale.set(1, 0.55, 0.4);
    headGroup.add(leftBlush);

    const rightBlush = new THREE.Mesh(blushGeo, blushMat);
    rightBlush.position.set(0.2, -0.03, 0.24);
    rightBlush.scale.set(1, 0.55, 0.4);
    headGroup.add(rightBlush);

    // ========== JOINTED PIGTAILS ==========
    const createBraid = (side) => {
      const group = new THREE.Group();
      const segments = 4;
      for (let i = 0; i < segments; i++) {
        const r = 0.05 - i * 0.006;
        const ballGeo = new THREE.SphereGeometry(r, 16, 16);
        const ball = new THREE.Mesh(ballGeo, hairMat);
        ball.position.y = -i * 0.11;
        group.add(ball);

        if (i < segments - 1) {
          const linkGeo = new THREE.CylinderGeometry(r * 0.75, (0.05 - (i + 1) * 0.006) * 0.75, 0.07, 12);
          const link = new THREE.Mesh(linkGeo, hairMat);
          link.position.y = -i * 0.11 - 0.055;
          group.add(link);
        }
      }
      group.position.set(side * 0.3, -0.08, -0.12);
      group.rotation.z = side * 0.35;
      group.rotation.x = 0.12;
      headGroup.add(group);
    };
    createBraid(-1);
    createBraid(1);

    this.headGroup = headGroup;
    this.mesh.add(headGroup);

    // ========== NECK ==========
    const neckGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.12, 16);
    const neck = new THREE.Mesh(neckGeo, skinMat);
    neck.position.y = 1.58;
    this.mesh.add(neck);

    // ========== DRESS (lathe for waist-cinched silhouette) ==========
    const dressPoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.38, 0),
      new THREE.Vector2(0.36, 0.06),
      new THREE.Vector2(0.33, 0.18),
      new THREE.Vector2(0.28, 0.3),
      new THREE.Vector2(0.19, 0.46),   // waist (narrowest)
      new THREE.Vector2(0.2, 0.56),
      new THREE.Vector2(0.22, 0.66),
      new THREE.Vector2(0.23, 0.74),
      new THREE.Vector2(0, 0.74),
    ];
    const dressGeo = new THREE.LatheGeometry(dressPoints, 32);
    const dress = new THREE.Mesh(dressGeo, dressMat);
    dress.position.y = 0.68;
    dress.castShadow = true;
    this.mesh.add(dress);

    // White collar
    const collarGeo = new THREE.TorusGeometry(0.15, 0.022, 8, 16);
    const collar = new THREE.Mesh(collarGeo, whiteMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.43;
    this.mesh.add(collar);

    // Puff sleeves
    const sleeveGeo = new THREE.SphereGeometry(0.075, 16, 16);
    const leftSleeve = new THREE.Mesh(sleeveGeo, dressMat);
    leftSleeve.position.set(-0.24, 1.4, 0);
    leftSleeve.scale.set(1, 0.85, 1);
    this.mesh.add(leftSleeve);

    const rightSleeve = new THREE.Mesh(sleeveGeo, dressMat);
    rightSleeve.position.set(0.24, 1.4, 0);
    rightSleeve.scale.set(1, 0.85, 1);
    this.mesh.add(rightSleeve);

    // ========== ARMS + HANDS ==========
    const handGeo = new THREE.SphereGeometry(0.065, 16, 16);

    const addArm = (sx, sy, sz, hx, hy, hz, isRight) => {
      const group = new THREE.Group();
      group.position.set(sx, sy, sz);
      group.lookAt(hx, hy, hz);
      group.rotateX(-Math.PI / 2);

      const len = Math.sqrt((hx - sx) ** 2 + (hy - sy) ** 2 + (hz - sz) ** 2);
      const capLen = Math.max(0.01, len - 0.13);
      const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, capLen, 4, 16), skinMat);
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
    addArm(-0.3, 1.35, 0, -0.38, 0.82, 0, false);
    addArm(0.3, 1.35, 0, 0.38, 0.82, 0, true);

    // ========== LEGS + SHOES ==========
    const legGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.38, 16);
    const shoeGeo = new THREE.SphereGeometry(0.095, 16, 16);

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.12, 0.58, 0);
    const leftLegMesh = new THREE.Mesh(legGeo, skinMat);
    leftLegMesh.position.y = -0.19;
    leftLegGroup.add(leftLegMesh);
    const leftShoe = new THREE.Mesh(shoeGeo, shoeMat);
    leftShoe.position.set(0, -0.38, 0.04);
    leftShoe.scale.set(1, 0.6, 1.5);
    leftLegGroup.add(leftShoe);
    this.mesh.add(leftLegGroup);
    this.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.12, 0.58, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, skinMat);
    rightLegMesh.position.y = -0.19;
    rightLegGroup.add(rightLegMesh);
    const rightShoe = new THREE.Mesh(shoeGeo, shoeMat);
    rightShoe.position.set(0, -0.38, 0.04);
    rightShoe.scale.set(1, 0.6, 1.5);
    rightLegGroup.add(rightShoe);
    this.mesh.add(rightLegGroup);
    this.rightLeg = rightLegGroup;
  }
}
