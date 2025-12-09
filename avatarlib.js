import * as THREE from 'three';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';
import { AnimationHandler } from './animation.js';

import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
//import { VRMLookAt, VRMLookAtApplyer } from '@pixiv/three-vrm'; // ★ VRMLookAtApplyer を追加


export class AvatarLoader {
  constructor(canvasId) {
    this.scene = new THREE.Scene();
    // ★★★ 視線追従用のターゲットオブジェクトを作成 ★★★
    this.lookAtTarget = new THREE.Object3D();
    this.scene.add(this.lookAtTarget);

    // ★★★ ライト専用のターゲットを追加 ★★★
    this.lightTarget = new THREE.Object3D();
    this.scene.add(this.lightTarget);

    // ★★★ 視線追従の状態を管理するプロパティを追加 ★★★
    this.smoothLookAtTarget = new THREE.Vector3(); // 滑らかに動かすための中間目標

    const canvas = document.getElementById(canvasId);

    // ★★★ ここから修正 ★★★

    // 1. レンダラーを作成
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0); // 透明

    // 2. カメラを初期化（アスペクト比は仮で1.0に）
    this.camera = new THREE.PerspectiveCamera(30.0, 1.0, 0.1, 100.0);
    this.camera.position.set(0.0, 1.4, 3.0); // 少しカメラ位置を調整

    // 3. リサイズ関数を定義
    const resizeRendererToDisplaySize = () => {
        const canvas = this.renderer.domElement;
        const pixelRatio = window.devicePixelRatio;
        const width = canvas.clientWidth * pixelRatio | 0;
        const height = canvas.clientHeight * pixelRatio | 0;
        const needResize = canvas.width !== width || canvas.height !== height;
        if (needResize) {
            this.renderer.setSize(width, height, false);
            this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
            this.camera.updateProjectionMatrix();
        }
    }
    // ★★★ ここまで修正 ★★★

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.screenSpacePanning = true;
    this.controls.target.set(0.0, 1.0, 0.0);
    this.controls.update();

    this.setupLights();

    //環境マッピング
    new RGBELoader().load('/HDRI/citrus_orchard_road_puresky_128.hdr', (texture) => {
    //new RGBELoader().load('/HDRI/citrus_orchard_road_puresky_4k.hdr', (texture) => {
    texture.mapping = THREE.EquirectangularReflectionMapping;
    this.scene.environment = texture; // PBRマテリアルの環境光
    this.scene.environmentIntensity = 0.8;
    //this.scene.background = texture;  // 背景もSkyboxにしたい場合
    });

    this.loader = new GLTFLoader();
    this.loader.crossOrigin = 'anonymous';
    this.loader.register((parser) => new VRMLoaderPlugin(parser));
    this.loader.register((parser) => new VRMAnimationLoaderPlugin(parser));

    this.currentAnimation = 0;
    this.rooptimer = 0;
    this.mixer = null;
    this.vrm = null;
    this.clips = [];
    this.clock = new THREE.Clock();
    this.animationStarted = true;
    this.lipSyncInterval = null;

    this.animationHandler = null;
    this.startAnimation(resizeRendererToDisplaySize);
  }

/*   setupLights() {
    const lightintensity = 2000;
    const lightDistance = 10;
    const white = 0xffffff;
    
    // Key Light
    const keyLight = new THREE.SpotLight(white);
    keyLight.position.set(lightDistance, lightDistance*0.1, lightDistance);
    keyLight.angle = Math.PI/10;
    keyLight.target = this.lookAtTarget;
    keyLight.power = lightintensity;
    this.scene.add(keyLight);
  } */

  setupLights() {
    const lightintensity = 2000;
    const lightDistance = 10;
    const white = 0xffffff;
    
    const keyLight = new THREE.SpotLight(white);
    keyLight.position.set(lightDistance, lightDistance * 0.1, lightDistance);
    keyLight.angle = Math.PI / 10;
    
    // ★★★ ライトのターゲットを専用のオブジェクトに設定 ★★★
    keyLight.target = this.lightTarget;
    
    keyLight.power = lightintensity;
    this.scene.add(keyLight);
  }

  async loadModelFromFile(vrmFile, vrmaFiles = []) {
    // VRMロード
    const vrmBuffer = await vrmFile.arrayBuffer();
    const gltfVrm = await this.loader.parseAsync(vrmBuffer, '', null);
    this.vrm = gltfVrm.userData.vrm;
    VRMUtils.removeUnnecessaryVertices(this.vrm.scene);
    VRMUtils.combineSkeletons(this.vrm.scene);
    this.vrm.scene.traverse((obj) => { obj.frustumCulled = false; });

    // --- ここから自動センタリング処理 ---
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const center = box.getCenter(new THREE.Vector3());
    this.vrm.scene.position.sub(center);

    // OrbitControlsのターゲットもモデル中心に
    this.controls.target.copy(new THREE.Vector3(0, 0, 0)); // 必要に応じてY値調整
    this.controls.update();
    // --- ここまで ---

    const lookAtQuatProxy = new VRMLookAtQuaternionProxy(this.vrm.lookAt);
    lookAtQuatProxy.name = 'lookAtQuaternionProxy';
    this.vrm.scene.add(lookAtQuatProxy);
    //this.vrm.scene.position.set(-1, 0.5, 0);

    // ★★★ 視線追従の設定 ★★★
    if (this.vrm.lookAt) {
        // lookAtのターゲットを、シーンに追加したターゲットオブジェクトに設定
        this.vrm.lookAt.target = this.lookAtTarget;
        
/*         // lookAtの挙動を有効化
        // VRM 1.0ではAutoUpdateTypeがデフォルトで'NONE'なので'VRM'に設定する必要がある
        if (this.vrm.lookAt.applyer) {
            this.vrm.lookAt.applyer.autoUpdate = true;
        } else if(this.vrm.lookAt instanceof VRMLookAtApplyer) { // three-vrm v1.x
            this.vrm.lookAt.autoUpdate = true;
        } */

        // v2.x以降では、autoUpdateプロパティを直接trueにするだけでOK
        this.vrm.lookAt.autoUpdate = true;

        // ★★★ ここからが修正箇所 ★★★

        // v1.x以降では、rangeMapプロパティを使って可動範囲を設定します
        
        // 1. 水平方向（左右）の可動範囲を設定
        // 入力角度(input), 出力角度(output) のペアでマッピングを定義します
        // 入力0 -> 出力0 (正面)
        // 入力90度 -> 出力45度 (右を向いたとき、実際の首の動きは45度まで)
        const horizontalMax = 45; // 左右の最大可動域（度数）
        this.vrm.lookAt.rangeMapHorizontal = {
            xRange: [0, 90], // 入力角度の範囲（常に0-90でOK）
            yRange: [0, horizontalMax * THREE.MathUtils.DEG2RAD] // 出力角度の範囲（ラジアン）
        };

        // 2. 垂直方向（上下）の可動範囲を設定
        // 同様にマッピングで定義します
        const verticalUpMax = 10;   // 上方向の最大可動域（度数）
        const verticalDownMax = 15; // 下方向の最大可動域（度数）
        this.vrm.lookAt.rangeMapVertical = {
            xRange: [0, 90], // 入力角度の範囲
            yRange: [0, verticalUpMax * THREE.MathUtils.DEG2RAD] // 上方向のマッピング
        };
        this.vrm.lookAt.rangeMapVerticalNegative = {
            xRange: [0, 90], // 入力角度の範囲
            yRange: [0, verticalDownMax * THREE.MathUtils.DEG2RAD] // 下方向のマッピング
        };

        // ★★★ ここまで ★★★

    }
    this.scene.add(this.vrm.scene);
    this.mixer = new THREE.AnimationMixer(this.scene);

    // VRMAロード
    this.clips = [];
    for (const file of vrmaFiles) {
      const buffer = await file.arrayBuffer();
      const gltfVrma = await this.loader.parseAsync(buffer, '', null);
      const vrmAnimation = gltfVrma.userData.vrmAnimations[0];
      const clip = createVRMAnimationClip(vrmAnimation, this.vrm);

        // ルートの.positionトラックを除去
/*       clip.tracks = clip.tracks.filter(track => {
        return !(
          track.name.match(/hips\.position/) ||
          track.name.match(/Armature\.position/) ||
          track.name.match(/Root\.position/)
        );
      }); */

      const a = this.mixer.clipAction(clip);
      this.clips.push(a);
    }

    // AnimationHandler再生成
    this.animationHandler = new AnimationHandler(this);
    // もしアニメ自動再生したい場合は
    // if(this.clips.length > 0) this.action(0);
  }

// 既存のactionメソッドを修正
action(animationID) {
  if (!this.animationHandler) return;
  if (animationID === -1) {
    // 全アニメ停止
    this.clips.forEach(a => a.stop && a.stop());
    this.currentAnimation = -1;
    return;
  }
  this.animationHandler.playAnimation(animationID);
  this.currentAnimation = animationID;
}


  lipSync(mode) {
    if (!this.animationHandler) return;
    return this.animationHandler.lipSync(mode);
  }

  blink(mode) {
    if (!this.animationHandler) return;
    this.animationHandler.blink(mode);
  }

  // ★★★ 視線ターゲットを更新するメソッドを追加 ★★★
  /**
   * アバターの視線ターゲットの位置を更新します。
   * @param {number | null} x - 画面の正規化X座標 (0.0 - 1.0)。nullの場合は正面を向く。
   * @param {number | null} y - 画面の正規化Y座標 (0.0 - 1.0)。
   */
/*   updateLookAtTarget(x, y) {
      if (x === null || y === null) {
          // ターゲットをアバターの少し前にリセットして正面を向かせる
          this.lookAtTarget.position.set(0, this.camera.position.y, 1);
          return;
      }

      // 正規化座標 (-1.0 to +1.0) に変換
      const vector = new THREE.Vector3( (x * 2) - 1, -(y * 2) + 1, 0.5 );
      
      // 2Dスクリーン座標を3D空間の座標に変換
      vector.unproject(this.camera);

      // カメラからターゲットへの方向ベクトルを計算
      const dir = vector.sub(this.camera.position).normalize();
      
      // カメラから一定距離（例: 2.0）だけ離れた位置をターゲットとする
      const distance = 2.0;
      const pos = this.camera.position.clone().add(dir.multiplyScalar(distance));
      
      this.lookAtTarget.position.copy(pos);
  } */

/*   // ★★★ このメソッドを全面的に書き換える ★★★
  updateLookAtTarget(x, y) {
    if (!this.vrm) return; // VRMモデルがロードされていなければ何もしない

    if (x === null || y === null) {
        // 顔が検出されない場合、ターゲットをアバターの正面遠くに設定してリセット
        this.lookAtTarget.position.set(
            this.vrm.scene.position.x,
            this.vrm.scene.position.y + 1.5, // アバターの目の高さあたり
            this.vrm.scene.position.z + 5.0  // アバターの5.0前方
        );
        return;
    }

    // 1. アバターの頭の位置を3D空間の原点として取得
    const headPosition = new THREE.Vector3();
    // VRMのHeadボーンを取得
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
        head.getWorldPosition(headPosition);
    } else {
        // Headボーンがない場合は、シーンの位置を代用
        headPosition.copy(this.vrm.scene.position);
        headPosition.y += 1.5; // 適当な目の高さを加える
    }

    // 2. カメラからアバターの頭までの距離を計算
    const distance = this.camera.position.distanceTo(headPosition);

    // 3. 2Dスクリーン座標を3D空間の座標に変換
    //    unprojectはカメラのクリッピング平面を使うため、z= -1 (手前) に設定
    const vector = new THREE.Vector3( (x * 2) - 1, -(y * 2) + 1, -1 );
    vector.unproject(this.camera);

    // 4. カメラからその3D点への方向ベクトルを計算
    const dir = vector.sub(this.camera.position).normalize();

    // 5. カメラからアバターの頭までの距離を使って、目標地点を再計算
    //    これにより、目標地点は常にアバターと同じ深度の平面上に配置される
    const targetPosition = this.camera.position.clone().add(dir.multiplyScalar(distance));
    
    // 6. lookAtTargetの位置を更新
    this.lookAtTarget.position.copy(targetPosition);
  } */


/*   // ★★★ このメソッドを新しいロジックで全面的に書き換える ★★★
  updateLookAtTarget(x, y) {
    if (!this.vrm) return;

    // --- パラメータ設定 ---
    //const deadzone = { width: 0.3, height: 0.4 }; // 不感帯のサイズ (画面全体の30% x 40%)
    const deadzone = { width: 0.3, height: 0.4 }; 
    const verticalMovementScale = 0.3; // 上下方向の動きの抑制率 (30%だけ動かす)
    const smoothingFactor = 0.05; // 視線移動のスムーズさ (小さいほど滑らか)

    // --- 基準となる位置を計算 ---
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    const headPosition = new THREE.Vector3();
    if (head) {
        head.getWorldPosition(headPosition);
    } else {
        headPosition.copy(this.vrm.scene.position);
        headPosition.y += 1.4;
    }

    // アバターの正面方向の座標（リセット先の目標）
    const frontTargetPosition = new THREE.Vector3(
        this.vrm.scene.position.x,
        headPosition.y, // Y座標は常に頭の高さ
        this.vrm.scene.position.z + 5.0
    );

    let finalTargetPosition = frontTargetPosition.clone();

    // --- 顔が検出されている場合の処理 ---
    if (x !== null && y !== null) {
        // 顔が不感帯の中にあるかチェック
        const isInsideDeadzone = 
            Math.abs(x - 0.5) < deadzone.width / 2 &&
            Math.abs(y - 0.5) < deadzone.height / 2;

        if (!isInsideDeadzone) {
            // --- 不感帯の外にいる場合のみ、視線追従の計算を行う ---
            const distance = this.camera.position.distanceTo(headPosition);
            const vector = new THREE.Vector3((x * 2) - 1, -(y * 2) + 1, -1);
            vector.unproject(this.camera);
            const dir = vector.sub(this.camera.position).normalize();
            const calculatedTargetPos = this.camera.position.clone().add(dir.multiplyScalar(distance));

            // 上下方向の動きを抑制
            const suppressedY = headPosition.y + (calculatedTargetPos.y - headPosition.y) * verticalMovementScale;
            
            finalTargetPosition.set(calculatedTargetPos.x, suppressedY, calculatedTargetPos.z);
        }
        // 顔が不感帯の中にある場合は、finalTargetPositionは正面のまま
    }
    
    // --- スムージング処理 ---
    // 現在の視線目標(smoothLookAtTarget)を、最終目標(finalTargetPosition)に少しずつ近づける
    if (!this.smoothLookAtTarget.equals(finalTargetPosition)) {
        this.smoothLookAtTarget.lerp(finalTargetPosition, smoothingFactor);
    }

    // 最終的な目標地点をlookAtTargetに設定
    this.lookAtTarget.position.copy(this.smoothLookAtTarget);
  } */

  // ★★★ このメソッドを新しいロジックで全面的に書き換える ★★★
  updateLookAtTarget(x, y) {
    if (!this.vrm) return;

    // --- パラメータ設定 ---
    const LOOK_AT_DISTANCE = 2.0; // アバターから目標地点までの距離 (m)
    //const MAX_HORIZONTAL_ANGLE = 45; // 水平方向の最大角度（度数）
    const MAX_HORIZONTAL_ANGLE = 80; // 水平方向の最大角度（度数）
    const MAX_VERTICAL_ANGLE = 15;   // 垂直方向の最大角度（度数）
    const smoothingFactor = 0.1; // スムージング係数

    // --- 基準となる位置を計算 ---
    const headPosition = new THREE.Vector3();
    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
        head.getWorldPosition(headPosition);
    } else {
        headPosition.copy(this.vrm.scene.position);
        headPosition.y += 1.4;
    }

    let finalTargetPosition;

    if (x === null || y === null) {
        // --- 顔が検出されない場合：正面を向く ---
        finalTargetPosition = new THREE.Vector3(
            headPosition.x,
            headPosition.y,
            headPosition.z + LOOK_AT_DISTANCE
        );
    } else {
        // --- 顔が検出されている場合 ---

        // 1. 画面中心からの相対位置を計算 (-0.5 to +0.5)
        const relativeX = x - 0.5;
        const relativeY = y - 0.5;

        // 2. 相対位置を角度に変換（ラジアン）
        const yaw = relativeX * MAX_HORIZONTAL_ANGLE * THREE.MathUtils.DEG2RAD;
        const pitch = relativeY * MAX_VERTICAL_ANGLE * THREE.MathUtils.DEG2RAD;

        // 3. アバターの正面方向を基準に、計算した角度だけ回転させたベクトルを作成
        const targetDirection = new THREE.Vector3(0, 0, 1); // アバターの正面方向
        const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ'); // 回転を適用
        targetDirection.applyEuler(euler);

        // 4. アバターの頭の位置から、その方向に一定距離進んだ点を目標地点とする
        finalTargetPosition = headPosition.clone().add(targetDirection.multiplyScalar(LOOK_AT_DISTANCE));
    }
    
    // --- スムージング処理 ---
    if (!this.smoothLookAtTarget) {
        this.smoothLookAtTarget = finalTargetPosition.clone();
    }
    this.smoothLookAtTarget.lerp(finalTargetPosition, smoothingFactor);

    // 最終的な目標地点をlookAtTargetに設定
    this.lookAtTarget.position.copy(this.smoothLookAtTarget);
  }

  startAnimation(resizeCallback) { // ★ 引数を追加
    const animateLoop = () => {
      requestAnimationFrame(animateLoop);

      // ★ リサイズ処理をループ内で呼び出す
      if (resizeCallback) {
          resizeCallback();
      }

      const deltaTime = this.clock.getDelta();
      if (this.animationHandler && this.animationHandler.mixer)
        this.animationHandler.mixer.update(deltaTime);
      if (this.animationHandler && this.animationHandler.vrm)
        this.animationHandler.vrm.update(deltaTime);
      this.renderer.render(this.scene, this.camera);
    };
    animateLoop();
  }

  clearScene() {
    // VRM/animation削除
    if (this.vrm && this.vrm.scene) {
      this.scene.remove(this.vrm.scene);
      this.vrm = null;
      this.clips = [];
      this.mixer = null;
      this.animationHandler = null;
    }
  }

  // ▼▼▼ ここから追加 ▼▼▼
/*   saveAsImage(filename = 'character.png') {
    // モデルが読み込まれていない場合は何もしない
    if (!this.vrm) {
      alert('モデルが読み込まれていません。');
      return;
    }

    // 現在のシーンを強制的に一度レンダリングして、最新の状態をキャンバスに反映させる
    this.renderer.render(this.scene, this.camera);

    // aタグを作成してダウンロードをトリガーする
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.renderer.domElement.toDataURL('image/png');
    link.click();
  } */


  saveAsImage(filename = 'character.png', scale = 4) {
    if (!this.vrm) {
      alert('モデルが読み込まれていません。');
      return;
    }

    // 1. オリジナルのサイズとアスペクト比を保存
    const originalSize = new THREE.Vector2();
    this.renderer.getSize(originalSize);
    const originalAspect = this.camera.aspect;

    // 2. 保存用の高解像度サイズを計算
    const scaledWidth = originalSize.width * scale;
    const scaledHeight = originalSize.height * scale;

    // 3. レンダラーとカメラを一時的にリサイズ
    this.renderer.setSize(scaledWidth, scaledHeight, false);
    this.camera.aspect = scaledWidth / scaledHeight;
    this.camera.updateProjectionMatrix();

    // 4. 高解像度で1フレーム描画
    this.renderer.render(this.scene, this.camera);

    // 5. 画像を生成
    const link = document.createElement('a');
    link.download = filename;
    link.href = this.renderer.domElement.toDataURL('image/png');
    link.click();

    // 6. 【重要】レンダラーとカメラのサイズを元に戻す
    this.renderer.setSize(originalSize.x, originalSize.y, false);
    this.camera.aspect = originalAspect;
    this.camera.updateProjectionMatrix();
  }

}
