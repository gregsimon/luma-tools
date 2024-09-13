// ulaw/pcm and SysEx codecs.

// The ulaw routines were taken from G711.c/h WebRTC codebase:
// https://chromium.googlesource.com/external/webrtc/stable/webrtc/+/dccd94bfcccfc8ece3e1d62cf4d195835b79e4a5/modules/audio_coding/codecs/g711/g711.h

// sysex routines were inspired from the luma1 project firmware:
// https://github.com/joebritt/luma1

/*
 * g711.h - In line A-law and u-law conversion routines
 *
 * Written by Steve Underwood <steveu@coppice.org>
 *
 * Copyright (C) 2001 Steve Underwood
 *
 *  Despite my general liking of the GPL, I place this code in the
 *  public domain for the benefit of all mankind - even the slimy
 *  ones who might try to proprietize my work and use it to my
 *  detriment.
 *
 * $Id: g711.h,v 1.1 2006/06/07 15:46:39 steveu Exp $
 *
 * Modifications for WebRtc, 2011/04/28, by tlegrand:
 * -Changed to use WebRtc types
 * -Changed __inline__ to __inline
 * -Two changes to make implementation bitexact with ITU-T reference implementation
 */

function ulaw_to_linear(ulaw) {
  const  ULAW_BIAS = 0x84;
  ulaw = ~ulaw;
  t = (((ulaw & 0x0F) << 3) + ULAW_BIAS) 
        << ((ulaw & 0x70) >> 4);

  return ((ulaw & 0x80) ? (ULAW_BIAS - t) : (t - ULAW_BIAS));
}

function linear_to_ulaw(linear) {
  const  ULAW_BIAS = 0x84;
  var u_val;
  var mask;
  var seg;
  // Get the sign and the magnitude of the value. 
  if (linear < 0) {
    // WebRtc, tlegrand: -1 added to get bitexact to reference implementation 
    linear = ULAW_BIAS - linear - 1;
    mask = 0x7F;
  } else {
    linear = ULAW_BIAS + linear;
    mask = 0xFF;
  }
  seg = top_bit(linear | 0xFF) - 7;
  
   // Combine the sign, segment, quantization bits,
   // and complement the code word.
  if (seg >= 8)
    u_val = (0x7F ^ mask);
  else
    u_val = (((seg << 4) | ((linear >> (seg + 3)) & 0xF)) ^ mask);

  return u_val;
}

function top_bit(bits) {
  var i;
  if (bits == 0) {
    return -1;
  }
  i = 0;
  if (bits & 0xFFFF0000) {
    bits &= 0xFFFF0000;
    i += 16;
  }
  if (bits & 0xFF00FF00) {
    bits &= 0xFF00FF00;
    i += 8;
  }
  if (bits & 0xF0F0F0F0) {
    bits &= 0xF0F0F0F0;
    i += 4;
  }
  if (bits & 0xCCCCCCCC) {
    bits &= 0xCCCCCCCC;
    i += 2;
  }
  if (bits & 0xAAAAAAAA) {
    bits &= 0xAAAAAAAA;
    i += 1;
  }
  return i;
}

// Converts an 8-bit ArrayBuffer into a 7-bit SysEx array.
function pack_sysex(src) {
  var in_idx = 0;
  var out_idx = 0;
  var b7s;

  var len = src.length;
  var dst = new Array(len*2);

  do {
    b7s = 0;
    for (yyy = 1; yyy != 8; yyy++) {
      b7s <<= 1; // 0 in low bit
      w = src[in_idx++];

      if (w & 0x80)
        b7s |= 1;

      w &= 0x7f;

      dst[out_idx+yyy] = w;

      if (in_idx >= len)
        break;
    }

    dst[out_idx] = b7s;
    out_idx += yyy;

  } while (in_idx < len);

  dst.splice(out_idx);
  return dst;
}

// Converts a 7-bit SysEx Array into an 8-bit binary array.
function unpack_sysex(src) {
  var debug=false;
  out_block = new Array(src.length*2); // larger than we need

  if (true) { 
    console.log(`unpack_sysex: IN= ${src.length}`);

  }

  var in_size = src.length;
  var in_idx = 0;
  var out_idx = 0;
  var buffer = new ArrayBuffer(7);

  // [ <sign byte 0111 1111> <7 data bytes> ]
  while (in_size > 0) {
    var str ="";

    var signbyte = src[in_idx]; in_idx++;
    
    // last chunk may be less than final 7 data bytes
    var bytes_to_count = Math.min(7, in_size-1);

    for (var i=0; i<bytes_to_count; i++) {
      buffer[i] = src[in_idx];
      if (debug) str += `0x${buffer[i].toString(16)} `;
      in_idx++;
    }
    if (debug) console.log(str);
    
    // apply the high bit to the appropriate bytes.
    for (var i=6; i>=0; --i) {
      if ((1 << i) & signbyte) {
        buffer[6-i] = buffer[6-i] | 0x80;
      }
    }

    var num_bytes_to_append = 7;
    if (in_size < 8) {
      // on the last iteration we may only want to push a limited # of bytes.
      num_bytes_to_append = in_size - 1;
    }

    // append buffer to out_block
    for (i=0; i<num_bytes_to_append; i++) {
      out_block[out_idx] = buffer[i];
      out_idx++;
    }
    in_size -= 8;

  }

  if (true) console.log(`unpack_sysex: OUT=${out_idx}  -header=${out_idx-32}`);
  return out_block.slice(0, out_idx);
}

function arrayToArrayBuffer(buf) {  
  var ab = new ArrayBuffer(buf.length);
  var ptr = new Uint8Array(ab);
  for (var i=0; i<buf.length; ++i) {
    ptr[i] = buf[i];
  }
  return ab;
}