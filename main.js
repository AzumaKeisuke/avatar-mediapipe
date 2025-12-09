// main.js
import { AvatarLoader } from './avatarlib.js';
import { PersonDetector } from './detectors/PersonDetector.js';
import { GestureDetectorModule } from './detectors/GestureDetector.js';
import { FilesetResolver } from '@mediapipe/tasks-vision';

class MainController {
    constructor() {
        // DOM要素
        this.video = document.getElementById('camera-video');
        this.avatarCanvas = document.getElementById('avatar-canvas');
        this.detectionCanvas = document.getElementById('detection-canvas');
        this.detectionCtx = this.detectionCanvas.getContext('2d');

        // UI
        this.controls = {
            face: document.getElementById('enable-face-detection'),
            gesture: document.getElementById('enable-gesture-detection'),
            lookAt: document.getElementById('enable-lookat'),
        };
        this.resolutionSelect = document.getElementById('camera-resolution');
        this.currentResolutionLabel = document.getElementById('current-resolution');

        // モジュール
        this.avatar = new AvatarLoader('avatar-canvas');
        this.personDetector = new PersonDetector();
        this.gestureDetector = new GestureDetectorModule();

        // アニメーション設定
        this.ANIMATION_MAP = { IDLE: 0, GREET: 1, WAVE: 2 };

        // 状態
        this.isPersonPresent = false;
        this.hasGreeted = false;
        this.isWavingCoolDown = false;

        // Mediapipe Visionインスタンス
        this.vision = null;
    }

    async run() {
        // 初期カメラ設定
        await this.setupCamera(640, 480);

        await this.setupAvatar();

        this.vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm"
        );

        // モジュール初期化
        await this.personDetector.init(this.video, this.vision);
        await this.gestureDetector.init(this.video, this.vision);

        // UIイベント
        this.setupEventListeners();

        // 検出器初期状態を反映
        this.updateDetectorState();

        // 描画開始
        this.renderLoop();
        this.avatar.action(this.ANIMATION_MAP.IDLE);
        this.avatar.blink(1);
    }

    /**
     * 指定解像度でカメラを初期化し、videoサイズが確定するまで待つ
     */
    async setupCamera(width, height) {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: width, height: height }
        });
        this.video.srcObject = stream;

        return new Promise((resolve) => {
            this.video.onloadedmetadata = () => {
                // Canvasサイズ合わせ
                this.detectionCanvas.width = this.video.videoWidth;
                this.detectionCanvas.height = this.video.videoHeight;

                // 現在解像度表示
                this.currentResolutionLabel.textContent =
                    `${this.video.videoWidth} x ${this.video.videoHeight}`;

                resolve();
            };
        });
    }

    async setupAvatar() {
        const vrmUrl = './models/avatar.vrm';
        const animUrls = [
            './models/idle.vrma',
            './models/greet.vrma',
            './models/wave.vrma'
        ];

        const [vrmBlob, ...animBlobs] = await Promise.all([
            fetch(vrmUrl).then(res => res.blob()),
            ...animUrls.map(url => fetch(url).then(res => res.blob()))
        ]);

        vrmBlob.name = 'avatar.vrm';
        animBlobs.forEach((blob, i) => blob.name = animUrls[i].split('/').pop());

        await this.avatar.loadModelFromFile(vrmBlob, animBlobs);
    }

    setupEventListeners() {
        this.personDetector.on('personEnter', this.onPersonEnter.bind(this));
        this.personDetector.on('personLeave', this.onPersonLeave.bind(this));
        this.gestureDetector.on('wavingStart', this.onWavingStart.bind(this));

        this.controls.face.addEventListener('change', this.updateDetectorState.bind(this));
        this.controls.gesture.addEventListener('change', this.updateDetectorState.bind(this));

        // 解像度変更イベント
        this.resolutionSelect.addEventListener('change', async (e) => {
            const [w, h] = e.target.value.split('x').map(Number);

            // 顔・ジェスチャー検出停止
            this.personDetector.stop();
            this.gestureDetector.stop();

            // 新しい解像度でカメラ再セット → onloadedmetadataまで待機
            await this.setupCamera(w, h);

            // モジュール再初期化（visionは再利用）
            await this.personDetector.init(this.video, this.vision);
            await this.gestureDetector.init(this.video, this.vision);

            // 必要な検出再開
            this.updateDetectorState();
        });
        this.frameSkipSelect = document.getElementById('frame-skip');
        this.frameSkipSelect.addEventListener('change', (e) => {
            const skipVal = Number(e.target.value);
            this.personDetector.frameSkip = skipVal;
            this.gestureDetector.frameSkip = skipVal;
        });
    }

    updateDetectorState() {
        if (this.controls.face.checked) {
            this.personDetector.start();
        } else {
            this.personDetector.stop();
        }
        if (this.controls.gesture.checked) {
            this.gestureDetector.start();
        } else {
            this.gestureDetector.stop();
        }
    }

    renderLoop() {
        this.detectionCtx.clearRect(0, 0, this.detectionCanvas.width, this.detectionCanvas.height);
        this.detectionCtx.drawImage(this.video, 0, 0, this.detectionCanvas.width, this.detectionCanvas.height);

        if (this.controls.face.checked) {
            this.personDetector.draw(this.detectionCtx);
        }
        if (this.controls.gesture.checked) {
            this.gestureDetector.draw(this.detectionCtx);
        }

        if (this.controls.lookAt.checked) {
            const detections = this.personDetector.lastDetections;
            if (detections && detections.detections.length > 0) {
                const face = detections.detections[0];
                const bbox = face.boundingBox;
                if (bbox.width > 0 && bbox.height > 0) {
                    const targetX = 1.0 - (bbox.originX + bbox.width / 2) / this.video.videoWidth;
                    const targetY = (bbox.originY + bbox.height / 2) / this.video.videoHeight;
                    this.avatar.updateLookAtTarget(targetX, targetY);
                }
            } else {
                this.avatar.updateLookAtTarget(null, null);
            }
        } else {
            this.avatar.updateLookAtTarget(null, null);
        }

        requestAnimationFrame(this.renderLoop.bind(this));
    }

    onPersonEnter() {
        console.log("Person Entered!");
        this.isPersonPresent = true;
        if (!this.hasGreeted) {
            this.hasGreeted = true;
            this.avatar.action(this.ANIMATION_MAP.GREET);
            setTimeout(() => {
                if (this.isPersonPresent) {
                    this.avatar.action(this.ANIMATION_MAP.IDLE);
                }
            }, 3000);
        }
    }

    onPersonLeave() {
        console.log("Person Left!");
        this.isPersonPresent = false;
        this.hasGreeted = false;
        this.avatar.action(this.ANIMATION_MAP.IDLE);
    }

    onWavingStart() {
        console.log("Waving gesture detected!");
        if (this.isPersonPresent && !this.isWavingCoolDown) {
            this.isWavingCoolDown = true;
            this.avatar.action(this.ANIMATION_MAP.WAVE);

            setTimeout(() => {
                if (this.isPersonPresent) {
                    this.avatar.action(this.ANIMATION_MAP.IDLE);
                }
                setTimeout(() => {
                    this.isWavingCoolDown = false;
                }, 2000);
            }, 3000);
        }
    }
}

const controller = new MainController();
controller.run().catch(err => {
    console.error("Application failed to run.", err);
});
