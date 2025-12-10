// main.js
import { AvatarLoader } from './avatarlib.js';
import { PersonDetector } from './detectors/PersonDetector.js';
import { GestureDetectorModule } from './detectors/GestureDetector.js';
import { FilesetResolver } from '@mediapipe/tasks-vision';


// ★★★ PersonStateクラスを追加 ★★★
class PersonState {
    constructor(id, detection) {
        this.id = id;
        this.detection = detection;
        this.startTime = performance.now();
        this.lastSeenTime = performance.now();
        this.isGreeted = false; // 「関心あり」の挨拶をしたか
        this.isApproached = false; // 「呼び込み」をしたか
        this.isAnimationLocked = false; 
    }
    update(detection) {
        this.detection = detection;
        this.lastSeenTime = performance.now();
    }
}

class MainController {
    constructor() {
        // DOM要素
        this.video = document.getElementById('camera-video');
        this.avatarCanvas = document.getElementById('avatar-canvas');
        this.detectionCanvas = document.getElementById('detection-canvas');
        this.detectionCtx = this.detectionCanvas.getContext('2d');
        // ★★★ メッセージ表示用のDOM要素を追加 ★★★
        this.messageOverlay = document.getElementById('message-overlay');
        this.messageText = document.getElementById('message-text');

        // UI
        this.controls = {
            face: document.getElementById('enable-face-detection'),
            gesture: document.getElementById('enable-gesture-detection'),
            lookAt: document.getElementById('enable-lookat'),
        };
        this.resolutionSelect = document.getElementById('camera-resolution');
        this.currentResolutionLabel = document.getElementById('current-resolution');
        this.frameSkipSelect = document.getElementById('frame-skip');

        // モジュール
        this.avatar = new AvatarLoader('avatar-canvas');
        this.personDetector = new PersonDetector();
        this.gestureDetector = new GestureDetectorModule();

        // アニメーション設定
        // ★ 呼び込みアニメーションを追加（例としてID=3）
        this.ANIMATION_MAP = { IDLE: 0, GREET: 1, WAVE: 2, BECKON: 3 };
        // ※ vrmaファイルに手招きアニメーション(beckon.vrmaなど)を追加し、
        //   setupAvatar()で読み込む必要があります。

        // ★★★ 戦略と状態管理のプロパティを追加 ★★★
        this.vision = null;
        this.currentStrategy = 'selective'; // デフォルト戦略
        this.trackedPeople = new Map();
        this.lastAggressiveReactionTime = 0; // 積極的戦略のクールダウンタイマー
        this.isWavingCoolDown = false;
        this.currentTarget = null; // 視線追従のターゲット

        // ★★★ 戦略パラメータを追加 ★★★
        this.STRATEGY_PARAMS = {
            selective: { DWELL_TIME_THRESHOLD: 2000, APPROACH_SIZE_THRESHOLD: 0.15 },
            aggressive: { REACTION_COOLDOWN: 8000, ROI_WIDTH: 0.2 },
            hybrid: { DWELL_TIME_THRESHOLD: 2000, APPROACH_SIZE_THRESHOLD: 0.15, REACTION_COOLDOWN: 8000, ROI_WIDTH: 0.2 }
        };

        // ★★★ メッセージデータを保持するプロパティを追加 ★★★
        this.messages = {};
    }

    async run() {
        // ★★★ メッセージファイルを読み込む処理を追加 ★★★
        await this.loadMessages();

        await this.setupCamera(640, 480);
        await this.setupAvatar();
        this.vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.9/wasm" );
        await this.personDetector.init(this.video, this.vision);
        await this.gestureDetector.init(this.video, this.vision);
        this.setupEventListeners();
        this.updateDetectorState();
        this.renderLoop();
        this.avatar.action(this.ANIMATION_MAP.IDLE);
        this.avatar.blink(1);
    }

    // ★★★ メッセージ読み込みメソッドを新規作成 ★★★
    async loadMessages() {
        try {
            const response = await fetch('./messages.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.messages = await response.json();
            console.log("メッセージファイルを読み込みました。", this.messages);
        } catch (error) {
            console.error("メッセージファイルの読み込みに失敗しました。", error);
            // ファイルがなくても動作するように、デフォルトのメッセージを設定
            this.messages = {
                GREET: "こんにちは！",
                WAVE: "ありがとう！",
                BECKON: "見ていきませんか？"
            };
        }
    }

    // ★★★ メッセージ表示/非表示のヘルパーメソッドを新規作成 ★★★
    /**
     * メッセージを指定された時間表示します。
     * @param {string} messageKey - messages.jsonのキー (例: "GREET")
     * @param {number} duration - 表示時間(ms)。0以下の場合は非表示にします。
     */
    displayMessage(messageKey, duration) {
        const message = this.messages[messageKey] || "";

        if (duration > 0 && message) {
            this.messageText.innerHTML = message;
            this.messageOverlay.classList.add('visible');

            // 指定時間後にメッセージを非表示にする
            setTimeout(() => {
                this.messageOverlay.classList.remove('visible');
            }, duration);
        } else {
            // durationが0、またはメッセージが空の場合は非表示
            this.messageOverlay.classList.remove('visible');
        }
    }

    async setupCamera(width, height) {
        // ... (変更なし)
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: width, height: height }
        });
        this.video.srcObject = stream;

        return new Promise((resolve) => {
            this.video.onloadedmetadata = () => {
                this.detectionCanvas.width = this.video.videoWidth;
                this.detectionCanvas.height = this.video.videoHeight;
                this.currentResolutionLabel.textContent = `${this.video.videoWidth} x ${this.video.videoHeight}`;
                resolve();
            };
        });
    }

    async setupAvatar() {
        // ★ 呼び込みアニメーション(beckon.vrma)を追加
        const vrmUrl = './models/avatar.vrm';
        const animUrls = [
            './models/idle.vrma',
            './models/greet.vrma',
            './models/wave.vrma',
            './models/beckon.vrma'// 必要に応じて追加
        ];
        // ... (以降のロード処理は変更なし)
        const [vrmBlob, ...animBlobs] = await Promise.all([
            fetch(vrmUrl).then(res => res.blob()),
            ...animUrls.map(url => fetch(url).then(res => res.blob()))
        ]);
        vrmBlob.name = 'avatar.vrm';
        animBlobs.forEach((blob, i) => blob.name = animUrls[i].split('/').pop());
        await this.avatar.loadModelFromFile(vrmBlob, animBlobs);
    }

    setupEventListeners() {
        // ★★★ personEnter/LeaveをdetectionsUpdatedに置き換え ★★★
        this.personDetector.on('detectionsUpdated', this.handlePersonDetections.bind(this));
        this.gestureDetector.on('wavingStart', this.onWavingStart.bind(this));

        this.controls.face.addEventListener('change', this.updateDetectorState.bind(this));
        this.controls.gesture.addEventListener('change', this.updateDetectorState.bind(this));

        // 解像度変更イベント (変更なし)
        this.resolutionSelect.addEventListener('change', async (e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            this.personDetector.stop();
            this.gestureDetector.stop();
            await this.setupCamera(w, h);
            await this.personDetector.init(this.video, this.vision);
            await this.gestureDetector.init(this.video, this.vision);
            this.updateDetectorState();
        });
        
        // フレームレート変更イベント (変更なし)
        this.frameSkipSelect.addEventListener('change', (e) => {
            const skipVal = Number(e.target.value);
            this.personDetector.frameSkip = skipVal;
            this.gestureDetector.frameSkip = skipVal;
        });

        // ★★★ 戦略切り替えUIのイベントリスナーを追加 ★★★
        document.getElementsByName('detection-strategy').forEach(radio => {
            radio.addEventListener('change', (event) => {
                this.currentStrategy = event.target.value;
                console.log(`検出戦略を「${this.currentStrategy}」に変更しました。`);
                // 戦略が変わったら状態をリセット
                this.trackedPeople.clear();
                this.lastAggressiveReactionTime = 0;
                this.currentTarget = null;
                this.avatar.action(this.ANIMATION_MAP.IDLE); // アイドル状態に戻す
            });
        });
    }

    updateDetectorState() {
        // ... (変更なし)
        if (this.controls.face.checked) this.personDetector.start();
        else this.personDetector.stop();
        if (this.controls.gesture.checked) this.gestureDetector.start();
        else this.gestureDetector.stop();
    }

    renderLoop() {
        this.detectionCtx.clearRect(0, 0, this.detectionCanvas.width, this.detectionCanvas.height);
        this.detectionCtx.drawImage(this.video, 0, 0, this.detectionCanvas.width, this.detectionCanvas.height);

        if (this.controls.face.checked) this.personDetector.draw(this.detectionCtx);
        if (this.controls.gesture.checked) this.gestureDetector.draw(this.detectionCtx);

        // ★★★ 視線追従ロジックを更新 ★★★
        if (this.controls.lookAt.checked && this.currentTarget) {
            const bbox = this.currentTarget.detection.boundingBox;
            const targetX = 1.0 - (bbox.originX + bbox.width / 2) / this.video.videoWidth;
            const targetY = (bbox.originY + bbox.height / 2) / this.video.videoHeight;
            this.avatar.updateLookAtTarget(targetX, targetY);
        } else {
            this.avatar.updateLookAtTarget(null, null);
        }

        requestAnimationFrame(this.renderLoop.bind(this));
    }

    // ★★★ 古いイベントハンドラは削除またはコメントアウト ★★★
    // onPersonEnter() { ... }
    // onPersonLeave() { ... }

    // ★★★ 新しい人物検出ハンドラを追加 ★★★
    handlePersonDetections(detections) {
        const now = performance.now();
        const matchedPersonIds = new Set();
        const TRACKING_DISTANCE_THRESHOLD = 50; // [px] この距離内なら同じ人物と見なす

        // 1. 新しい検出結果と、既存の追跡中人物をマッチング
        detections.forEach(detection => {
            const centerX = detection.boundingBox.originX + detection.boundingBox.width / 2;
            const centerY = detection.boundingBox.originY + detection.boundingBox.height / 2;
            let bestMatch = null;
            let minDistance = Infinity;

            // 既存の人物リストから最も近い人を探す
            for (const person of this.trackedPeople.values()) {
                const prevCenterX = person.detection.boundingBox.originX + person.detection.boundingBox.width / 2;
                const prevCenterY = person.detection.boundingBox.originY + person.detection.boundingBox.height / 2;
                const distance = Math.sqrt(Math.pow(centerX - prevCenterX, 2) + Math.pow(centerY - prevCenterY, 2));

                if (distance < minDistance && distance < TRACKING_DISTANCE_THRESHOLD) {
                    minDistance = distance;
                    bestMatch = person;
                }
            }

            if (bestMatch) {
                // ★ マッチング成功：既存の人物情報を更新
                bestMatch.update(detection);
                matchedPersonIds.add(bestMatch.id);
            } else {
                // ★ マッチング失敗：新しい人物として登録
                // ユニークなIDを生成（ここでは現在時刻のミリ秒を使う）
                const newId = now + Math.random(); 
                this.trackedPeople.set(newId, new PersonState(newId, detection));
                matchedPersonIds.add(newId);
            }
        });

        // 2. マッチしなかった（画面からいなくなった）人を削除
        for (const id of this.trackedPeople.keys()) {
            if (!matchedPersonIds.has(id)) {
                // タイムアウトを設けて、一瞬の検出ミスに対応
                const person = this.trackedPeople.get(id);
                if (now - person.lastSeenTime > 500) { // 500ms以上見失ったら削除
                    console.log(`Person ${id} を追跡リストから削除します。`);
                    if (this.currentTarget && this.currentTarget.id === id) {
                        this.currentTarget = null;
                        if (!this.isAnimationLocked) {
                            this.avatar.action(this.ANIMATION_MAP.IDLE);
                        }
                    }
                    this.trackedPeople.delete(id);
                }
            }
        }

        // 3. 戦略の実行とターゲットの更新
        // potentialTargets を trackedPeople の値から作成
        const potentialTargets = Array.from(this.trackedPeople.values());

        switch (this.currentStrategy) {
            case 'selective':
                this.runSelectiveStrategy(now);
                break;
            case 'aggressive':
                this.runAggressiveStrategy(now);
                break;
            case 'hybrid':
                this.runAggressiveStrategy(now);
                this.runSelectiveStrategy(now);
                break;
        }

        this.updateLookAtTarget(potentialTargets);
    }
    
    // ★★★ playAvatarActionヘルパーメソッドを修正 ★★★
    playAvatarAction(animationId, duration) {
        if (this.isAnimationLocked && animationId !== this.ANIMATION_MAP.IDLE) {
            console.log(`アニメーションロック中のため、${animationId} の再生をスキップしました。`);
            return;
        }

        this.avatar.action(animationId);

        // ★★★ メッセージ表示処理を追加 ★★★
        // ANIMATION_MAPのIDからキー名を取得する
        const messageKey = Object.keys(this.ANIMATION_MAP).find(key => this.ANIMATION_MAP[key] === animationId);
        if (messageKey) {
            // アニメーション時間より少し短い時間だけメッセージを表示する
            this.displayMessage(messageKey, duration > 0 ? duration - 500 : 0);
        }


        if (animationId !== this.ANIMATION_MAP.IDLE && duration > 0) {
            this.isAnimationLocked = true;
            console.log(`アニメーションロックを開始 (duration: ${duration}ms)`);

            setTimeout(() => {
                console.log("アニメーションロックを解除。");
                this.isAnimationLocked = false;
                // ★ アイドルに戻す前に、表示中のメッセージを消す
                this.displayMessage('IDLE', 0);
                this.avatar.action(this.ANIMATION_MAP.IDLE);
            }, duration);
        }
    }

    // ★★★ 戦略ごとの実行関数を追加 ★★★
    // ★★★ runSelectiveStrategyメソッドを修正 ★★★
    runSelectiveStrategy(now) {
        // パラメータを取得
        const params = this.STRATEGY_PARAMS[this.currentStrategy] || this.STRATEGY_PARAMS.hybrid;

        // 追跡中の人物をループ
        for (const person of this.trackedPeople.values()) {
            // すでに挨拶済みなら、この人に対する処理はスキップ
            if (person.isGreeted) {
                continue;
            }

            // 現在時刻と追跡開始時刻から滞在時間を計算
            const dwellTime = now - person.startTime;

            // 滞在時間が閾値を超えたかどうかをチェック
            if (dwellTime > params.DWELL_TIME_THRESHOLD) {
                console.log(`[選択的] Person ${person.id} が ${params.DWELL_TIME_THRESHOLD}ms 以上滞在。挨拶します。`);
                
                // この人には挨拶済みとしてフラグを立てる
                person.isGreeted = true;
                
                // アニメーションを再生
                // playAvatarActionヘルパーメソッドを使い、GREETアニメーションを3秒間再生
                this.playAvatarAction(this.ANIMATION_MAP.GREET, 3000); 
            }
        }
    }

    runAggressiveStrategy(now) {
        const params = this.STRATEGY_PARAMS[this.currentStrategy] || this.STRATEGY_PARAMS.hybrid;
        if (now - this.lastAggressiveReactionTime < params.REACTION_COOLDOWN) return;

        for (const person of this.trackedPeople.values()) {
            if (person.isApproached || person.isGreeted) continue;

            const faceCenterX = person.detection.boundingBox.originX + person.detection.boundingBox.width / 2;
            const videoWidth = this.video.videoWidth;
            const roiThreshold = videoWidth * params.ROI_WIDTH;

            if (faceCenterX < roiThreshold || faceCenterX > videoWidth - roiThreshold) {
                console.log(`[積極的] Person ${person.id} がROIに侵入。呼びかけます。`);
                person.isApproached = true;
                this.lastAggressiveReactionTime = now;

                if (this.avatar.clips[this.ANIMATION_MAP.BECKON]) {
                    // ★★★ ヘルパーメソッドを使って再生 ★★★
                    this.playAvatarAction(this.ANIMATION_MAP.BECKON, 2000);
                } else {
                    this.playAvatarAction(this.ANIMATION_MAP.GREET, 3000);
                }
                return;
            }
        }
    }

    // ★★★ 視線追従ターゲットの選択ロジックを追加 ★★★
    updateLookAtTarget(potentialTargets) {
        if (!potentialTargets || potentialTargets.length === 0) {
            this.currentTarget = null;
            return;
        }

        // 優先度： 挨拶済み > 画面中央
        let bestTarget = null;
        let minDistance = Infinity;

        // 挨拶済みの人がいれば、その中で一番中央に近い人を選ぶ
        const greetedPeople = potentialTargets.filter(p => p.isGreeted);
        if (greetedPeople.length > 0) {
            greetedPeople.forEach(p => {
                const centerX = p.detection.boundingBox.originX + p.detection.boundingBox.width / 2;
                const distance = Math.abs(centerX - this.video.videoWidth / 2);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestTarget = p;
                }
            });
        } else {
            // 挨拶済みの人がいなければ、全員の中から一番中央に近い人を選ぶ
             potentialTargets.forEach(p => {
                const centerX = p.detection.boundingBox.originX + p.detection.boundingBox.width / 2;
                const distance = Math.abs(centerX - this.video.videoWidth / 2);
                if (distance < minDistance) {
                    minDistance = distance;
                    bestTarget = p;
                }
            });
        }
        this.currentTarget = bestTarget;
    }


    onWavingStart() {
        console.log("Waving gesture detected!");
        if (this.currentTarget && !this.isWavingCoolDown) {
            this.isWavingCoolDown = true;
            
            // ★★★ ヘルパーメソッドを使って再生 ★★★
            this.playAvatarAction(this.ANIMATION_MAP.WAVE, 3000);

            // isWavingCoolDownの解除は別途管理
            setTimeout(() => {
                this.isWavingCoolDown = false;
            }, 5000); // アニメーション時間＋クールダウン時間
        }
    }
}

const controller = new MainController();
controller.run().catch(err => {
    console.error("Application failed to run.", err);
});