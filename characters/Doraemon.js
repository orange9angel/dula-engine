import * as THREE from 'three';
import { CharacterBase } from './CharacterBase.js';

export class Doraemon extends CharacterBase {
  constructor() {
    super('Doraemon');
  }

  build() {
    // Materials
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
    const blueMat = new THREE.MeshToonMaterial({ color: 0x0096e1, gradientMap: toonGradient });
    const whiteMat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient });
    const redMat = new THREE.MeshToonMaterial({ color: 0xe60012, gradientMap: toonGradient });
    const yellowMat = new THREE.MeshToonMaterial({ color: 0xffd700, gradientMap: toonGradient });
    const blackMat = new THREE.MeshToonMaterial({ color: 0x111111, gradientMap: toonGradient });

    // Head group
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.6;

    // Main head (blue)
    const headGeo = new THREE.SphereGeometry(0.7, 32, 32);
    const head = new THREE.Mesh(headGeo, blueMat);
    head.castShadow = true;
    headGroup.add(head);

    // Eyes
    const eyeWhiteGeo = new THREE.SphereGeometry(0.18, 32, 32);
    const leftEye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    leftEye.position.set(-0.18, 0.35, 0.55);
    leftEye.scale.z = 0.5;
    headGroup.add(leftEye);

    const rightEye = new THREE.Mesh(eyeWhiteGeo, whiteMat);
    rightEye.position.set(0.18, 0.35, 0.55);
    rightEye.scale.z = 0.5;
    headGroup.add(rightEye);

    const pupilGeo = new THREE.SphereGeometry(0.04, 16, 16);
    const leftPupil = new THREE.Mesh(pupilGeo, blackMat);
    leftPupil.position.set(-0.18, 0.35, 0.64);
    leftPupil.userData.baseX = leftPupil.position.x;
    headGroup.add(leftPupil);
    this.leftPupil = leftPupil;

    const rightPupil = new THREE.Mesh(pupilGeo, blackMat);
    rightPupil.position.set(0.18, 0.35, 0.64);
    rightPupil.userData.baseX = rightPupil.position.x;
    headGroup.add(rightPupil);
    this.rightPupil = rightPupil;

    // Nose
    const noseGeo = new THREE.SphereGeometry(0.08, 32, 32);
    const nose = new THREE.Mesh(noseGeo, redMat);
    nose.position.set(0, 0.12, 0.68);
    headGroup.add(nose);

    // Mouth (black ellipse)
    const mouthGeo = new THREE.SphereGeometry(0.15, 32, 32);
    const mouth = new THREE.Mesh(mouthGeo, blackMat);
    mouth.position.set(0, -0.15, 0.6);
    mouth.scale.set(1.2, 0.3, 0.5);
    headGroup.add(mouth);
    this.mouth = mouth;
    this.mouthBaseScaleX = mouth.scale.x;
    this.mouthBaseScaleY = mouth.scale.y;
    this.mouthBaseScaleZ = mouth.scale.z;

    // Whiskers (classic Doraemon: 3 left, 3 right, horizontal fan radiating outward)
    const whiskerGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.28, 8);
    for (let side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const w = new THREE.Mesh(whiskerGeo, blackMat);
        const fanOffset = (1 - i) * 0.22; // +0.22 (bottom), 0 (mid), -0.22 (top)
        if (side === -1) {
          // Left face: pointing left (-x), fan up/down
          w.rotation.z = Math.PI / 2 + fanOffset;
        } else {
          // Right face: pointing right (+x), fan up/down
          w.rotation.z = -Math.PI / 2 - fanOffset;
        }
        w.position.set(side * 0.32, -0.06 + i * 0.06, 0.58);
        headGroup.add(w);
      }
    }

    this.headGroup = headGroup;
    this.mesh.add(headGroup);

    // Body (blue)
    const bodyGeo = new THREE.SphereGeometry(0.65, 32, 32);
    const body = new THREE.Mesh(bodyGeo, blueMat);
    body.position.y = 0.7;
    body.scale.y = 1.1;
    body.castShadow = true;
    this.mesh.add(body);

    // Belly (white) - the "face patch" moved down to stomach
    const bellyGeo = new THREE.SphereGeometry(0.55, 32, 32);
    const belly = new THREE.Mesh(bellyGeo, whiteMat);
    belly.position.set(0, 0.6, 0.35);
    belly.scale.set(1, 0.9, 0.6);
    this.mesh.add(belly);

    // Pocket
    const pocketGeo = new THREE.SphereGeometry(0.25, 32, 32);
    const pocket = new THREE.Mesh(pocketGeo, whiteMat);
    pocket.position.set(0, 0.55, 0.55);
    pocket.scale.y = 0.6;
    pocket.scale.z = 0.3;
    this.mesh.add(pocket);

    // Collar
    const collarGeo = new THREE.TorusGeometry(0.45, 0.06, 16, 32);
    const collar = new THREE.Mesh(collarGeo, redMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 1.1;
    this.mesh.add(collar);

    // Bell
    const bellGeo = new THREE.SphereGeometry(0.1, 32, 32);
    const bell = new THREE.Mesh(bellGeo, yellowMat);
    bell.position.set(0, 1.05, 0.4);
    this.mesh.add(bell);

    // Arms + Hands: shoulder and hand positions defined in world space, connected by capsule
    const handGeo = new THREE.SphereGeometry(0.15, 16, 16);

    const addArm = (sx, sy, sz, hx, hy, hz, isRight) => {
      const group = new THREE.Group();
      group.position.set(sx, sy, sz);
      group.lookAt(hx, hy, hz);
      group.rotateX(-Math.PI / 2); // make y-axis point toward hand

      const len = Math.sqrt((hx - sx) ** 2 + (hy - sy) ** 2 + (hz - sz) ** 2);
      const capLen = Math.max(0.01, len - 0.24); // subtract two hemispheres
      const armMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, capLen, 4, 16), blueMat);
      armMesh.position.y = -len / 2;
      group.add(armMesh);

      const handMesh = new THREE.Mesh(handGeo, whiteMat);
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

    // Left arm
    addArm(-0.42, 1.05, 0, -0.88, 0.72, 0, false);
    // Right arm
    addArm(0.42, 1.05, 0, 0.88, 0.72, 0, true);

    // Pocket racket (for RoomScene pull-out animation)
    if (this.rightArm && this.rightArmLength) {
      const racket = new THREE.Group();
      // Handle
      const handle = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.025, 0.4, 8),
        new THREE.MeshToonMaterial({ color: 0x111111, gradientMap: toonGradient })
      );
      handle.position.y = -0.2;
      racket.add(handle);
      // Frame
      const frame = new THREE.Mesh(
        new THREE.TorusGeometry(0.18, 0.02, 8, 16),
        new THREE.MeshToonMaterial({ color: 0xe60012, gradientMap: toonGradient })
      );
      frame.position.y = 0.18;
      racket.add(frame);
      // Strings
      const stringMat = new THREE.MeshBasicMaterial({ color: 0xeeeeee });
      const vStr = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.32, 0.005), stringMat);
      vStr.position.set(0, 0.18, 0);
      racket.add(vStr);
      const hStr = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.01, 0.005), stringMat);
      hStr.position.set(0, 0.18, 0);
      racket.add(hStr);
      // Orientation
      racket.rotation.set(Math.PI / 6, 0, Math.PI / 2);
      racket.position.set(0, -this.rightArmLength, 0);
      racket.visible = false;
      this.rightArm.add(racket);
      this.pocketRacket = racket;
    }

    // Legs + Feet (grouped for animation)
    const legGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.45, 16);
    const footGeo = new THREE.SphereGeometry(0.2, 32, 32);

    const leftLegGroup = new THREE.Group();
    leftLegGroup.position.set(-0.25, 0.55, 0);
    const leftLegMesh = new THREE.Mesh(legGeo, blueMat);
    leftLegMesh.position.y = -0.225;
    leftLegGroup.add(leftLegMesh);
    const leftFoot = new THREE.Mesh(footGeo, whiteMat);
    leftFoot.position.set(0, -0.45, 0.05);
    leftFoot.scale.set(1, 0.6, 1.4);
    leftLegGroup.add(leftFoot);
    this.mesh.add(leftLegGroup);
    this.leftLeg = leftLegGroup;

    const rightLegGroup = new THREE.Group();
    rightLegGroup.position.set(0.25, 0.55, 0);
    const rightLegMesh = new THREE.Mesh(legGeo, blueMat);
    rightLegMesh.position.y = -0.225;
    rightLegGroup.add(rightLegMesh);
    const rightFoot = new THREE.Mesh(footGeo, whiteMat);
    rightFoot.position.set(0, -0.45, 0.05);
    rightFoot.scale.set(1, 0.6, 1.4);
    rightLegGroup.add(rightFoot);
    this.mesh.add(rightLegGroup);
    this.rightLeg = rightLegGroup;
  }
}
