// Copyright 2023 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

const SourceBufferOperationTypes = {
  CONFIGURE: 0,
  APPEND: 2,
  REMOVE: 3,
  CHANGE_TYPE: 4,
};

class SourceBuffer2 {
  #currentOperation;
  #errorEvent;
  #sourceBuffer;
  #pendingOperations;

  constructor(sb) {
    this.#sourceBuffer = sb;
    this.#sourceBuffer.addEventListener('error', e => {
      this.#errorEvent = e;
      this.#runEventLoop();
    });
    this.#pendingOperations = [];
  }

  // Would be nice to hide this, but it's needed for removeSourceBuffer().
  get sourceBuffer() {
    return this.#sourceBuffer;
  }

  #runEventLoop() {
    while (this.#pendingOperations.length > 0) {
      if (this.#errorEvent) {
        if (this.#currentOperation)
          this.currentOperation.reject(this.#errorEvent);
        let op = this.#pendingOperations.shift();
        op.reject(this.#errorEvent);
        continue;
      }

      if (this.#currentOperation) {
        return;
      }

      if (this.#sourceBuffer.updating) {
        let op = this.#pendingOperations.shift();
        op.reject(new DOMException(
            'External source of updates detected.', 'InvalidStateError'));
        return;
      }

      // If readyState is closed or ended, the operations below will throw.
      let op = this.#pendingOperations.shift();
      try {
        switch (op.operationType) {
          case SourceBufferOperationTypes.APPEND: {
            this.#sourceBuffer.addEventListener('updateend', _ => {
              this.#currentOperation = null;
              op.resolve();
              this.#runEventLoop();
            }, {once: true});
            this.#sourceBuffer.appendBuffer(op.buffer);
            this.#currentOperation = op;
            break;
          }

          case SourceBufferOperationTypes.REMOVE: {
            this.#sourceBuffer.addEventListener('updateend', _ => {
              this.#currentOperation = null;
              op.resolve();
              this.#runEventLoop();
            }, {once: true});
            this.#sourceBuffer.remove(op.start, op.end);
            this.#currentOperation = op;
            break;
          }

          case SourceBufferOperationTypes.CONFIGURE: {
            if ('timestampOffset' in op.options) {
              this.#sourceBuffer.timestampOffset =
                  op.options['timestampOffset'];
            }
            if ('appendWindowStart' in op.options) {
              this.#sourceBuffer.appendWindowStart =
                  op.options['appendWindowStart'];
            }
            if ('appendWindowEnd' in op.options) {
              this.#sourceBuffer.appendWindowEnd =
                  op.options['appendWindowEnd'];
            }
            if ('mode' in op.options) {
              this.#sourceBuffer.mode = op.options['mode'];
            }
            op.resolve();
            break;
          }

          case SourceBufferOperationTypes.CHANGE_TYPE: {
            this.#sourceBuffer.changeType(op.sourceBufferType);
            op.resolve();
            break;
          }
        }
      } catch (e) {
        op.reject(e);
      }
    }
  }

  // {timestampOffset:, mode:, appendWindowStart:, appendWindowEnd:}
  configure(configureOptions) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: SourceBufferOperationTypes.CONFIGURE,
        options: configureOptions,
      });
      this.#runEventLoop();
    });
  }

  appendBuffer(data) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: SourceBufferOperationTypes.APPEND,
        buffer: data,
      });
      this.#runEventLoop();
    });
  }

  remove(startRange, endRange) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: SourceBufferOperationTypes.REMOVE,
        start: startRange,
        end: endRange,
      });
      this.#runEventLoop();
    });
  }

  changeType(type) {
    return new Promise((resolvePromise, rejectPromise) => {
      this.#pendingOperations.push({
        resolve: resolvePromise,
        reject: rejectPromise,
        operationType: SourceBufferOperationTypes.CHANGE_TYPE,
        sourceBufferType: type,
      });
      this.#runEventLoop();
    });
  }

  async abort() {
    // Invalid state for calling abort(), so let underlying SB throw.
    if (this.#errorEvent) {
      this.#sourceBuffer.abort();
      return;
    }

    this.#errorEvent = new DOMException('abort() called', 'AbortError');
    this.#runEventLoop();
    this.#sourceBuffer.abort();
    this.#errorEvent = null;
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
    }, {once: true});
    this.#source.addEventListener('sourceclose', _ => {
      this.#runEventLoop();
    });
    this.#pendingOperations = [];
  }

  // It'd be better if we could only expose only `handle()`, but unfortunately
  // that doesn't yet work with non-worker mse.
  get mediaSource() {
    return this.#source;
  }

  #runEventLoop() {
    while (this.#pendingOperations.length > 0) {
      if (this.#source.readyState == 'closed' && !this.#opened) {
        // Waiting for the source to be connected to an element.
        return;
      }

      // If readyState is closed or ended, the operations below will throw.
      let op = this.#pendingOperations[0];
      try {
        switch (op.operationType) {
          case MediaSourceOperationTypes.ADD: {
            let sb = this.#source.addSourceBuffer(op.sourceBufferType);
            op.resolve(new SourceBuffer2(sb));
            break;
          }

          case MediaSourceOperationTypes.REMOVE: {
            let sb = op.sourceBuffer.sourceBuffer;
            this.#source.removeSourceBuffer(sb);
            op.resolve();
            break;
          }

          case MediaSourceOperationTypes.MARK_EOS: {
            for (let i = 0; i < this.#source.sourceBuffers.length; ++i) {
              let sb = this.#source.sourceBuffers[i];
              if (sb.updating) {
                sb.addEventListener('updateend', _ => {
                  this.#runEventLoop();
                }, {once: true});
                return;
              }
            }

            this.#source.addEventListener('sourceended', _ => {
              op.resolve();
            }, {once: true});
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
  static canConstructInDedicatedWorker =
      MediaSource.canConstructInDedicatedWorker;
};
