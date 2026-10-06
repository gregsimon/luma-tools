/**
 * PicoROM Web Serial API
 * 
 * This file provides a JavaScript implementation for communicating with PicoROM devices
 * via Web Serial, based on the protocol defined in the Rust implementation at:
 * https://github.com/wickerwaka/PicoROM/blob/21f895213d67d2e4af0787dfe27bbebee17e2007/host/picolink/src/lib.rs
 */

// PicoROM USB Vendor ID and Product ID for device identification
const PICOROM_VID = 0x2e8a;
const PICOROM_PID = 0x000a;

// Packet kinds (commands) from the Rust implementation
const PacketKind = {
    PointerSet: 3,
    PointerGet: 4,
    PointerCur: 5,
    Write: 6,
    Read: 7,
    ReadData: 8,
    CommitFlash: 12,
    CommitDone: 13,
    ParameterSet: 20,
    ParameterGet: 21,
    Parameter: 22,
    ParameterError: 23,
    ParameterQuery: 24,
    CommsStart: 80,
    CommsEnd: 81,
    CommsData: 82,
    Identify: 0xf8,
    Bootsel: 0xf9,
    Error: 0xfe,
    Debug: 0xff
};

/**
 * PicoROM class for communicating with PicoROM devices via Web Serial
 */
class PicoROM {
    constructor(port) {
        this.port = port;
        this.reader = null;
        this.writer = null;
        this.pendingRead = null;
        this.receiveBuffer = new Uint8Array(0);
        this.isOpen = false;
        this.debug = false;
    }

    /**
     * Open a connection to the PicoROM device
     * @param {Object} options - Serial port options
     */
    async open(options = {}) {
        try {
            await this.port.open({
                baudRate: options.baudRate || 9600,
                dataBits: options.dataBits || 8,
                stopBits: options.stopBits || 1,
                parity: options.parity || 'none',
                bufferSize: options.bufferSize || 255,
                flowControl: options.flowControl || 'none'
            });
            this.isOpen = true;
            this.reader = this.port.readable.getReader();
            // The legacy firmware starts its session when DTR is asserted and
            // sends the 13 ASCII bytes of its greeting (without a NUL).
            if (this.port.setSignals) await this.port.setSignals({ dataTerminalReady: true });
            const expected = new TextEncoder().encode('PicoROM Hello');
            const deadline = Date.now() + (options.timeout || 3000);
            while (this.receiveBuffer.length < expected.length) {
                if (!await this.fillReceiveBuffer(deadline)) {
                    throw new Error('Timeout waiting for PicoROM Hello. Check the selected device and reconnect.');
                }
            }
            if (!expected.every((byte, i) => this.receiveBuffer[i] === byte)) {
                throw new Error('Did not receive expected PicoROM Hello message');
            }
            this.receiveBuffer = this.receiveBuffer.slice(expected.length);

            return true;
        } catch (error) {
            console.error("Error opening PicoROM device:", error);
            throw error;
        }
    }

    /**
     * Close the connection to the PicoROM device
     */
    async close() {
        const port = this.port;
        try {
            if (this.reader) {
                try { await this.reader.cancel(); } catch (_) { /* Already disconnected. */ }
                finally { this.reader.releaseLock(); this.reader = null; }
            }
            if (this.writer) {
                try { await this.writer.abort(); } catch (_) { /* Already disconnected. */ }
                finally { this.writer.releaseLock(); this.writer = null; }
            }
            if (port && this.isOpen) await port.close();
        } finally {
            this.port = null;
            this.isOpen = false;
            this.pendingRead = null;
            this.receiveBuffer = new Uint8Array(0);
        }
    }

    // Keep a single pending read across timeout boundaries. Losing that promise
    // would discard the next arriving chunk and desynchronize every later packet.
    async fillReceiveBuffer(deadline) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) return false;
        if (!this.reader) throw new Error('PicoROM is not connected');
        if (!this.pendingRead) this.pendingRead = this.reader.read();
        let timer;
        const timedOut = Symbol('timeout');
        let result;
        try {
            result = await Promise.race([
                this.pendingRead,
                new Promise(resolve => { timer = setTimeout(() => resolve(timedOut), remaining); })
            ]);
        } finally { clearTimeout(timer); }
        if (result === timedOut) return false;
        this.pendingRead = null;
        if (result.done) throw new Error('PicoROM disconnected while receiving data');
        if (result.value && result.value.length) {
            const combined = new Uint8Array(this.receiveBuffer.length + result.value.length);
            combined.set(this.receiveBuffer);
            combined.set(result.value, this.receiveBuffer.length);
            this.receiveBuffer = combined;
        }
        return true;
    }

    /**
     * Send a packet to the PicoROM device
     * @param {Object} packet - The packet to send
     */
    async sendPacket(packet) {
        try {
            const encodedPacket = this.encodePacket(packet);
            
            this.writer = this.port.writable.getWriter();
            await this.writer.write(encodedPacket);
            
            if (this.debug) {
                console.log("Sent packet:", packet.type, encodedPacket);
            }
        } catch (error) {
            console.error("Error sending packet:", error);
            throw error;
        } finally {
            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }
        }
    }

    /**
     * Encode a packet for sending to the PicoROM device
     * @param {Object} packet - The packet to encode
     * @returns {Uint8Array} - The encoded packet
     */
    encodePacket(packet) {
        let kind, payload;

        switch (packet.type) {
            case 'PointerSet':
                kind = PacketKind.PointerSet;
                payload = new Uint8Array(4);
                new DataView(payload.buffer).setUint32(0, packet.offset, true);
                break;
            case 'PointerGet':
                kind = PacketKind.PointerGet;
                payload = new Uint8Array(0);
                break;
            case 'Write':
                kind = PacketKind.Write;
                payload = new Uint8Array(packet.data);
                break;
            case 'Read':
                kind = PacketKind.Read;
                payload = new Uint8Array(0);
                break;
            case 'CommitFlash':
                kind = PacketKind.CommitFlash;
                payload = new Uint8Array(0);
                break;
            case 'Identify':
                kind = PacketKind.Identify;
                payload = new Uint8Array(0);
                break;
            case 'ParameterGet':
                kind = PacketKind.ParameterGet;
                payload = this.stringToZeroTerminatedArray(packet.param);
                break;
            case 'ParameterSet':
                kind = PacketKind.ParameterSet;
                payload = this.stringToZeroTerminatedArray(`${packet.param},${packet.value}`);
                break;
            case 'ParameterQuery':
                kind = PacketKind.ParameterQuery;
                payload = packet.param ? this.stringToZeroTerminatedArray(packet.param) : new Uint8Array(0);
                break;
            default:
                throw new Error(`Unknown packet type: ${packet.type}`);
        }

        if (payload.length > 30) {
            throw new Error(`Packet payload too large: ${payload.length}`);
        }

        const data = new Uint8Array(2 + payload.length);
        data[0] = kind;
        data[1] = payload.length;
        data.set(payload, 2);

        return data;
    }

    /**
     * Convert a string to a zero-terminated byte array
     * @param {string} str - The string to convert
     * @returns {Uint8Array} - The zero-terminated byte array
     */
    stringToZeroTerminatedArray(str) {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(str);
        const result = new Uint8Array(bytes.length + 1);
        result.set(bytes);
        result[bytes.length] = 0; // Null terminator
        return result;
    }

    /**
     * Receive a packet from the PicoROM device
     * @param {number} timeout - Timeout in milliseconds
     * @returns {Promise<Object>} - The received packet
     */
    async receivePacket(timeout = 1000) {
        const deadline = Date.now() + timeout;
        while (this.receiveBuffer.length < 2) {
            if (!await this.fillReceiveBuffer(deadline)) return null;
        }
        const kind = this.receiveBuffer[0];
        const size = this.receiveBuffer[1];
        if (size > 30) throw new Error(`Packet payload too large: ${size}`);
        while (this.receiveBuffer.length < size + 2) {
            if (!await this.fillReceiveBuffer(deadline)) return null;
        }
        const payload = this.receiveBuffer.slice(2, size + 2);
        // USB may deliver multiple packets together. Keep the remainder.
        this.receiveBuffer = this.receiveBuffer.slice(size + 2);
        return this.decodePacket(kind, payload);
    }

    async waitForPacket(type, timeout = 1000) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            const response = await this.receivePacket(deadline - Date.now());
            if (!response) break;
            if (response.type === 'Error') throw new Error(`PicoROM: ${response.message}`);
            if (response.type === 'ParameterError') throw new Error('PicoROM rejected the parameter');
            if (response.type === type) return response;
            if (response.type !== 'Debug') {
                throw new Error(`Unexpected PicoROM response: ${response.type}, expected ${type}`);
            }
        }
        throw new Error(`Timeout waiting for PicoROM ${type}`);
    }

    /**
     * Decode a packet received from the PicoROM device
     * @param {number} kind - The packet kind
     * @param {Uint8Array} payload - The packet payload
     * @returns {Object} - The decoded packet
     */
    decodePacket(kind, payload) {
        switch (kind) {
            case PacketKind.PointerCur:
                if (payload.length !== 4) throw new Error('Invalid PicoROM pointer response');
                const view = new DataView(payload.buffer);
                return {
                    type: 'PointerCur',
                    offset: view.getUint32(0, true) // little-endian
                };
            case PacketKind.ReadData:
                return {
                    type: 'ReadData',
                    data: payload
                };
            case PacketKind.CommitDone:
                return {
                    type: 'CommitDone'
                };
            case PacketKind.Parameter:
                const decoder = new TextDecoder();
                return {
                    type: 'Parameter',
                    value: decoder.decode(payload).replace(/\0+$/, '')
                };
            case PacketKind.ParameterError:
                return {
                    type: 'ParameterError'
                };
            case PacketKind.Debug:
                if (payload.length >= 8) {
                    const view = new DataView(payload.buffer);
                    const v0 = view.getUint32(0, true);
                    const v1 = view.getUint32(4, true);
                    const decoder = new TextDecoder();
                    const msg = decoder.decode(payload.slice(8));
                    return {
                        type: 'Debug',
                        message: msg,
                        v0: v0,
                        v1: v1
                    };
                }
                throw new Error(`Debug payload too small: ${payload.length}`);
            case PacketKind.Error:
                if (payload.length >= 8) {
                    const view = new DataView(payload.buffer);
                    const v0 = view.getUint32(0, true);
                    const v1 = view.getUint32(4, true);
                    const decoder = new TextDecoder();
                    const msg = decoder.decode(payload.slice(8));
                    return {
                        type: 'Error',
                        message: msg,
                        v0: v0,
                        v1: v1
                    };
                }
                throw new Error(`Error payload too small: ${payload.length}`);
            default:
                throw new Error(`Unknown packet kind: ${kind}`);
        }
    }

    /**
     * Get the name of the PicoROM device
     * @returns {Promise<string>} - The name of the device
     */
    async getName() {
        return this.getParameter('name');
    }

    /**
     * Get a parameter from the PicoROM device
     * @param {string} name - The name of the parameter
     * @returns {Promise<string>} - The value of the parameter
     */
    async getParameter(name) {
        await this.sendPacket({
            type: 'ParameterGet',
            param: name
        });

        return (await this.waitForPacket('Parameter')).value;
    }

    /**
     * Set a parameter on the PicoROM device
     * @param {string} name - The name of the parameter
     * @param {string} value - The value to set
     * @returns {Promise<void>}
     */
    async setParameter(name, value) {
        await this.sendPacket({
            type: 'ParameterSet',
            param: name,
            value: value
        });

        const stored = (await this.waitForPacket('Parameter')).value;
        const matches = name === 'addr_mask'
            ? /^0x[0-9a-f]+$/i.test(stored) && Number(stored) === Number(value)
            : stored === value;
        if (!matches) {
            throw new Error(`PicoROM did not retain parameter '${name}': expected '${value}', got '${stored}'`);
        }
    }

    /**
     * Upload binary data to the PicoROM device
     * @param {ArrayBuffer} data - The binary data to upload
     * @param {number} addrMask - The address mask to use
     * @param {Function} progressCallback - Callback for upload progress
     * @param {boolean} verify - Whether to read back and verify each chunk after writing
     * @returns {Promise<void>}
     */
    async upload(data, addrMask = 0xFFFFFFFF, progressCallback = null, verify = false) {
        const bytes = new Uint8Array(data);
        
        // Set the pointer to 0
        await this.sendPacket({
            type: 'PointerSet',
            offset: 0
        });
        
        // Upload the data in chunks
        let uploaded = 0;
        for (let i = 0; i < bytes.length; i += 30) {
            const chunk = bytes.slice(i, Math.min(i + 30, bytes.length));
            await this.sendPacket({
                type: 'Write',
                data: chunk
            });

            if (verify) {
                // Set pointer back to where this chunk started
                await this.sendPacket({
                    type: 'PointerSet',
                    offset: i
                });

                // Read back the data to verify
                await this.sendPacket({ type: 'Read' });
                const response = await this.waitForPacket('ReadData');

                if (response && response.type === 'ReadData') {
                    if (response.data.length < chunk.length) {
                        throw new Error(`Verification failed at offset ${i}. Read back only ${response.data.length} bytes, expected ${chunk.length}`);
                    }

                    for (let j = 0; j < chunk.length; j++) {
                        if (chunk[j] !== response.data[j]) {
                            throw new Error(`Verification failed at offset ${i + j}. Expected ${chunk[j]}, got ${response.data[j]}`);
                        }
                    }
                } else {
                    throw new Error(`Verification read failed at offset ${i}. No ReadData packet received.`);
                }
                
                // After reading, the pointer has advanced. We need to set it to where it should be for the next write.
                await this.sendPacket({
                    type: 'PointerSet',
                    offset: i + chunk.length
                });
            }
            
            uploaded += chunk.length;
            if (progressCallback) {
                progressCallback(uploaded, bytes.length);
            }
        }
        
        // Verify the upload by getting the current pointer position
        await this.sendPacket({
            type: 'PointerGet'
        });
        
        const response = await this.waitForPacket('PointerCur');
        if (response.offset !== bytes.length) {
            throw new Error(`Upload did not complete. Expected ${bytes.length} bytes, got ${response.offset}`);
        }
        await this.setParameter('addr_mask', `0x${addrMask.toString(16)}`);
        await this.sendPacket({ type: 'CommitFlash' });
        await this.waitForPacket('CommitDone', 5000);
    }

    /**
     * Read the entire ROM image from the PicoROM device
     * @param {Function} progressCallback - Callback for read progress
     * @returns {Promise<ArrayBuffer>} - The ROM image data
     */
    async readImage(progressCallback = null) {
        // Get the address mask to determine the ROM size
        const addrMaskStr = await this.getParameter('addr_mask');
        const addrMask = /^0x[0-9a-f]+$/i.test(addrMaskStr) ? Number(addrMaskStr) : NaN;
        const imageSize = addrMask + 1;

        // Legacy PicoROM has at most 256 KiB. Only contiguous address masks
        // describe an image; reject corrupt replies before allocating memory.
        if (!Number.isSafeInteger(imageSize) || imageSize <= 0 || imageSize > 262144 ||
            (imageSize & (imageSize - 1)) !== 0) {
            throw new Error(`Invalid image size determined from addr_mask: ${addrMaskStr}`);
        }

        // Set pointer to 0
        await this.sendPacket({
            type: 'PointerSet',
            offset: 0
        });

        // Read data in chunks
        const image = new Uint8Array(imageSize);
        let bytesRead = 0;

        while (bytesRead < imageSize) {
            // Request a chunk of data
            await this.sendPacket({ type: 'Read' });

            const response = await this.waitForPacket('ReadData');

            if (response && response.type === 'ReadData') {
                const chunk = response.data;
                if (!chunk.length) throw new Error('PicoROM returned an empty ROM chunk');
                const bytesToCopy = Math.min(chunk.length, imageSize - bytesRead);
                image.set(chunk.slice(0, bytesToCopy), bytesRead);
                bytesRead += bytesToCopy;

                if (progressCallback) {
                    progressCallback(bytesRead, imageSize);
                }
            } else {
                throw new Error('Timeout or error while reading image data from device.');
            }
        }

        return image.buffer;
    }
}

/**
 * List all PicoROM devices connected to the computer
 * @returns {Promise<Array<string>>} - Array of PicoROM device names
 */
async function listPicoROMs() {
    try {
        // Get all available serial ports
        const ports = await navigator.serial.getPorts();
        
        // Get the names of all connected PicoROM devices
        const names = [];
        for (const port of ports) {
            const picoROM = new PicoROM(port);
            try {
                await picoROM.open();
                const name = await picoROM.getName();
                names.push(name);
            } catch (error) {
                // This port might not be a PicoROM device, skip it
                console.debug(`Port is not a PicoROM device:`, error);
            } finally {
                // Try to close the port if it was opened
                try {
                    await picoROM.close();
                } catch (e) {
                    // Ignore close errors
                }
            }
        }
        
        return names;
    } catch (error) {
        console.error("Error listing PicoROM devices:", error);
        throw error;
    }
}

/**
 * Request permission to access a PicoROM device
 * @returns {Promise<SerialPort>} - The selected serial port
 */
async function requestPicoROMDevice() {
    if (!navigator.serial?.requestPort) {
        throw new Error('PicoROM needs desktop Chrome with Web Serial enabled. For a hosted version, use HTTPS or localhost. You can still edit and export ROM files here.');
    }
    try {
        // Request a serial port - user will need to select the correct one
        const port = await navigator.serial.requestPort({
            filters: [{ usbVendorId: PICOROM_VID, usbProductId: PICOROM_PID }]
        });
        
        return port;
    } catch (error) {
        console.error("Error requesting PicoROM device:", error);
        throw error;
    }
}

/**
 * Upload binary data to a PicoROM device
 * @param {ArrayBuffer} binaryData - The binary data to upload
 * @param {Function} progressCallback - Callback for upload progress
 * @param {string} name - Optional name to set on the device after upload
 * @returns {Promise<void>}
 */
async function uploadToPicoROM(binaryData, progressCallback = null, name = null) {
    const length = binaryData.byteLength;
    if (length !== 131072 && length !== 262144) {
        throw new Error('PicoROM uploads require a complete 128 KiB or 256 KiB ROM image');
    }
    if (name && (name.includes('\0') || new TextEncoder().encode(name).length > 15)) {
        throw new Error('PicoROM bank names must fit within 15 UTF-8 bytes');
    }
    let port;
    let picoROM;
    let failure = null;

    try {
        // Request permission to access a PicoROM device
        port = await requestPicoROMDevice();
        
        // Connect to the device
        picoROM = new PicoROM(port);
        await picoROM.open();
        
        // Upload the binary data
        await picoROM.upload(binaryData, length - 1, progressCallback, true);
        // Legacy firmware persists `name` immediately. Keep that separate write
        // after the verified ROM commit, and validate its size before opening.
        if (name) await picoROM.setParameter('name', name);
        
        return true;
    } catch (error) {
        failure = error;
        console.error("Error uploading to PicoROM:", error);
        throw error;
    } finally {
        // Close the connection
        if (picoROM) {
            try { await picoROM.close(); }
            catch (closeError) {
                // Preserve the useful transfer error if disconnect also makes
                // close fail; a close-only failure must still be reported.
                if (!failure) throw closeError;
                console.debug('PicoROM cleanup after transfer failure:', closeError);
            }
        }
    }
}

/**
 * Read the entire ROM image from a PicoROM device
 * @param {Function} progressCallback - Callback for read progress
 * @returns {Promise<ArrayBuffer>} - The ROM image data
 */
async function readImageFromPicoROM(progressCallback = null) {
    let port;
    let picoROM;
    let failure = null;

    try {
        port = await requestPicoROMDevice();
        picoROM = new PicoROM(port);
        await picoROM.open();
        const image = await picoROM.readImage(progressCallback);
        return image;
    } catch (error) {
        failure = error;
        console.error("Error reading image from PicoROM:", error);
        throw error;
    } finally {
        if (picoROM) {
            try { await picoROM.close(); }
            catch (closeError) {
                // Preserve the useful transfer error if disconnect also makes
                // close fail; a close-only failure must still be reported.
                if (!failure) throw closeError;
                console.debug('PicoROM cleanup after transfer failure:', closeError);
            }
        }
    }
}

// Export the API functions
window.PicoROM = {
    listDevices: listPicoROMs,
    upload: uploadToPicoROM,
    requestDevice: requestPicoROMDevice,
    readImage: readImageFromPicoROM
};
