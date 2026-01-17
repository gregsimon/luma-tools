/**
 * flac.js - a pure JavaScript FLAC decoder.
 */

(function(root) {

function Bitstream(buffer) {
    this.view = new DataView(buffer);
    this.offset = 0;
    this.bitBuffer = 0;
    this.bitCount = 0;
}

Bitstream.prototype.readBits = function(bits) {
    if (bits === 0) return 0;
    
    if (bits > 32) {
        const high = this.readBits(bits - 32);
        const low = this.readBits(32);
        return high * 4294967296 + low;
    }

    while (this.bitCount < bits) {
        const byte = (this.offset < this.view.byteLength) ? this.view.getUint8(this.offset++) : 0;
        this.bitBuffer = ((this.bitBuffer << 8) | byte) >>> 0;
        this.bitCount += 8;
    }
    
    const shift = this.bitCount - bits;
    const result = (this.bitBuffer >>> shift);
    
    this.bitCount -= bits;
    this.bitBuffer &= (Math.pow(2, this.bitCount) - 1);
    
    const mask = bits === 32 ? 0xFFFFFFFF : (Math.pow(2, bits) - 1);
    return (result & mask) >>> 0;
};

Bitstream.prototype.readUnary = function() {
    let count = 0;
    while (this.readBits(1) === 0) count++;
    return count;
};

Bitstream.prototype.readRice = function(parameter) {
    const quotient = this.readUnary();
    const remainder = this.readBits(parameter);
    const value = quotient * Math.pow(2, parameter) + remainder;
    // Zigzag decoding: (value >> 1) ^ -(value & 1)
    return (value % 2 === 0) ? (value / 2) : -((value + 1) / 2);
};

function Decoder(buffer) {
    this.bitstream = new Bitstream(buffer);
    this.streamInfo = null;
}

Decoder.prototype.decodeStream = function() {
    // 1. Skip ID3v2 tag if present
    if (this.bitstream.offset + 10 < this.bitstream.view.byteLength &&
        this.bitstream.view.getUint8(this.bitstream.offset) === 0x49 && // 'I'
        this.bitstream.view.getUint8(this.bitstream.offset + 1) === 0x44 && // 'D'
        this.bitstream.view.getUint8(this.bitstream.offset + 2) === 0x33) { // '3'
        
        const size1 = this.bitstream.view.getUint8(this.bitstream.offset + 6);
        const size2 = this.bitstream.view.getUint8(this.bitstream.offset + 7);
        const size3 = this.bitstream.view.getUint8(this.bitstream.offset + 8);
        const size4 = this.bitstream.view.getUint8(this.bitstream.offset + 9);
        const tagSize = ((size1 & 0x7F) << 21) | ((size2 & 0x7F) << 14) | ((size3 & 0x7F) << 7) | (size4 & 0x7F);
        this.bitstream.offset += 10 + tagSize;
    }

    // 2. Magic number "fLaC"
    const magic = this.bitstream.readBits(32);
    if (magic !== 0x664c6143) {
        const magicStr = String.fromCharCode((magic >> 24) & 0xff, (magic >> 16) & 0xff, (magic >> 8) & 0xff, magic & 0xff);
        if (magic === 0x4f676753) throw new Error("Ogg-FLAC is not supported. Please use native FLAC (Found: OggS).");
        throw new Error("Not a FLAC file (Found: '" + magicStr + "' / 0x" + magic.toString(16) + ")");
    }

    let isLast = false;
    while (!isLast) {
        isLast = this.bitstream.readBits(1) === 1;
        const type = this.bitstream.readBits(7);
        const length = this.bitstream.readBits(24);
        
        if (type === 0) { // STREAMINFO
            this.streamInfo = {
                minBlockSize: this.bitstream.readBits(16),
                maxBlockSize: this.bitstream.readBits(16),
                minFrameSize: this.bitstream.readBits(24),
                maxFrameSize: this.bitstream.readBits(24),
                sampleRate: this.bitstream.readBits(20),
                channels: this.bitstream.readBits(3) + 1,
                bitsPerSample: this.bitstream.readBits(5) + 1,
                totalSamples: this.bitstream.readBits(36)
            };
            this.bitstream.readBits(128); // MD5
        } else {
            for (let i = 0; i < length; i++) this.bitstream.readBits(8);
        }
    }

    if (!this.streamInfo) throw new Error("Missing STREAMINFO block");

    // Decoding frames
    const totalSamples = this.streamInfo.totalSamples || 1024 * 1024 * 1024; // If 0, use large limit
    const allChannels = [];
    for (let i = 0; i < this.streamInfo.channels; i++) {
        allChannels.push(new Float32Array(this.streamInfo.totalSamples || 0));
    }

    let currentSample = 0;
    while (currentSample < totalSamples) {
        try {
            const frame = this.decodeFrame();
            if (!frame) break;
            
            // Allocate more space if totalSamples was unknown (0)
            if (this.streamInfo.totalSamples === 0 && currentSample + frame.blockSize > allChannels[0].length) {
                const newLen = Math.max(allChannels[0].length * 2, currentSample + frame.blockSize);
                for (let c = 0; c < this.streamInfo.channels; c++) {
                    const newArr = new Float32Array(newLen);
                    newArr.set(allChannels[c]);
                    allChannels[c] = newArr;
                }
            }

            const denominator = Math.pow(2, this.streamInfo.bitsPerSample - 1);
            for (let c = 0; c < this.streamInfo.channels; c++) {
                for (let i = 0; i < frame.blockSize; i++) {
                    if (currentSample + i < (this.streamInfo.totalSamples || Infinity)) {
                        allChannels[c][currentSample + i] = frame.samples[c][i] / denominator;
                    }
                }
            }
            currentSample += frame.blockSize;
        } catch (e) {
            console.error("Frame decoding error at sample " + currentSample + ":", e);
            break;
        }
    }

    return {
        channels: allChannels,
        sampleRate: this.streamInfo.sampleRate,
        length: currentSample
    };
};

Decoder.prototype.decodeFrame = function() {
    // Sync code search
    let sync = this.bitstream.readBits(14);
    let searchCount = 0;
    while (sync !== 0x3FFE && searchCount < 65536 && this.bitstream.offset < this.bitstream.view.byteLength) {
        sync = ((sync << 1) | this.bitstream.readBits(1)) & 0x3FFE;
        searchCount++;
    }
    if (sync !== 0x3FFE) return null;

    this.bitstream.readBits(1); // Reserved
    this.bitstream.readBits(1); // Blocking strategy
    
    const blockSizeCode = this.bitstream.readBits(4);
    const sampleRateCode = this.bitstream.readBits(4);
    const channelAssignmentCode = this.bitstream.readBits(4);
    const sampleSizeCode = this.bitstream.readBits(3);
    this.bitstream.readBits(1); // Reserved
    
    this.readUTF8();
    
    let blockSize;
    if (blockSizeCode === 1) blockSize = 192;
    else if (blockSizeCode >= 2 && blockSizeCode <= 5) blockSize = 576 << (blockSizeCode - 2);
    else if (blockSizeCode === 6) blockSize = this.bitstream.readBits(8) + 1;
    else if (blockSizeCode === 7) blockSize = this.bitstream.readBits(16) + 1;
    else blockSize = [0, 0, 0, 0, 0, 0, 0, 0, 512, 1024, 2048, 4096, 8192, 16384, 32768, 0][blockSizeCode];

    if (sampleRateCode === 12) this.bitstream.readBits(8);
    else if (sampleRateCode === 13 || sampleRateCode === 14) this.bitstream.readBits(16);
    
    this.bitstream.readBits(8); // CRC-8
    
    // Subframes
    const subframes = [];
    const numChannels = channelAssignmentCode < 8 ? channelAssignmentCode + 1 : 2;
    for (let c = 0; c < numChannels; c++) {
        let bps = this.streamInfo.bitsPerSample;
        if (channelAssignmentCode === 8 && c === 1) bps++;
        else if (channelAssignmentCode === 9 && c === 0) bps++;
        else if (channelAssignmentCode === 10 && c === 1) bps++;
        
        subframes.push(this.decodeSubframe(blockSize, bps));
    }
    
    this.bitstream.readBits(this.bitstream.bitCount); // Zero-padding
    this.bitstream.readBits(16); // CRC-16

    // Channel Decorrelation
    const channels = [];
    if (channelAssignmentCode < 8) {
        for (let c = 0; c < numChannels; c++) channels.push(subframes[c]);
    } else {
        const s0 = subframes[0];
        const s1 = subframes[1];
        const left = new Int32Array(blockSize);
        const right = new Int32Array(blockSize);
        
        if (channelAssignmentCode === 8) { // left/side
            for (let i = 0; i < blockSize; i++) {
                left[i] = s0[i];
                right[i] = s0[i] - s1[i];
            }
        } else if (channelAssignmentCode === 9) { // side/right
            for (let i = 0; i < blockSize; i++) {
                left[i] = s0[i] + s1[i];
                right[i] = s1[i];
            }
        } else if (channelAssignmentCode === 10) { // mid/side
            for (let i = 0; i < blockSize; i++) {
                const mid = s0[i];
                const side = s1[i];
                left[i] = mid + (side >> 1);
                right[i] = left[i] - side;
            }
        }
        channels.push(left, right);
    }
    
    return { blockSize: blockSize, samples: channels };
};

Decoder.prototype.decodeSubframe = function(blockSize, bitsPerSample) {
    this.bitstream.readBits(1); // Reserved
    const type = this.bitstream.readBits(6);
    const wastedBits = this.bitstream.readBits(1) ? this.readUnary() + 1 : 0;
    bitsPerSample -= wastedBits;
    
    let samples = new Int32Array(blockSize);
    if (type === 0) { // Constant
        const val = this.readSigned(bitsPerSample);
        samples.fill(val);
    } else if (type === 1) { // Verbatim
        for (let i = 0; i < blockSize; i++) samples[i] = this.readSigned(bitsPerSample);
    } else if (type >= 8 && type <= 12) { // Fixed
        const order = type - 8;
        for (let i = 0; i < order; i++) samples[i] = this.readSigned(bitsPerSample);
        this.decodeResidual(samples, order, blockSize);
        this.restoreFixed(samples, order, blockSize);
    } else if (type >= 32) { // LPC
        const order = (type - 32) + 1;
        for (let i = 0; i < order; i++) samples[i] = this.readSigned(bitsPerSample);
        const precision = this.bitstream.readBits(4) + 1;
        const shift = this.readSigned(5);
        const coefficients = [];
        for (let i = 0; i < order; i++) coefficients.push(this.readSigned(precision));
        this.decodeResidual(samples, order, blockSize);
        this.restoreLPC(samples, order, blockSize, coefficients, shift);
    }
    
    if (wastedBits > 0) {
        const factor = Math.pow(2, wastedBits);
        for (let i = 0; i < blockSize; i++) samples[i] *= factor;
    }
    return samples;
};

Decoder.prototype.decodeResidual = function(samples, order, blockSize) {
    const method = this.bitstream.readBits(2);
    const partitionOrder = this.bitstream.readBits(4);
    const numPartitions = 1 << partitionOrder;
    const riceParamLen = method === 0 ? 4 : 5;
    const escapeParam = method === 0 ? 15 : 31;
    
    let sampleIdx = order;
    for (let p = 0; p < numPartitions; p++) {
        let parameter = this.bitstream.readBits(riceParamLen);
        const numSamples = (blockSize >> partitionOrder) - (p === 0 ? order : 0);
        if (parameter !== escapeParam) {
            for (let i = 0; i < numSamples; i++) {
                samples[sampleIdx++] = this.bitstream.readRice(parameter);
            }
        } else {
            const bits = this.bitstream.readBits(5);
            for (let i = 0; i < numSamples; i++) {
                samples[sampleIdx++] = this.readSigned(bits);
            }
        }
    }
};

Decoder.prototype.restoreFixed = function(samples, order, blockSize) {
    for (let i = order; i < blockSize; i++) {
        if (order === 1) samples[i] += samples[i - 1];
        else if (order === 2) samples[i] += 2 * samples[i - 1] - samples[i - 2];
        else if (order === 3) samples[i] += 3 * samples[i - 1] - 3 * samples[i - 2] + samples[i - 3];
        else if (order === 4) samples[i] += 4 * samples[i - 1] - 6 * samples[i - 2] + 4 * samples[i - 3] - samples[i - 4];
    }
};

Decoder.prototype.restoreLPC = function(samples, order, blockSize, coefficients, shift) {
    for (let i = order; i < blockSize; i++) {
        let sum = 0;
        for (let j = 0; j < order; j++) {
            sum += coefficients[j] * samples[i - j - 1];
        }
        samples[i] += (sum >> shift);
    }
};

Decoder.prototype.readSigned = function(bits) {
    if (bits === 0) return 0;
    const val = this.bitstream.readBits(bits);
    const limit = Math.pow(2, bits - 1);
    if (val < limit) return val;
    return val - Math.pow(2, bits);
};

Decoder.prototype.readUTF8 = function() {
    let val = this.bitstream.readBits(8);
    if (!(val & 0x80)) return val;
    let len = 0;
    let mask = 0x80;
    while (val & mask) {
        len++;
        mask >>= 1;
    }
    if (len < 2 || len > 7) return val;
    val &= (mask - 1);
    for (let i = 1; i < len; i++) {
        val = (val * 64) + (this.bitstream.readBits(8) & 0x3F);
    }
    return val;
};

Decoder.prototype.readUnary = function() {
    let count = 0;
    while (this.bitstream.readBits(1) === 0) count++;
    return count;
};

root.flac = function(buffer) {
    this.buffer = buffer;
    this.decoder = new Decoder(buffer);
};

root.flac.prototype.decode = function(callback) {
    try {
        const result = this.decoder.decodeStream();
        const audioBuffer = {
            length: result.length,
            sampleRate: result.sampleRate,
            numberOfChannels: result.channels.length,
            getChannelData: function(c) {
                return result.channels[c].subarray(0, this.length);
            }
        };
        if (callback) callback(audioBuffer);
    } catch (e) {
        console.error(e);
        if (callback) callback(null);
    }
};

})(window);
