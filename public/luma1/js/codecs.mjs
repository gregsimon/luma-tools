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

// uLaw conversion functions (from codecs.mjs)
function ulaw_to_linear(ulaw) {
  const  ULAW_BIAS = 0x84;
  ulaw = ~ulaw;
  let t = (((ulaw & 0x0F) << 3) + ULAW_BIAS) 
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

// SysEx conversion functions (from codecs.mjs)
// Converts an 8-bit ArrayBuffer into a 7-bit SysEx array.
function pack_sysex(src) {
  let in_idx = 0;
  let out_idx = 0;
  const len = src.length;
  const dst = [];

  while (in_idx < len) {
    let b7s = 0;
    const chunk_start = out_idx;
    out_idx++; // space for sign byte
    
    for (let i = 0; i < 7; i++) {
      if (in_idx >= len) break;
      const w = src[in_idx++];
      if (w & 0x80) {
        b7s |= (1 << (6 - i));
      }
      dst[out_idx++] = w & 0x7f;
    }
    dst[chunk_start] = b7s;
  }
  return dst;
}

// Converts a 7-bit SysEx Array into an 8-bit binary array.
function unpack_sysex(src) {
  const len = src.length;
  const out_block = [];
  let in_idx = 0;

  while (in_idx < len) {
    const signbyte = src[in_idx++];
    const remaining = len - in_idx;
    const chunk_size = Math.min(7, remaining);
    
    const buffer = new Uint8Array(chunk_size);
    for (let i = 0; i < chunk_size; i++) {
      buffer[i] = src[in_idx++];
      if (signbyte & (1 << (6 - i))) {
        buffer[i] |= 0x80;
      }
      out_block.push(buffer[i]);
    }

    // If we're not at the end, we should have processed exactly 7 data bytes
    // and are now at the start of the next chunk (sign byte).
    // If we were at the end, chunk_size might be less than 7.
  }

  return out_block;
}

function arrayToArrayBuffer(buf) {  
  var ab = new ArrayBuffer(buf.length);
  var ptr = new Uint8Array(ab);
  for (var i=0; i<buf.length; ++i) {
    ptr[i] = buf[i];
  }
  return ab;
}
