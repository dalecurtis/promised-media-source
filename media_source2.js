// Copyright 2023 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

class SourceBuffer2 {
  #sourceBuffer;

  constructor(sb) {
    this.#sourceBuffer = sb;
  }

  get sourceBuffer() {
    return this.#sourceBuffer;
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
  get audioTracks() {
    return this.#sourceBuffer.audioTracks;
  }
  get videoTracks() {
    return this.#sourceBuffer.videoTracks;
  }
  get buffered() {
    return this.#sourceBuffer.buffered;
  }
}

const MediaSourceOperationTypes = {
  ADD: 0,
  REMOVE: 1,
  MARK_EOS: 2,
};

class MediaSource2 {
  #opened;
  #source;
  #pendingOperations;

  constructor() {
    this.#opened = false;
    this.#source = new MediaSource();
    this.#source.addEventListener('sourceopen', _ => {
      this.#opened = true;
      this.#runEventLoop();
    }, { once: true });
    this.#pendingOperations = [];
  }

  // It'd be better if we could only expose only `handle()`, but unfortunately that
  // doesn't yet work with non-worker mse.
  get mediaSource() {
    return this.#source;
  }

  #runEventLoop() {
    while (this.#pendingOperations.length > 0) {
      if (this.#source.readyState == 'closed' && !this.#opened) {
        // Waiting for the source to be connected to an element.
        return;
      }

      // If readyState is closed or ended, the operations below will throw exceptions.
      let op = this.#pendingOperations[0];
      console.log('runEventLoop: ' + op.operationType);
      try {
        switch (op.operationType) {
          case MediaSourceOperationTypes.ADD: {
            let sb = this.#source.addSourceBuffer(op.sourceBufferType);
            op.resolve(new SourceBuffer2(sb));
            break;
          }

          case MediaSourceOperationTypes.REMOVE: {
            let sb = op.sourceBuffer.sourceBuffer();
            this.source.removeSourceBuffer(sb);
            op.resolve();
            break;
          }

          case MediaSourceOperationTypes.MARK_EOS: {
            for (let i = 0; i < this.#source.sourceBuffers.length; ++i) {
              let sb = this.#source.sourceBuffers[i];
              if (sb.updating) {
                sb.addEventListener('updateend', _ => {
                  this.#runEventLoop();
                }, { once: true });
                return;
              }
            }

            this.#source.addEventListener('sourceend', _ => {
              op.resolve();
            }, { once: true });
            this.#pendingOperations.shift();
            this.#source.endOfStream(op.error);
            break;
          }
        }
      } catch (e) {
        op.reject(e);
      }

      this.#pendingOperations.shift();
    }
  }

  addSourceBuffer(type) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: MediaSourceOperationTypes.ADD,
        sourceBufferType: type,
      });
      this.#runEventLoop();
    });
  }

  removeSourceBuffer(sb) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: MediaSourceOperationTypes.REMOVE,
        sourceBuffer: sb,
      });
      this.#runEventLoop();
    });
  }

  endOfStream(error) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: MediaSourceOperationTypes.MARK_EOS,
        error: error,
      });
      this.#runEventLoop();
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
