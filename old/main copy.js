import { AvatarLoader } from './avatarlib.js';
import { PersonDetector } from './detectors/PersonDetector.js';

class MainController {
    constructor() {
        // DOM要素の取得
        this.video = document.getElementById('camera-video');
        this.avatarCanvas = document.getElementById('avatar-canvas');
        this.detectionCanvas = document.getElementById('detection-canvas');
        this.detectionCtx = this.detectionCanvas.getContext('2d');

        // 各モジュールのインスタンス化
        this.avatar = new AvatarLoader('avatar-canvas');
        this.detector = new PersonDetector();

        // アニメーションIDの管理
        this.ANIMATION_MAP = {
            IDLE: 0,
            GREET: 1,
        };

        // 状態管理
        this.isPersonPresent = false;
        this.hasGreeted = false;
    }

    async run() {
        await this.setupCamera();
        await this.setupAvatar();
        await this.setupDetector();

        // イベントリスナーを設定
        this.detector.on('personEnter', this.onPersonEnter.bind(this));
        this.detector.on('personLeave', this.onPersonLeave.bind(this));

        // 検出を開始
        this.detector.start();

        // 描画ループを開始
        this.renderLoop();

        // 初期状態として待機モーションを開始
        this.avatar.action(this.ANIMATION_MAP.IDLE);
        this.avatar.blink(1);
    }

    async setupCamera() {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: 640, height: 480 }
        });
        this.video.srcObject = stream;
        return new Promise((resolve) => {
            this.video.onloadedmetadata = () => {
                // detection-canvasのサイズをビデオに合わせる
                this.detectionCanvas.width = this.video.videoWidth;
                this.detectionCanvas.height = this.video.videoHeight;
                resolve();
            };
        });
    }

    async setupAvatar() {
        // VRMとアニメーションファイルをロード
        // ここでは仮のファイルパスを指定。実際にはユーザーが選択するか、固定のURLから読み込む
        const vrmUrl = './models/avatar.vrm'; // ★貴社のアバターモデルのパス
        const animUrls = [
            './models/idle.vrma',   // ★待機モーション
            './models/greet.vrma'   // ★挨拶モーション
        ];

        const [vrmBlob, ...animBlobs] = await Promise.all([
            fetch(vrmUrl).then(res => res.blob()),
            ...animUrls.map(url => fetch(url).then(res => res.blob()))
        ]);
        
        // BlobをFileオブジェクトのように見せかける
        vrmBlob.name = 'avatar.vrm';
        animBlobs.forEach((blob, i) => blob.name = animUrls[i].split('/').pop());

        await this.avatar.loadModelFromFile(vrmBlob, animBlobs);
    }

    async setupDetector() {
        await this.detector.init(this.video);
    }

/*     // ★★★ 新しい描画ループ ★★★
    renderLoop() {
        // 1. 検出結果用Canvasの描画
        this.detectionCtx.clearRect(0, 0, this.detectionCanvas.width, this.detectionCanvas.height);
        // カメラ映像を反転して描画
        this.detectionCtx.save();
        this.detectionCtx.scale(-1, 1);
        this.detectionCtx.drawImage(this.video, -this.detectionCanvas.width, 0, this.detectionCanvas.width, this.detectionCanvas.height);
        this.detectionCtx.restore();
        // 検出結果（バウンディングボックス）を描画
        this.detector.draw(this.detectionCtx);

        // 2. アバターのアニメーションはAvatarLoader内部のループで更新される

        // 3. 次のフレームをリクエスト
        requestAnimationFrame(this.renderLoop.bind(this));
    }
 */

    renderLoop() {
        // 1. 検出結果用Canvasの描画
        // Canvasをクリア
        this.detectionCtx.clearRect(0, 0, this.detectionCanvas.width, this.detectionCanvas.height);
        
        // ビデオフレームをそのまま描画（反転はCSSが担当）
        this.detectionCtx.drawImage(this.video, 0, 0, this.detectionCanvas.width, this.detectionCanvas.height);
        
        // 検出結果（バウンディングボックス）を描画
        this.detector.draw(this.detectionCtx);

        // 2. アバターのアニメーションはAvatarLoader内部のループで更新される

        // 3. 次のフレームをリクエスト
        requestAnimationFrame(this.renderLoop.bind(this));
    }

    onPersonEnter() {
        console.log("Person Entered!");
        this.isPersonPresent = true;
        if (!this.hasGreeted) {
            this.hasGreeted = true;
            this.avatar.action(this.ANIMATION_MAP.GREET);
            const GREET_ANIMATION_DURATION = 3000;
            setTimeout(() => {
                if (this.isPersonPresent) {
                    this.avatar.action(this.ANIMATION_MAP.IDLE);
                }
            }, GREET_ANIMATION_DURATION);
        }
    }

    onPersonLeave() {
        console.log("Person Left!");
        this.isPersonPresent = false;
        this.hasGreeted = false;
        this.avatar.action(this.ANIMATION_MAP.IDLE);
    }
}

// アプリケーションを起動
const controller = new MainController();
controller.run().catch(err => {
    console.error("Application failed to run.", err);
});
