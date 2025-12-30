/*
aiff.js - a javascript library for reading AIFF files
Based on the AIFF specification.
*/

function aiff(file) {
  this.EMPTY = 0;
  this.LOADING = 1;
  this.DONE = 2;
  this.UNSUPPORTED_FORMAT = 3;
  this.readyState = this.EMPTY;
  this.error = undefined;

  this.file = file instanceof Blob ? file : undefined;
  this.buffer = file instanceof ArrayBuffer ? file : undefined;

  this.chunkID = undefined; // FORM
  this.chunkSize = undefined;
  this.format = undefined; // AIFF or AIFC
  this.numChannels = undefined;
  this.numSampleFrames = undefined;
  this.sampleSize = undefined;
  this.sampleRate = undefined;

  this.dataOffset = -1;
  this.dataLength = -1;

  this.peek();
}

aiff.prototype.peek = function () {
  this.readyState = this.LOADING;
  if (this.buffer !== undefined) {
    return this.parseArrayBuffer();
  }
  var reader = new FileReader();
  var that = this;
  var headerBlob = this.file.slice(0, 4096);
  reader.readAsArrayBuffer(headerBlob);
  reader.onloadend = function () {
    that.buffer = this.result;
    that.parseArrayBuffer.apply(that);
  };
};

aiff.prototype.parseArrayBuffer = function () {
  try {
    this.parseHeader();
    this.parseChunks();
    this.readyState = this.DONE;
  } catch (e) {
    this.readyState = this.UNSUPPORTED_FORMAT;
    this.error = e;
  }
  if (this.onloadend) {
    this.onloadend.apply(this);
  }
};

aiff.prototype.parseHeader = function () {
  this.chunkID = this.readText(0, 4);
  this.chunkSize = this.readDecimal(4, 4);
  if (this.chunkID !== 'FORM') throw 'NOT_A_FORM_FILE';

  this.format = this.readText(8, 4);
  if (this.format !== 'AIFF' && this.format !== 'AIFC') throw 'NOT_SUPPORTED_FORMAT';
};

aiff.prototype.parseChunks = function () {
  var offset = 12;
  while (offset < this.buffer.byteLength - 8) {
    var chunkType = this.readText(offset, 4);
    var chunkSize = this.readDecimal(offset + 4, 4);
    if (chunkType === 'COMM') {
      this.parseCommChunk(offset + 8);
    } else if (chunkType === 'SSND') {
      this.dataOffset = offset + 8 + 8; // Skip SSND header (8 bytes: 4 offset, 4 blocksize)
      this.dataLength = chunkSize - 8;
    }
    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++;
  }
  if (this.numChannels === undefined) throw 'NO_COMM_CHUNK';
  if (this.dataOffset === -1) throw 'NO_SSND_CHUNK';
};

aiff.prototype.parseCommChunk = function (offset) {
  this.numChannels = this.readDecimal(offset, 2);
  this.numSampleFrames = this.readDecimal(offset + 2, 4);
  this.sampleSize = this.readDecimal(offset + 6, 2);
  this.sampleRate = this.read80BitFloat(offset + 8);
};

aiff.prototype.read80BitFloat = function (offset) {
  var view = new DataView(this.buffer, offset, 10);
  var exponent = view.getUint16(0) & 0x7FFF;
  var hi = view.getUint32(2);
  var lo = view.getUint32(6);

  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  if (exponent === 0x7FFF) return Infinity;

  var mantissa = hi * Math.pow(2, -31) + lo * Math.pow(2, -63);
  return mantissa * Math.pow(2, exponent - 16383);
};

aiff.prototype.readText = function (start, length) {
  var a = new Uint8Array(this.buffer, start, length);
  var str = '';
  for (var i = 0; i < a.length; i++) {
    str += String.fromCharCode(a[i]);
  }
  return str;
};

aiff.prototype.readDecimal = function (start, length) {
  var view = new DataView(this.buffer, start, length);
  if (length === 2) return view.getUint16(0, false);
  if (length === 4) return view.getUint32(0, false);
  return 0;
};

