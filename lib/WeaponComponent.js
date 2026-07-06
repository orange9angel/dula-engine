import * as THREE from 'three';
import { Weapon } from './Weapon.js';

/**
 * WeaponComponent — 角色武器组件
 *
 * 状态机：
 *   none ──equip()──► equipping ──(drawTime)──► idle
 *   idle ──fire()──► firing ──(fireDuration)──► recoiling ──(recovery)──► idle
 *   idle ──holster()──► holstering ──(holsterTime)──► none
 *
 * 特性：
 * - 武器跟随手部（或背部/腰部）attachPoint
 * - 射击后坐力用弹簧-阻尼系统模拟
 * - 拔枪/收枪有过渡动画（scale + position lerp）
 * - 支持自动隐藏（hideAfter）
 */
export class WeaponComponent {
  constructor(character) {
    this.character = character;
    this.state = 'none';          // none | equipping | idle | firing | recoiling | holstering
    this.currentWeapon = null;    // Weapon 实例
    this.weaponMesh = null;       // 当前附加到角色的 mesh
    this.attachPoint = null;      // 挂载点对象（如 rightWrist）
    this.attachPointName = 'rightHand';

    // 过渡动画
    this.transitionProgress = 0;  // 0~1
    this.transitionTimer = 0;     // 当前过渡已用时间
    this.transitionDuration = 0;  // 目标过渡时间

    // 后坐力
    this.recoilOffset = new THREE.Vector3();
    this.recoilVelocity = new THREE.Vector3();
    this.isRecoiling = false;

    // 自动隐藏计时
    this.autoHideTimer = null;
    this.autoHideDelay = 0;

    // 枪口闪光
    this.muzzleFlash = null;
    this.muzzleFlashTimer = 0;

    // 挂载点映射
    this._attachMap = {
      rightHand: () => character.rightWrist,
      leftHand: () => character.leftWrist,
      rightShoulder: () => character.rightArm,
      leftShoulder: () => character.leftArm,
      back: () => character.mesh,
      hip: () => character.mesh,
    };
  }

  /**
   * 装备武器
   * @param {Weapon|string} weapon — Weapon 实例或武器类型名
   * @param {string} attachPoint — 挂载点
   */
  equip(weapon, attachPoint) {
    if (this.state === 'equipping' || this.state === 'idle') {
      this.holster();
    }

    this.currentWeapon = weapon instanceof Weapon ? weapon : null;
    this.attachPointName = attachPoint || weapon?.defaultAttach || 'rightHand';
    this.attachPoint = this._resolveAttachPoint(this.attachPointName);

    if (this.currentWeapon?.mesh) {
      this.weaponMesh = this.currentWeapon.cloneMesh();
      if (this.weaponMesh) {
        // 初始状态：缩小并放在挂载点附近
        this.weaponMesh.scale.set(0.01, 0.01, 0.01);
        this.weaponMesh.visible = true;
        if (this.attachPoint) {
          this.attachPoint.add(this.weaponMesh);
        }
      }
    }

    this.state = 'equipping';
    this.transitionProgress = 0;
    this.transitionTimer = 0;
    this.transitionDuration = this.currentWeapon?.drawTime || 0.35;
    this.recoilOffset.set(0, 0, 0);
    this.recoilVelocity.set(0, 0, 0);
    this.isRecoiling = false;
    this.autoHideTimer = null;
  }

  /**
   * 开始射击
   */
  fire() {
    if (this.state !== 'idle' && this.state !== 'equipping') return;

    this.state = 'firing';
    this.transitionTimer = 0;
    this.transitionDuration = this.currentWeapon?.fireDuration || 0.08;
    this.isRecoiling = true;

    // 后坐力脉冲
    const recoil = this.currentWeapon?.recoil || {};
    this.recoilVelocity.z -= recoil.kickBack || 0.08;
    this.recoilVelocity.y += recoil.muzzleClimb || 0.04;
    this.recoilVelocity.x += (Math.random() - 0.5) * 2 * (recoil.spread || 0.02);

    // 枪口闪光
    this._triggerMuzzleFlash();
  }

  /**
   * 收枪/隐藏武器
   */
  holster() {
    if (this.state === 'none' || this.state === 'holstering') return;
    this.state = 'holstering';
    this.transitionProgress = 1;
    this.transitionTimer = 0;
    this.transitionDuration = this.currentWeapon?.holsterTime || 0.25;
    this.autoHideTimer = null;
  }

  /**
   * 设置自动隐藏（hideAfter 秒后自动收枪）
   */
  setAutoHide(delay) {
    if (delay > 0) {
      this.autoHideDelay = delay;
      this.autoHideTimer = 0;
    } else {
      this.autoHideTimer = null;
    }
  }

  /**
   * 立即强制隐藏（不播放过渡动画）
   */
  forceHide() {
    if (this.weaponMesh) {
      if (this.weaponMesh.parent) this.weaponMesh.parent.remove(this.weaponMesh);
      this.weaponMesh = null;
    }
    this.currentWeapon = null;
    this.state = 'none';
    this.transitionProgress = 0;
    this.recoilOffset.set(0, 0, 0);
    this.recoilVelocity.set(0, 0, 0);
    this.isRecoiling = false;
    this.autoHideTimer = null;
  }

  /**
   * 获取枪口世界坐标
   */
  getMuzzleWorldPosition() {
    return this.currentWeapon?.getMuzzleWorldPosition(this.weaponMesh) || new THREE.Vector3();
  }

  /**
   * 获取弹壳抛出口世界坐标
   */
  getEjectWorldPosition() {
    return this.currentWeapon?.getEjectWorldPosition(this.weaponMesh) || new THREE.Vector3();
  }

  update(delta) {
    if (this.state === 'none') return;

    // ── 自动隐藏计时 ──
    if (this.autoHideTimer !== null && this.state === 'idle') {
      this.autoHideTimer += delta;
      if (this.autoHideTimer >= this.autoHideDelay) {
        this.holster();
        this.autoHideTimer = null;
      }
    }

    // ── 状态机更新 ──
    switch (this.state) {
      case 'equipping': {
        this.transitionTimer += delta;
        this.transitionProgress = Math.min(1, this.transitionTimer / this.transitionDuration);
        const ease = this._easeOutBack(this.transitionProgress);
        if (this.weaponMesh) {
          this.weaponMesh.scale.setScalar(ease);
          // 从 attachPoint 附近滑入
          this.weaponMesh.position.set(0, 0, 0);
          this.weaponMesh.rotation.set(0, 0, 0);
        }
        if (this.transitionProgress >= 1) {
          this.state = 'idle';
        }
        break;
      }

      case 'firing': {
        this.transitionTimer += delta;
        this.transitionProgress = Math.min(1, this.transitionTimer / this.transitionDuration);
        if (this.transitionProgress >= 1) {
          this.state = 'recoiling';
        }
        break;
      }

      case 'recoiling': {
        // 后坐力恢复
        const recoil = this.currentWeapon?.recoil || {};
        const speed = recoil.recoverySpeed || 12;
        const decay = recoil.decay || 0.85;

        // 弹簧阻尼：速度向零衰减，位置向零恢复
        this.recoilVelocity.multiplyScalar(decay);
        this.recoilVelocity.addScaledVector(this.recoilOffset, -speed * delta);
        this.recoilOffset.addScaledVector(this.recoilVelocity, delta);

        // 当后坐力足够小，回到 idle
        if (this.recoilOffset.lengthSq() < 1e-6 && this.recoilVelocity.lengthSq() < 1e-6) {
          this.recoilOffset.set(0, 0, 0);
          this.recoilVelocity.set(0, 0, 0);
          this.state = 'idle';
          this.isRecoiling = false;
        }
        break;
      }

      case 'holstering': {
        this.transitionTimer += delta;
        const t = Math.min(1, this.transitionTimer / this.transitionDuration);
        this.transitionProgress = 1 - t;
        const ease = this._easeInBack(t);
        if (this.weaponMesh) {
          this.weaponMesh.scale.setScalar(Math.max(0.01, 1 - ease));
        }
        if (t >= 1) {
          this.forceHide();
        }
        break;
      }
    }

    // ── 应用后坐力偏移到武器 mesh ──
    if (this.weaponMesh && this.isRecoiling) {
      this.weaponMesh.position.copy(this.recoilOffset);
    } else if (this.weaponMesh && this.state === 'idle') {
      // 确保武器位置归零
      this.weaponMesh.position.set(0, 0, 0);
    }

    // ── 枪口闪光衰减 ──
    if (this.muzzleFlash) {
      this.muzzleFlashTimer -= delta;
      if (this.muzzleFlashTimer <= 0) {
        this._hideMuzzleFlash();
      } else {
        const intensity = this.muzzleFlashTimer / 0.08;
        if (this.muzzleFlash.intensity !== undefined) {
          this.muzzleFlash.intensity = intensity * 2;
        }
        if (this.muzzleFlash.material) {
          this.muzzleFlash.material.opacity = intensity;
        }
      }
    }
  }

  _resolveAttachPoint(name) {
    const resolver = this._attachMap[name];
    return resolver ? resolver() : null;
  }

  _triggerMuzzleFlash() {
    if (!this.weaponMesh || !this.currentWeapon?.fireEffects?.light) return;

    const lightConfig = this.currentWeapon.fireEffects.light;
    if (!this.muzzleFlash) {
      const light = new THREE.PointLight(
        lightConfig.color || 0xffaa33,
        lightConfig.intensity || 2,
        lightConfig.distance || 3,
        lightConfig.decay || 2
      );
      light.position.copy(this.currentWeapon.muzzleOffset);
      this.weaponMesh.add(light);
      this.muzzleFlash = light;
    }
    this.muzzleFlashTimer = lightConfig.duration || 0.08;
    this.muzzleFlash.intensity = lightConfig.intensity || 2;
    this.muzzleFlash.visible = true;
  }

  _hideMuzzleFlash() {
    if (this.muzzleFlash) {
      this.muzzleFlash.visible = false;
      this.muzzleFlash.intensity = 0;
    }
    this.muzzleFlashTimer = 0;
  }

  _easeOutBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  _easeInBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  }
}
