/*

wav.js - a javascript audiolib for reading WAVE files

Reads the Format chunk of a WAV file using the RIFF specification.

Supports uncompressed PCM and various compressed formats.
Only supports one Data chunk.

NOTE: Does not auto-correct:
 - Incorrect block alignment values
 - Incorrect Average Samples Per Second value
 - Missing word alignment padding

@author  David Lindkvist, Greg Simon (supporting compressed formats)
@twitter ffdead

*/

// Compression format constants
var WAV_COMPRESSION = {
  PCM: 1,
  MS_ADPCM: 2,
  IMA_ADPCM: 17,
  DVI_ADPCM: 6,
  ALAW: 7,
  MULAW: 8,
  MP3: 85,
  GSM: 49,
  G721_ADPCM: 20,
  G723_ADPCM: 24,
  G726_ADPCM: 27,
  G729_ADPCM: 28
};


/**
 * Constructor: Parse Format chunk of WAV files.
 * 
 * Fires onloadend() function after successful load.
 *
 * @param {File|Blob|ArrayBuffer} RIFF formatted WAV file
 */
function wav(file) {

  // status
  this.EMPTY              = 0; //  No data has been loaded yet.
  this.LOADING            = 1; // Data is currently being loaded.
  this.DONE               = 2; // The entire read request has been completed.
  this.UNSUPPORTED_FORMAT = 3; // Error state - file format not recognized
  this.readyState         = this.EMPTY;
  this.error              = undefined;
  
  // original File and loaded ArrayBuffer
  this.file          = file instanceof Blob ? file : undefined;
  this.buffer        = file instanceof ArrayBuffer ? file : undefined;
  
  // format
  this.chunkID       = undefined; // must be RIFF
  this.chunkSize     = undefined; // size of file after this field
  this.format        = undefined; // must be WAVE
  this.compression   = undefined; // 1=PCM, 2=MS_ADPCM, etc.
  this.numChannels   = undefined; // Mono = 1, Stereo = 2
  this.sampleRate    = undefined; // 8000, 44100, etc.
  this.byteRate      = undefined; // bytes per second
  this.blockAlign    = undefined; // number of bytes for one sample including all channels.
  this.bitsPerSample = undefined; // 8 bits = 8, 16 bits = 16, etc.
  
  // compression-specific properties
  this.formatChunkSize = undefined; // size of format chunk
  this.extraFormatBytes = undefined; // extra bytes in format chunk
  this.samplesPerBlock = undefined; // for ADPCM formats
  this.coefficients = undefined; // for MS_ADPCM
  
  // data chunk
  this.dataOffset    = -1; // index of data block
  this.dataLength    = -1; // size of data block
  
  // let's take a peek
  this.peek();
}

/**
 * Load header as an ArrayBuffer and parse format chunks
 */
wav.prototype.peek = function () {
  
  this.readyState = this.LOADING;

  // see if buffer is already loaded
  if (this.buffer !== undefined) {
    return this.parseArrayBuffer();
  }
  
  var reader = new FileReader();
  var that = this;
  
  // Load more bytes for compressed formats that may have larger format chunks
  var headerBlob = this.sliceFile(0, 128);
  reader.readAsArrayBuffer(headerBlob);
  
  reader.onloadend = function() {  
    that.buffer = this.result;
    that.parseArrayBuffer.apply(that);
  };
};

wav.prototype.parseArrayBuffer = function () {
  try {
    this.parseHeader();
    this.parseData();
    this.readyState = this.DONE;
  }
  catch (e) {
    this.readyState = this.UNSUPPORTED_FORMAT;
    this.error      = e;
  } 
     
  // trigger onloadend callback if exists
  if (this.onloadend) {
    this.onloadend.apply(this);
  }
};
  
/**
 * Walk through RIFF and WAVE format chunk
 * Based on https://ccrma.stanford.edu/courses/422/projects/WaveFormat/
 * and http://www.sonicspot.com/guide/wavefiles.html
 */
wav.prototype.parseHeader = function () {
   
  this.chunkID       = this.readText(0, 4);
  this.chunkSize     = this.readDecimal(4, 4);
  if (this.chunkID !== 'RIFF') throw 'NOT_SUPPORTED_FORMAT';
    
  this.format        = this.readText(8, 4);
  if (this.format !== 'WAVE') throw 'NOT_SUPPORTED_FORMAT';
  
  // Find and parse the fmt chunk
  this.parseFormatChunk();
};

/**
 * Find and parse the format chunk
 */
wav.prototype.parseFormatChunk = function () {
  var offset = 12; // Start after RIFF header (12 bytes)
  
  // Skip the WAVE identifier
  offset += 4;
  
  // Look for the fmt chunk
  while (offset < this.buffer.byteLength - 8) {
    var chunkType = this.readText(offset, 4);
    var chunkSize = this.readDecimal(offset + 4, 4);
    
    if (chunkType === 'fmt ') {
      // Found the format chunk, parse it
      this.formatChunkSize = chunkSize;
      this.parseFormatChunkData(offset + 8, chunkSize);
      return;
    }
    else {
      // Skip this chunk and continue
      offset += 8 + chunkSize;
      // Handle word alignment padding
      if (chunkSize % 2 !== 0) {
        offset += 1;
      }
    }
  }
  
  // If we get here, no fmt chunk was found
  throw 'NO_FORMAT_CHUNK_FOUND: could not locate fmt chunk in WAV file';
};

/**
 * Parse the format chunk data
 */
wav.prototype.parseFormatChunkData = function (offset, chunkSize) {
  // Read format information from the fmt chunk
  this.compression   = this.readDecimal(offset, 2); 
  this.numChannels   = this.readDecimal(offset + 2, 2); 
  this.sampleRate    = this.readDecimal(offset + 4, 4); 

  // == SampleRate * NumChannels * BitsPerSample/8
  this.byteRate      = this.readDecimal(offset + 8, 4); 
  
  // == NumChannels * BitsPerSample/8
  this.blockAlign    = this.readDecimal(offset + 12, 2); 

  this.bitsPerSample = this.readDecimal(offset + 14, 2);
  
  // Handle compressed formats with additional parameters
  this.extraFormatBytes = chunkSize - 16; // Standard format chunk is 16 bytes
  
  if (this.extraFormatBytes > 0) {
    this.parseCompressionSpecificData(offset + 16);
  }
};

/**
 * Walk through all subchunks and look for the Data chunk
 */
wav.prototype.parseData = function () {
  var offset = 12; // Start after RIFF header (12 bytes)
  
  // Skip the WAVE identifier
  offset += 4;
  
  // Iterate through chunks until we find the data chunk
  while (offset < this.buffer.byteLength - 8) {
    var chunkType = this.readText(offset, 4);
    var chunkSize = this.readDecimal(offset + 4, 4);
    
    if (chunkType === 'data') {
      this.dataLength = chunkSize;
      this.dataOffset = offset + 8; // Skip chunk header
      return;
    }
    else if (chunkType === 'fmt ') {
      // Skip fmt chunk and continue
      offset += 8 + chunkSize;
      // Handle word alignment padding
      if (chunkSize % 2 !== 0) {
        offset += 1;
      }
    }
    else {
      // Skip unknown chunk and continue
      offset += 8 + chunkSize;
      // Handle word alignment padding
      if (chunkSize % 2 !== 0) {
        offset += 1;
      }
    }
  }
  
  // If we get here, no data chunk was found
  throw 'NO_DATA_CHUNK_FOUND: could not locate data chunk in WAV file';
};

/**
 * Parse compression-specific data in the format chunk
 */
wav.prototype.parseCompressionSpecificData = function (offset) {
  // offset should point to the start of compression-specific data
  
  switch (this.compression) {
    case WAV_COMPRESSION.MS_ADPCM:
      // MS ADPCM has samples per block and coefficients
      this.samplesPerBlock = this.readDecimal(offset, 2);
      this.coefficients = [];
      for (var i = 0; i < 7; i++) {
        this.coefficients.push({
          predictor: this.readDecimal(offset + 2 + i * 4, 2),
          delta: this.readDecimal(offset + 4 + i * 4, 2)
        });
      }
      break;
      
    case WAV_COMPRESSION.IMA_ADPCM:
      // IMA ADPCM has samples per block
      this.samplesPerBlock = this.readDecimal(offset, 2);
      break;
      
    case WAV_COMPRESSION.DVI_ADPCM:
      // DVI ADPCM has samples per block
      this.samplesPerBlock = this.readDecimal(offset, 2);
      break;
      
    case WAV_COMPRESSION.MP3:
      // MP3 has ID and flags
      this.mp3Id = this.readDecimal(offset, 2);
      this.mp3Flags = this.readDecimal(offset + 2, 2);
      this.mp3BlockSize = this.readDecimal(offset + 4, 2);
      this.mp3FramesPerBlock = this.readDecimal(offset + 6, 2);
      this.mp3CodecDelay = this.readDecimal(offset + 8, 2);
      break;
      
    case WAV_COMPRESSION.GSM:
      // GSM has samples per block
      this.samplesPerBlock = this.readDecimal(offset, 2);
      break;
      
    default:
      // For other compressed formats, just skip the extra bytes
      break;
  }
};


/**
 * Returns slice of file as new wav file
 * @param {int} start  Start offset in seconds from beginning of file
 * @param {int} end    Length of requested slice in seconds
 */
wav.prototype.slice = function (start, length, callback) {
  
  // Check if this compression format supports slicing
  if (!this.supportsSlicing()) {
    throw 'SLICING_NOT_SUPPORTED: slicing is not supported for compression format ' + this.getCompressionName();
  }
  
  var reader = new FileReader();
  var that = this;
  
  // use the byterate to calculate number of bytes per second
  var start = this.dataOffset + (start * this.byteRate);
  var end = start + (length * this.byteRate);
  
  var headerBlob = this.sliceFile(0, 44);
  var dataBlob = this.sliceFile(start, end);

  // concant header and data slice
  var blob = new Blob([headerBlob, dataBlob]);

  reader.readAsArrayBuffer(blob);
  reader.onloadend = function() {  
    
    // update chunkSize in header
    var chunkSize = new Uint8Array(this.result, 4, 4);
    that.tolittleEndianDecBytes(chunkSize, 36+dataBlob.size);

    // update dataChunkSize in header
    var dataChunkSize = new Uint8Array(this.result, 40, 4);
    that.tolittleEndianDecBytes(dataChunkSize, dataBlob.size);

    if (callback) callback.apply(that, [this.result]);
  };
};

/*
 * do we need direct access to  samples?
 *
wav.prototype.getSamples = function () {

  // TODO load data chunk into buffer
  if (this.bitsPerSample === 8)
    this.dataSamples = new Uint8Array(this.buffer, 44, chunkSize/this.blockAlign);
  else if (this.bitsPerSample === 16)
    this.dataSamples = new Int16Array(this.buffer, 44, chunkSize/this.blockAlign);
}
*/

/**
 * Reads slice from buffer as String
 */
wav.prototype.readText = function (start, length) {
  var a = new Uint8Array(this.buffer, start, length);
  var str = '';
  for(var i = 0; i < a.length; i++) {
    str += String.fromCharCode(a[i]);
  }
  return str;
};

/**
 * Reads slice from buffer as Decimal
 */
wav.prototype.readDecimal = function (start, length) {
  var a = new Uint8Array(this.buffer, start, length);
  return this.fromLittleEndianDecBytes(a);
};

/**
 * Calculates decimal value from Little-endian decimal byte array
 */
wav.prototype.fromLittleEndianDecBytes = function (a) {
  var sum = 0;
  for(var i = 0; i < a.length; i++)
    sum |= a[i] << (i*8);
  return sum;
};

/**
 * Populate Little-endian decimal byte array from decimal value
 */
wav.prototype.tolittleEndianDecBytes = function (a, decimalVal) {
  for(var i=0; i<a.length; i++) {
    a[i] = decimalVal & 0xFF;
    decimalVal >>= 8;
  }
  return a;
};


/**
 * Slice the File using either standard slice or webkitSlice
 */
wav.prototype.sliceFile = function (start, end) {
  if (this.file.slice) return this.file.slice(start, end); 
  if (this.file.webkitSlice) return this.file.webkitSlice(start, end);
};


wav.prototype.isCompressed = function () {
  return this.compression !== 1;  
};

/**
 * Check if the current compression format supports slicing
 */
wav.prototype.supportsSlicing = function () {
  // Only PCM supports slicing for now
  // Compressed formats would require decoding which is complex
  return this.compression === WAV_COMPRESSION.PCM;
};

/**
 * Get the name of the compression format
 */
wav.prototype.getCompressionName = function () {
  for (var name in WAV_COMPRESSION) {
    if (WAV_COMPRESSION[name] === this.compression) {
      return name;
    }
  }
  return 'UNKNOWN_FORMAT_' + this.compression;
};

/**
 * Get compression format details
 */
wav.prototype.getCompressionDetails = function () {
  var details = {
    name: this.getCompressionName(),
    compression: this.compression,
    supportsSlicing: this.supportsSlicing()
  };
  
  // Add format-specific details
  if (this.samplesPerBlock) {
    details.samplesPerBlock = this.samplesPerBlock;
  }
  
  if (this.coefficients) {
    details.coefficients = this.coefficients;
  }
  
  return details;
};
  
wav.prototype.isMono = function () {
  return this.numChannels === 1;  
};
  
wav.prototype.isStereo = function () {
  return this.numChannels === 2;
};

wav.prototype.getDuration = function () {
  return this.dataLength > -1 ? (this.dataLength / this.byteRate) : -1;
};


/**
 * Override toString
 */
wav.prototype.toString = function () {
  var compressionInfo = this.getCompressionName();
  if (!this.supportsSlicing()) {
    compressionInfo += ' (slicing not supported)';
  }
  
  return (this.file ? this.file.name : 'noname.wav') + ' (' + this.chunkID + '/' + this.format + ')\n' +
    'Compression: ' + compressionInfo + '\n' +
    'Number of channels: ' + this.numChannels + ' (' + (this.isStereo()?'stereo':'mono') + ')\n' +
    'Sample rate: ' + this.sampleRate + ' Hz\n'+
    'Sample size: ' + this.bitsPerSample + '-bit\n'+
    'Duration: ' + Math.round(this.getDuration()) + ' seconds';
};
