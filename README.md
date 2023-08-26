# A modern MediaSource API based on promises.

This library aims to provide an experimental playground for what a promise based
MediaSource API could look like. It's a polyfill based on the current MSE API.

The modernized API removes events, rarely used features, and largely does away
with exceptions thrown from methods. Everything that depends on some event
having occurred is turned into a promise.

The intent is to be pretty radical at first and pare it down to a practical API,
so at this time more may have been removed than is practical.

The new IDL looks like this:

```WebIDL
interface MediaSource2 {
    constructor();

    Promise<SourceBuffer> addSourceBuffer(DOMString type);
    Promise<void> removeSourceBuffer(SourceBuffer buffer);
    Promise<void> endOfStream(optional EndOfStreamError error);
    Promise<void> setDuration(unrestricted double duration);

    [RaisesException] void setLiveSeekableRange(double start, double end);
    [RaisesException] void clearLiveSeekableRange();

    readonly attribute unrestricted double duration;

    static boolean isTypeSupported(DOMString type);
    static readonly attribute boolean canConstructInDedicatedWorker;
};

interface SourceBuffer {
    [RaisesException=Getter] readonly attribute TimeRanges buffered;
    readonly attribute AudioTrackList audioTracks;
    readonly attribute VideoTrackList videoTracks;

    Promise<void> appendBuffer(SharedBufferSource data);
    Promise<void> remove(double start, unrestricted double end);
    Promise<void> changeType(DOMString type);
    Promive<void> configure(SourceBufferOptions);

    [RaisesException] void abort();
};

dictionary SourceBufferOptions {
    AppendMode mode;
    double timestampOffset;
    double appendWindowStart;
    double appendWindowEnd;
};

```

These largely function as before except all promise based methods put a message
into a queue for processing; messages are processed in order.

The biggest changes that aren't promise related:
* `abort()` now purges the message queue in addition to resetting parser.
* `configure()` replaces individual setters for things which control `appendBuffer`.
* `duration` is now split into a readonly attribute and setter.

Using MediaSource for a simple case can look like this:
```JavaScript
let mediaSource2 = new MediaSource2();

let sourceBufferReady = mediaSource2.addSourceBuffer(type);

let signalQuotaReady = null;

fetch(resource).then(response => response.body).then(async rs => {
  let sourceBuffer = await sourceBufferReady;

  const reader = stream.getReader();
  while (true) {
    const {done, value} = await reader.read();
    if (value && value.length > 0) {
      while (true) {
        try {
          await sourceBuffer.appendBuffer(value);
          break;
        } catch(e) {
          if (e.name === 'QuotaExceededError') {
            let quotaAvailable = new Promise((resolve, _) => {
              signalQuotaReady = resolve;
            });
            await quotaAvailable;
          } else {
            throw e;
          }
        };
      }
    }

    if (done) {
      mediaSource.endOfStream();
      return;
    }
  }
});

video.addEventListener('timeupdate', async _ => {
  let sourceBuffer = await sourceBufferReady;
  if (video.currentTime - sourceBuffer.buffered.start(0) > 2 * gcInterval) {
    sourceBuffer.remove(0, video.currentTime - gcInterval).then(_ => {
      if (signalQuotaReady !== null) {
        signalQuotaReady();
        signalQuotaReady = null;
      }
    });
  }
});

video.src = window.URL.createObjectURL(mediaSource2.mediaSource);

```

## Open Questions
* Has too much been removed?
  * SourceBufferLists are removed, clients must track manually.
  * No error event on SourceBuffers, only available throw promise rejection and
  the error event already on the `HTMLMediaElement`.
* Is too much asynchronous now?
  * `addSourceBuffer` / `removeSourceBuffer` could be synchronous if some sort
  of class level Promise like `MediaSource2.ready` was added.
  * `configure()` offers no getters for the timestamp offset or append window,
  which may be needed in some cases?
* duration setting isn't supported since some UA will trigger the removal
  algorithm even though that's no longer spec compliant.
