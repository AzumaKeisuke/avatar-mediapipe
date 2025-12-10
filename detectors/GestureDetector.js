import { GestureRecognizer, DrawingUtils } from '@mediapipe/tasks-vision';

// 手を振る動作を判定するロジック
class WaveDetector {
    constructor() {
        this.handHistory = new Map();
        this.waveTimestamps = new Map();
        this.config = {
            historyLength: 60,
            minAmplitude: 0.05,
            minCrossings: 3,
            waveDuration: 1500,
        };
    }
    update(handId, landmarks) {
        if (!landmarks || landmarks.length === 0) { 
            this.clearHand(handId); 
            return false; 
        }
        if (!this.handHistory.has(handId)) { 
            this.handHistory.set(handId, []); 
        }
        const history = this.handHistory.get(handId);
        //history.push({ x: landmarks[0].x, timestamp: Date.now() }); //手首
        history.push({ x: landmarks[9].x, timestamp: Date.now() }); //中指
        while (history.length > this.config.historyLength) { history.shift(); }
        if (history.length < this.config.historyLength / 2) { 
            return this.isWaving(handId); 
        }
        if (this.detectOscillation(history)) { 
            this.waveTimestamps.set(handId, Date.now()); 
        }
        return this.isWaving(handId);
    }
    detectOscillation(history) {
        const xCoords = history.map(p => p.x);
        const minX = Math.min(...xCoords);
        const maxX = Math.max(...xCoords);
        const amplitude = maxX - minX;
        if (amplitude < this.config.minAmplitude) return false;
        const meanX = xCoords.reduce((sum, x) => sum + x, 0) / xCoords.length;
        let crossings = 0;
        for (let i = 1; i < history.length; i++) {
            if ((history[i - 1].x - meanX) * (history[i].x - meanX) < 0) { 
                crossings++; 
            }
        }
        return crossings >= this.config.minCrossings;
    }
    isWaving(handId) {
        const lastTimestamp = this.waveTimestamps.get(handId);
        if (!lastTimestamp) return false;
        return (Date.now() - lastTimestamp) < this.config.waveDuration;
    }
    clearHand(handId) { 
        this.handHistory.delete(handId); 
        this.waveTimestamps.delete(handId); 
    }
}

export class GestureDetectorModule {
    constructor() {
        this.gestureRecognizer = null;
        this.waveDetector = new WaveDetector();
        this.lastResults = null;
        
        this.isWaving = false;
        this.isRunning = false;
        this.videoElement = null;
        this.frameSkip = 1; // デフォルト: 全フレーム推論
        this.frameCount = 0;

        this.eventListeners = {
            wavingStart: []
        };
    }

    on(eventName, callback) {
        if (this.eventListeners[eventName]) {
            this.eventListeners[eventName].push(callback);
        }
    }

    emit(eventName, data) {
        if (this.eventListeners[eventName]) {
            this.eventListeners[eventName].forEach(callback => callback(data));
        }
    }

    async init(videoElement, vision) {
        this.videoElement = videoElement;
        this.gestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numHands: 2
        });
    }

    start() {
        if (this.isRunning || !this.gestureRecognizer) return;
        this.isRunning = true;
        this.frameCount = 0;
        this.detectLoop();
    }

    stop() {
        this.isRunning = false;
        this.lastResults = null;
        this.isWaving = false;
    }

    detectLoop() {
        if (!this.isRunning) return;

        // videoサイズ未確定ならスキップ
        if (!this.videoElement || this.videoElement.videoWidth === 0 || this.videoElement.videoHeight === 0) {
            requestAnimationFrame(this.detectLoop.bind(this));
            return;
        }

        this.frameCount++;
        let doInference = false;

        // 初回は必ず推論
        if (this.frameCount === 1 || this.frameCount % this.frameSkip === 0) {
            doInference = true;
        }

        if (doInference) {
            const timestamp = performance.now();
            const results = this.gestureRecognizer.recognizeForVideo(this.videoElement, timestamp);
            if (results) {
                this.lastResults = results;
            }
        }

        // --- 推論結果があれば毎フレーム処理 ---
        if (this.lastResults) {
            const wasWaving = this.isWaving;
            let overallWaving = false;
            const detectedHandIds = new Set();

            if (this.lastResults.landmarks.length > 0) {
                for (let i = 0; i < this.lastResults.landmarks.length; i++) {
                    const handId = this.lastResults.handedness[i][0].categoryName;
                    detectedHandIds.add(handId);
                    const handGesture = this.lastResults.gestures[i][0];

                    if (handGesture.categoryName === 'Open_Palm' && handGesture.score > 0.3) {
                        this.waveDetector.update(handId, this.lastResults.landmarks[i]);
                    } else {
                        this.waveDetector.clearHand(handId);
                    }
                    if (this.waveDetector.isWaving(handId)) {
                        overallWaving = true;
                    }
                }
            }
            // 検出されなくなった手を履歴から削除
            for (const handId of this.waveDetector.handHistory.keys()) {
                if (!detectedHandIds.has(handId)) {
                    this.waveDetector.clearHand(handId);
                }
            }
            this.isWaving = overallWaving;

            if (this.isWaving && !wasWaving) {
                this.emit('wavingStart');
            }
        }

        requestAnimationFrame(this.detectLoop.bind(this));
    }

    draw(canvasCtx) {
        if (!this.isRunning || !this.lastResults || !this.lastResults.landmarks) return;
        const drawingUtils = new DrawingUtils(canvasCtx);
        for (const landmarks of this.lastResults.landmarks) {
            drawingUtils.drawConnectors(landmarks, GestureRecognizer.HAND_CONNECTIONS, { color: '#FFFFFF', lineWidth: 3 });
            drawingUtils.drawLandmarks(landmarks, { color: '#E6E6FA', radius: 3 });
        }
    }
}
