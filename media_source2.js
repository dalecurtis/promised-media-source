// Copyright 2023 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const OperationType = {
    ADD: 0,
    REMOVE: 1,
    MARK_EOS: 2,
};

class MediaSource2 {
    constructor() {
        this.opened = false;
        this.source = new MediaSource();
        this.source.addEventListener('sourceopen', _ => {
            this.opened = true;
            this.runEventLoop();
        }, { once: true });
        // FIXME: Subscribe to sourceended, sourceclose.

        this.pendingOperations = [];
    }

    // It'd be better if we could only expose only `handle()`, but unfortunately that
    // doesn't yet work with non-worker mse.
    get mediaSource() {
        return this.source;
    }

    runEventLoop() {
        while (!this.pendingOperations.empty()) {
            if (this.source.readyState == 'closed' && !this.opened) {
                // Waiting for the source to be connected to an element.
                return;
            }

            // If readyState is closed or ended, the operations below will throw exceptions.
            try {
                let op = this.pendingOperations[0];
                switch (op.operationType) {
                    case OperationType.ADD: {
                        let sb = this.source.addSourceBuffer(op.sourceBufferType);
                        this.pendingOperations.shift();
                        op.resolve(new SourceBuffer2(sb));
                        return;
                    }

                    case OperationType.REMOVE: {
                        let sb = op.sourceBuffer.sourceBuffer();
                        this.source.removeSourceBuffer(sb);
                        this.pendingOperations.shift();
                        op.resolve();
                        return;
                    }

                    case OperationType.MARK_EOS: {
                        for (let i = 0; i < this.source.sourceBuffers.length; ++i) {
                            let sb = this.source.sourceBuffers[i];
                            if (sb.updating) {
                                sb.addEventListener('updateend', _ => {
                                    this.runEventLoop();
                                }, { once: true });
                                return;
                            }
                        }

                        this.source.addEventListener('sourceend', _ => {
                            op.resolve();
                        }, { once: true });
                        this.pendingOperations.shift();
                        this.source.endOfStream(op.error);
                        return;               
                    }
                }
            } catch (e) {
                op.resolver[1](e);
            }
        }
    }

    addSourceBuffer(type) {
        return new Promise((resolvePromise, rejectPromise) => {
            this.pendingOperation.push({
                resolve: resolvePromise,
                reject: rejectPromise,
                operationType: OperationType.ADD,
                sourceBufferType: type,
            });
            this.runEventLoop();
        });
    }

    removeSourceBuffer(sb) {
        return new Promise((resolvePromise, rejectPromise) => {
            this.pendingOperation.push({
                resolve: resolvePromise,
                reject: rejectPromise,
                operationType: OperationType.REMOVE,
                sourceBuffer: sb,
            });
            this.runEventLoop();
        });
    }

    setEndOfStream(error) {
        return new Promise((resolvePromise, rejectPromise) => {
            this.pendingOperation.push({
                resolve: resolvePromise,
                reject: rejectPromise,
                operationType: OperationType.MARK_EOS,
                error: error,
            });
            this.runEventLoop();
        });        
    }

    // Simple passthrough methods below.
    setLiveSeekableRange(start, end) {
        return this.setLiveSeekableRange(start, end);
    }
    clearLiveSeekableRange() {
        return this.clearLiveSeekableRange();
    }
    static isTypeSupported(type) {
        return MediaSource.isTypeSupported(type);
    }
    static canConstructInDedicatedWorker = MediaSource.canConstructInDedicatedWorker;
};
