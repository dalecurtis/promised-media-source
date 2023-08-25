const QueryString = function() {
  // Allows access to query parameters on the URL; e.g., given a URL like:
  //    http://<server>/my.html?test=123&bob=123
  // Parameters can then be accessed via QueryString.test or QueryString.bob.
  let params = {};

  // RegEx to split out values by & || ;.
  const r = /([^&;=]+)=?([^&;]*)/g;

  // Lambda function for decoding extracted match values. Replaces '+' with
  // space so decodeURIComponent functions properly.
  let decode = s => {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  };

  var match;
  while (match = r.exec(window.location.search.substring(1)))
    params[decode(match[1])] = decode(match[2]);
  return params;
}();

var appendsComplete = false;
var signalQuotaReady = null;

const COMMAND_MAP = {
  'abort': 'Integer number of appends before calling SourceBuffer.abort()',
  'gc': 'Integer number of seconds to remove (should be keyframe distance) ' +
      'after double that amount of time elapses',
  'type': 'One of the types from the table below',
  'remove': 'Remove the source buffer upon end of stream'
};

const TYPE_MAP = {
  'mp4': 'video/mp4; codecs="avc1.4D4041,mp4a.40.2"',
  'webm': 'video/webm; codecs="opus,vp9"',
  'mp3': 'audio/mpeg',
  'mp4a': 'audio/mp4; codecs="mp4a.40.2',
  'mp4v': 'video/mp4; codecs="avc1.4D4041',
  'mp4_av1': 'video/mp4; codecs="av01.0.04M.08',
  'webm_av1': 'video/webm; codecs="av1',
  'webm_vp8': 'video/webm; codecs="vp8, vorbis"',
  'webm_vp9': 'video/webm; codecs="vp9"',
  'opus': 'audio/webm; codecs="opus"',
  'mp4_opus': 'audio/mp4; codecs="opus"',
  'wav': 'audio/wav',
};

async function processFetch(stream, mediaSource, sourceBuffer) {
  const reader = stream.getReader();
  let appendCount = 0;
  while (true) {
    let {done, value} = await reader.read();
    if (value && value.length > 0) {
      while (true) {
        try {
          await sourceBuffer.appendBuffer(value);
          break;
        } catch (e) {
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

    if (++appendCount >= parseInt(QueryString.abort)) {
      console.log('SourceBuffer aborted.');
      sourceBuffer.abort();
      sourceBuffer.configure(
          {timestampOffset: 0, appendWindowStart: 0, appenWindowEnd: Infinity});
      done = true;
    }

    if (done) {
      mediaSource.endOfStream().then(_ => {
        appendsComplete = true;
      })
      break;
    }
  }
}

function buildHelpTables() {
  let cmdHtml = '';
  for (let key in COMMAND_MAP) {
    cmdHtml += '<tr><td>' + key + '</td><td>' + COMMAND_MAP[key] + '</td></tr>';
  }
  let commands = document.getElementById('commandList');
  commands.innerHTML = cmdHtml;

  let typeHtml = '';
  for (let key in TYPE_MAP) {
    typeHtml += '<tr><td>' + key + '</td><td>' + TYPE_MAP[key] + '</td></tr>';
  }
  let types = document.getElementById('typeList');
  types.innerHTML = typeHtml;
}

document.addEventListener('DOMContentLoaded', _ => {
  buildHelpTables();

  if (!QueryString.type || !QueryString.type in TYPE_MAP) {
    console.log('Error: No recognized type specified.');
    return;
  }

  let mediaSource2 = new MediaSource2();
  let sbReady = mediaSource2.addSourceBuffer(TYPE_MAP[QueryString.type]);
  fetch(QueryString.src).then(response => response.body).then(async rs => {
    let sourceBuffer = await sbReady;
    processFetch(rs, mediaSource2, sourceBuffer);
  });

  let video = document.querySelector('video');

  if (QueryString.gc) {
    let keyframeInterval = parseInt(QueryString.gc);
    video.addEventListener('timeupdate', async _ => {
      let sourceBuffer = await sbReady;
      if (video.currentTime - sourceBuffer.buffered.start(0) >
          2 * keyframeInterval) {
        sourceBuffer.remove(0, video.currentTime - keyframeInterval).then(_ => {
          if (appendsComplete) {
            mediaSource2.endOfStream();
          }
          if (signalQuotaReady !== null) {
            signalQuotaReady();
            signalQuotaReady = null;
          }
        });
      }
    });
  }

  if (QueryString.remove) {
    video.addEventListener('ended', async _ => {
      let sourceBuffer = await sbReady;
      mediaSource2.removeSourceBuffer(sourceBuffer).then(_ => {
        console.log('SourceBuffer removed.');
      });
    }, {once: true});
  }

  video.src = window.URL.createObjectURL(mediaSource2.mediaSource);
}, {once: true});
