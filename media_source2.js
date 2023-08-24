// Copyright 2023 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class SourceBuffer2 {
  constructor(sourceBuffer) {
    this.sourceBuffer = sourceBuffer;
  }

  get sourceBuffer() {
    return this.sourceBuffer;
  }

  runEventLoop() {
    // Each updateend event allows a new operation to kick off.
  }

  setTimestampOffset(timestampOffset) {
    // Add operation.
  }

  setAppendWindow(appendWindowStart, appendWindowEnd) {
    // Add operation.
  }

  appendBuffer(data, signal) {
    // Add operation. Subscribe to abort signal to wire up abort().
  }

  remove(start, end) {
    // Add operation.
  }

  changeType(type) {
    // Add operation.
  }

  // Simple passthrough methods.
  audioTracks = this.sourceBuffer.audioTracks;
  videoTracks = this.sourceBuffer.videoTracks;
  buffered = this.sourceBuffer.buffered;
}

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
            op.resolve(new SourceBuffer2(sb));
            break;
          }

          case OperationType.REMOVE: {
            let sb = op.sourceBuffer.sourceBuffer();
            this.source.removeSourceBuffer(sb);
            op.resolve();
            break;
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
            break;
          }
        }
      } catch (e) {
        op.reject(e);
      }

      this.pendingOperations.shift();
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

  // Simple passthrough methods.
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
