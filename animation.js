import { createVRMAnimationClip } from '@pixiv/three-vrm-animation';
import * as THREE from 'three';

export class AnimationHandler {
  constructor(that) {
    this.loader = that.loader;
    this.vrm = that.vrm;
    this.scene = that.scene;
    this.camera = that.camera;
    this.renderer = that.renderer;
    this.mixer = that.mixer;
    this.clips = that.clips;
    this.currentAnimation = that.currentAnimation;
    this.animationloop = true;
    this.looptimer = 0;
    this.blinkInterval = null;
  }

  playAnimation(animationID) {
    if (this.mixer && this.clips[animationID]) {
      // 全停止
      this.clips.forEach((a,i) => { if(i!==animationID)a.stop(); });
      this.clips[animationID].reset();
      this.clips[animationID].play();
    }
  }

  pauseAnimation(animationID) {
    if (this.mixer && this.clips[animationID]) {
      this.clips[animationID].paused = true;
    }
  }

  resumeAnimation(animationID) {
    if (this.mixer && this.clips[animationID]) {
      this.clips[animationID].paused = false;
    }
  }

  stopAnimation(animationID) {
    if (this.mixer && this.clips[animationID]) {
      this.clips[animationID].stop();
    }
  }

/*   lipSync(mode) {
    if (!this.vrm.expressionManager) {
      console.warn("ExpressionManager not found");
      return { errorCode: 302, message: "error:ExpressionManager not found" };
    }
    const syllables = ["aa", "ih", "ou", "ee", "oh"];
    if (mode === 1) {
      if (this.lipSyncInterval) {
        console.warn("Lip sync is already running");
        return { errorCode: 300, message: "error:Lip sync is already running" };
      }
      this.lipSyncInterval = setInterval(() => {
        const random = syllables[Math.floor(Math.random() * syllables.length)];
        for (const s of syllables) {
          this.vrm.expressionManager.setValue(s, s === random ? 0.8 : 0.0);
        }
      }, 200);
      return 0;
    } else if (mode === -1) {
      if (!this.lipSyncInterval) {
        console.warn("Lip sync is already stopped");
        return { errorCode: 301, message: "error:Lip sync is already stopped" };
      }
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
      for (const s of syllables) {
        this.vrm.expressionManager.setValue(s, 0.0);
      }
      return 0;
    }
  } */

  lipSync(mode) {
    if (!this.vrm.expressionManager) {
      console.warn("ExpressionManager not found");
      return { errorCode: 302, message: "error:ExpressionManager not found" };
    }

    // ===== パラメータまとめ =====
    const syllables = ["aa", "ih", "ou", "ee", "oh"];
    const LIPSYNC_INTERVAL_MS = 150;     // 口パク切り替え間隔(ms)
    const FADE_FRAMES = 10;              // クロスフェード補間フレーム数
    const LIPSYNC_WEIGHT = 0.6;          // 口パク時のウェイト値
    // ==========================

    // 現在/直前のモーフ
    if (!this._lipSyncPrevSyllable) this._lipSyncPrevSyllable = null;
    if (!this._lipSyncFadeTask) this._lipSyncFadeTask = null;

    // クロスフェード処理
    function crossFadeLipSync(prevSyllable, nextSyllable, targetWeight, em) {
      if (crossFadeLipSync._fadeTask) cancelAnimationFrame(crossFadeLipSync._fadeTask);
      let frame = 0;
      const prevWeight = prevSyllable ? (em.getValue(prevSyllable) || 0) : 0;
      const nextWeight = em.getValue(nextSyllable) || 0;

      function animate() {
        frame++;
        const t = frame / FADE_FRAMES;
        syllables.forEach(s => {
          if (s === prevSyllable && prevSyllable !== nextSyllable) {
            em.setValue(s, prevWeight * (1 - t));
          } else if (s === nextSyllable) {
            em.setValue(s, nextWeight + (targetWeight - nextWeight) * t);
          } else {
            em.setValue(s, 0);
          }
        });
        if (frame < FADE_FRAMES) {
          crossFadeLipSync._fadeTask = requestAnimationFrame(animate);
        } else {
          syllables.forEach(s => {
            em.setValue(s, (s === nextSyllable) ? targetWeight : 0);
          });
          crossFadeLipSync._fadeTask = null;
        }
      }
      animate();
    }

    // フェードで全て0に（口パク閉じ）
    function fadeToClosed(em) {
      if (crossFadeLipSync._fadeTask) cancelAnimationFrame(crossFadeLipSync._fadeTask);
      let frame = 0;
      const currentWeights = {};
      syllables.forEach(s => {
        currentWeights[s] = em.getValue(s) || 0;
      });

      function animate() {
        frame++;
        const t = frame / FADE_FRAMES;
        syllables.forEach(s => {
          let start = currentWeights[s];
          let value = start + (0 - start) * t;
          em.setValue(s, value);
        });
        if (frame < FADE_FRAMES) {
          crossFadeLipSync._fadeTask = requestAnimationFrame(animate);
        } else {
          syllables.forEach(s => em.setValue(s, 0));
          crossFadeLipSync._fadeTask = null;
        }
      }
      animate();
    }

    if (mode === 1) {
      if (this.lipSyncInterval) {
        console.warn("Lip sync is already running");
        return { errorCode: 300, message: "error:Lip sync is already running" };
      }
      const em = this.vrm.expressionManager;
      this.lipSyncInterval = setInterval(() => {
        // 「あいうえお」または「閉じ（全て0）」をランダム選択
        const withClosed = [...syllables, "closed"];
        const next = withClosed[Math.floor(Math.random() * withClosed.length)];
        if (next === "closed") {
          fadeToClosed(em);
          this._lipSyncPrevSyllable = null;
        } else {
          crossFadeLipSync(this._lipSyncPrevSyllable, next, LIPSYNC_WEIGHT, em);
          this._lipSyncPrevSyllable = next;
        }
      }, LIPSYNC_INTERVAL_MS);
      return 0;
    } else if (mode === -1) {
      if (!this.lipSyncInterval) {
        console.warn("Lip sync is already stopped");
        return { errorCode: 301, message: "error:Lip sync is already stopped" };
      }
      clearInterval(this.lipSyncInterval);
      this.lipSyncInterval = null;
      fadeToClosed(this.vrm.expressionManager);
      this._lipSyncPrevSyllable = null;
      return 0;
    }
  }

/*   blink(mode) {
    if (!this.vrm?.expressionManager) {
      console.warn("Expression manager is not available.");
      return;
    }
    if (mode === 1) {
      if (this.blinkInterval) {
        console.warn("Blinking is already active.");
        return;
      }
      this.blinkInterval = setInterval(() => {
        const blinkValue = Math.random() > 0.9 ? 1.0 : 0.0;
        this.vrm.expressionManager.setValue('blink', blinkValue);
      }, 100);
      console.log("Blinking started.");
    } else if (mode === -1) {
      if (!this.blinkInterval) {
        console.warn("Blinking is not active.");
        return;
      }
      clearInterval(this.blinkInterval);
      this.blinkInterval = null;
      this.vrm.expressionManager.setValue('blink', 0.0);
      console.log("Blinking stopped.");
    }
  } */

  blink(mode) {
    if (!this.vrm?.expressionManager) {
      console.warn("Expression manager is not available.");
      return;
    }
    if (mode === 1) {
      if (this._active) return;
      this._active = true;
      this._blinkLoop();
    } else if (mode === -1) {
      this._active = false;
      this.vrm.expressionManager.setValue('blink', 0.0);
    }
  }

  // 内部：自然なまばたきループ
  async _blinkLoop() {
    const beta = 10;
    const a = 1;
    const closingRate = 0.2;
    const fps = 60;

    while (this._active) {
      const interval = this._gaussianRandomInRange(1.5, 4.0);
      const duration = this._gaussianRandomInRange(0.2, 0.3);

      await this._sleep(interval * 1000);
      if (!this._active) break;

      const frameCount = Math.round(duration * fps);
      for (let i = 0; i < frameCount; i++) {
        if (!this._active) break;
        const t = i / frameCount;
        const w = this._approximatedWeight(t, closingRate, beta, a);
        this.vrm.expressionManager.setValue('blink', w);   // ←ここを修正
        await this._sleep(1000 / fps);
      }
      this.vrm.expressionManager.setValue('blink', 0.0);   // ←ここも修正
    }
    if (this.vrm?.expressionManager) this.vrm.expressionManager.setValue('blink', 0.0);
  }


  // 指数・二次関数でのまばたきweight補間
  _approximatedWeight(t, tc, beta, a) {
    if (t <= tc) {
      // 閉じる（指数関数）
      return (Math.exp(beta * t) - 1) / (Math.exp(beta * tc) - 1);
    } else {
      // 開く（二次関数）
      return -a * (t - tc) * (1 - t) + (1 - t) / (1 - tc);
    }
  }

  // ガウス分布乱数
  _gaussianRandomInRange(min, max) {
    // ボックス＝ミュラー法
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    let num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    num = (num / 4) + 0.5;
    if (num < 0) num = 0;
    if (num > 1) num = 1;
    return min + (max - min) * num;
  }

  _sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
  }

}
