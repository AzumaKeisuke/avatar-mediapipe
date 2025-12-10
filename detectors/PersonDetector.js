import { FaceDetector, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

export class PersonDetector {
    constructor() {
        this.faceDetector = null;
        this.videoElement = null;
        this.isRunning = false;
        this.eventListeners = {
            // 'personEnter' と 'personLeave' の代わりに detectionsUpdated を使う
            detectionsUpdated: []
        };
        this.personDetected = false;
        this.lastDetections = null; // ★ 検出結果を保持するプロパティ

        this.frameSkip = 2; // 2なら「2フレームに1回」判定 (間引き率)
        this.frameCount = 0;
    }

    // ★★★ initメソッドを修正 ★★★
    async init(videoElement, vision) { // visionを引数で受け取る
        this.videoElement = videoElement;
        
        // FilesetResolverの呼び出しを削除
        // const vision = await FilesetResolver.forVisionTasks(...);

        this.faceDetector = await FaceDetector.createFromOptions(vision, { // 受け取ったvisionを使う
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            minDetectionConfidence: 0.6
        });
    }

    start() {
        if (this.isRunning || !this.faceDetector) return;
        this.isRunning = true;
        this.detectLoop();
    }

    stop() {
        this.isRunning = false;
        // 停止時に状態をリセット
        this.lastDetections = null;
        this.personDetected = false;
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

    detectLoop() {
        if (!this.isRunning) return;

        this.frameCount++;
        if (this.frameCount % this.frameSkip === 0) {
            this.lastDetections = this.faceDetector.detectForVideo(
                this.videoElement,
                performance.now()
            );

            // ★★★ ここを修正 ★★★
            if (this.lastDetections) {
                // 検出結果の配列をそのままイベントで渡す
                this.emit('detectionsUpdated', this.lastDetections.detections);
            }
        }
        requestAnimationFrame(this.detectLoop.bind(this));
    }

    // ★★★ 描画メソッドを追加 ★★★
    draw(canvasCtx) {
        if (!this.lastDetections || !this.lastDetections.detections) return;

        const drawingUtils = new DrawingUtils(canvasCtx);
        for (const detection of this.lastDetections.detections) {
            // 青い四角でバウンディングボックスを描画
            drawingUtils.drawBoundingBox(detection.boundingBox, { 
                color: "#00BFFF", 
                lineWidth: 2, 
                fillColor: 'transparent' 
            });
        }
    }
}
