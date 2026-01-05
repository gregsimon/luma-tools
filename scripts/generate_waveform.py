#!/usr/bin/env python3
import argparse
import math
import random
import wave
import os
import sys
import struct

def linear_to_ulaw(pcm_val):
    """
    Converts a 16-bit signed PCM value to 8-bit u-law.
    Matches the implementation in codecs.mjs.
    """
    ULAW_BIAS = 0x84
    
    # Clamp to 16-bit range
    if pcm_val > 32767: pcm_val = 32767
    if pcm_val < -32768: pcm_val = -32768

    if pcm_val < 0:
        # WebRtc, tlegrand: -1 added to get bitexact to reference implementation 
        pcm_val = ULAW_BIAS - pcm_val - 1
        mask = 0x7F
    else:
        pcm_val = ULAW_BIAS + pcm_val
        mask = 0xFF
    
    def top_bit(bits):
        if bits <= 0: return -1
        return bits.bit_length() - 1

    seg = top_bit(pcm_val | 0xFF) - 7
    
    if seg >= 8:
        u_val = (0x7F ^ mask)
    else:
        u_val = (((seg << 4) | ((pcm_val >> (seg + 3)) & 0xF)) ^ mask)
    
    return u_val & 0xFF

def main():
    parser = argparse.ArgumentParser(description="Generate arbitrary waveform files for Luma Tools.")
    parser.add_argument("--input", help="Optional input .wav file to convert.")
    parser.add_argument("--type", choices=["sine", "noise", "zero"], default="sine", help="Type of wave (for generation, default: sine)")
    parser.add_argument("--samples", type=int, default=16384, help="Number of samples (for generation, default: 16384)")
    parser.add_argument("--freq", type=float, default=440.0, help="Frequency of wave in Hz (for sine generation, default: 440.0)")
    parser.add_argument("--rate", type=int, default=24000, help="Sample rate in Hz (default: 24000)")
    parser.add_argument("--phase", type=float, default=0.0, help="Phase offset in degrees (default: 0.0)")
    parser.add_argument("--encoding", choices=["linear", "ulaw"], default="ulaw", help="Encoding: 8-bit linear (unsigned) or 8-bit uLaw (default: ulaw)")
    parser.add_argument("--luma-invert", action="store_true", default=True, help="Invert u-law bits as Luma Tools expects for internal storage (default: True)")
    parser.add_argument("--no-luma-invert", action="store_false", dest="luma_invert", help="Do not invert u-law bits")
    parser.add_argument("output", help="Output filename")

    args = parser.parse_args()

    samples = []
    
    if args.input:
        # Read from input file
        with wave.open(args.input, "rb") as w:
            n_channels = w.getnchannels()
            sampwidth = w.getsampwidth()
            framerate = w.getframerate()
            n_frames = w.getnframes()
            
            print(f"Reading {args.input}: {n_channels} ch, {sampwidth*8}-bit, {framerate}Hz, {n_frames} samples")
            
            # Update args.rate for the output metadata display
            args.rate = framerate
            
            frames = w.readframes(n_frames)
            
            if sampwidth == 2: # 16-bit signed PCM
                fmt = f"<{n_channels * n_frames}h"
                data = struct.unpack(fmt, frames)
                if n_channels == 2:
                    # Average to mono
                    for i in range(0, len(data), 2):
                        samples.append((data[i] + data[i+1]) / (2 * 32768.0))
                else:
                    for val in data:
                        samples.append(val / 32768.0)
            elif sampwidth == 1: # 8-bit unsigned PCM
                fmt = f"<{n_channels * n_frames}B"
                data = struct.unpack(fmt, frames)
                if n_channels == 2:
                    for i in range(0, len(data), 2):
                        samples.append(((data[i] + data[i+1]) / 255.0) - 1.0)
                else:
                    for val in data:
                        samples.append((val / 127.5) - 1.0)
            else:
                print(f"Error: Unsupported sample width {sampwidth} bytes. Only 8-bit and 16-bit PCM are supported.")
                sys.exit(1)
    else:
        # Generate samples
        if args.type == "sine" and args.freq >= args.rate / 2:
            print(f"Warning: Frequency ({args.freq} Hz) is >= half the sample rate ({args.rate} Hz).")
            print("This will result in aliasing or silence due to the Nyquist limit.")
            if args.freq == args.rate / 2 and args.phase == 0:
                print("Specifically, at exactly half the sample rate with 0 phase, the result will be silence.")

        phase_rad = math.radians(args.phase)
        for i in range(args.samples):
            if args.type == "sine":
                val = math.sin(2 * math.pi * args.freq * i / args.rate + phase_rad)
            elif args.type == "noise":
                val = random.uniform(-1, 1)
            else: # zero
                val = 0.0
            samples.append(val)

    # Convert to target encoding
    out_bytes = bytearray()
    if args.encoding == "ulaw":
        for s in samples:
            # Convert to 16-bit signed
            pcm16 = int(max(-32768, min(32767, s * 32767)))
            u = linear_to_ulaw(pcm16)
            if args.luma_invert:
                u = (~u) & 0xFF
            out_bytes.append(u)
    else: # linear 8-bit
        for s in samples:
            # Unsigned 8-bit (128 is mid-point)
            val = int(max(0, min(255, (s * 127) + 128)))
            out_bytes.append(val)

    # Save to file
    ext = os.path.splitext(args.output)[1].lower()
    if ext == ".wav":
        with wave.open(args.output, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(1) # 8-bit
            w.setframerate(args.rate)
            w.writeframes(out_bytes)
    else:
        with open(args.output, "wb") as f:
            f.write(out_bytes)

    print(f"Generated {args.output}")
    print(f"  Samples: {len(samples)}")
    print(f"  Encoding: {args.encoding}")
    if args.encoding == "ulaw":
        print(f"  Luma Inversion: {args.luma_invert}")

if __name__ == "__main__":
    main()
