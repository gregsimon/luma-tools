/**
 * PicoROM Web Serial API
 * 
 * This file provides a JavaScript implementation for communicating with PicoROM devices
 * via Web Serial, based on the protocol defined in the Rust implementation at:
 * https://github.com/wickerwaka/PicoROM/blob/main/host/picolink/src/lib.rs
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
        this.readLoop = null;
        this.debug = false;
    }

    /**
     * Open a connection to the PicoROM device
     * @param {Object} options - Serial port options
     */
    async open(options = {}) {
        try {
            // Use baud rate from Rust implementation: 9600 for non-macOS, auto-detect for macOS
            const isMacOS = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const defaultBaudRate = 9600;
            
            await this.port.open({
                baudRate: options.baudRate || defaultBaudRate,
                dataBits: options.dataBits || 8,
                stopBits: options.stopBits || 1,
                parity: options.parity || 'none',
                bufferSize: options.bufferSize || 255,
                flowControl: options.flowControl || 'none'
            });
            
            // Wait for the "PicoROM Hello" message (same as Rust implementation)
            const expected = "PicoROM Hello";
            let preamble = "";
            
            this.reader = this.port.readable.getReader();
            
            while (preamble.length < expected.length || !preamble.includes(expected)) {
                const { value, done } = await this.reader.read();
                if (done) break;
                
                const text = new TextDecoder().decode(value);
                preamble += text;
                
                if (this.debug) {
                    console.log("Received preamble chunk:", text);
                }
            }
            
            if (!preamble.includes(expected)) {
                throw new Error("Did not receive expected PicoROM Hello message");
            }
            
            if (this.debug) {
                console.log("PicoROM Hello received successfully");
            }
            
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
        if (this.reader) {
            await this.reader.cancel();
            this.reader = null;
        }
        
        if (this.port && this.port.readable) {
            await this.port.close();
        }
        
        this.port = null;
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
                const offset = new Uint32Array([packet.offset]);
                payload = new Uint8Array(offset.buffer);
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
        try {
            const deadline = Date.now() + timeout;

            if (this.debug) {
                console.log("receivePacket: "+deadline);
            }
            
            // Read the packet header (kind and size)
            let headerData = new Uint8Array(0);
            let extraData = new Uint8Array(0); // Buffer for any extra data read during header read
            
            while (headerData.length < 2 && Date.now() < deadline) {
                const { value, done } = await this.reader.read();
                if (done) break;
                
                const newData = new Uint8Array(headerData.length + value.length);
                newData.set(headerData);
                newData.set(value, headerData.length);
                
                // If we now have more than 2 bytes, split into header and extra data
                if (newData.length >= 2) {
                    headerData = newData.slice(0, 2);
                    extraData = newData.slice(2);
                    break;
                } else {
                    headerData = newData;
                }
            }
            
            if (headerData.length < 2) {
                return null; // Timeout
            }
            
            const kind = headerData[0];
            const size = headerData[1];
            
            if (size > 30) {
                throw new Error(`Packet payload too large: ${size}`);
            }
            
            // Read the packet payload, starting with any extra data we already have
            let payload = extraData;
            while (payload.length < size && Date.now() < deadline) {
                const { value, done } = await this.reader.read();
                if (done) break;
                
                const newData = new Uint8Array(payload.length + value.length);
                newData.set(payload);
                newData.set(value, payload.length);
                payload = newData;
            }
            
            if (payload.length < size) {
                if (this.debug) {
                    console.log("receivePacket timedout");
                }
                return null; // Timeout
            }
            
            // Take only the required size
            payload = payload.slice(0, size);

            if (this.debug) {
                console.log("receivePacket: "+payload.length);
            }
            
            // Decode the packet based on its kind
            return this.decodePacket(kind, payload);
        } catch (error) {
            console.error("Error receiving packet:", error);
            throw error;
        }
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
                    value: decoder.decode(payload)
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

        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
            const response = await this.receivePacket();
            if (!response) continue;

            if (response.type === 'Parameter') {
                return response.value;
            } else if (response.type === 'ParameterError') {
                throw new Error(`Could not get parameter '${name}'`);
            }
        }

        throw new Error('Timeout waiting for parameter response');
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

        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
            const response = await this.receivePacket();
            if (!response) continue;

            if (response.type === 'Parameter') {
                return; // Success
            } else if (response.type === 'ParameterError') {
                throw new Error(`Could not set parameter '${name}' to '${value}'`);
            }
        }

        throw new Error('Timeout waiting for parameter set response');
    }

    /**
     * Upload binary data to the PicoROM device
     * @param {ArrayBuffer} data - The binary data to upload
     * @param {number} addrMask - The address mask to use
     * @param {Function} progressCallback - Callback for upload progress
     * @returns {Promise<void>}
     */
    async upload(data, addrMask = 0xFFFFFFFF, progressCallback = null) {
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
            
            uploaded += chunk.length;
            if (progressCallback) {
                progressCallback(uploaded, bytes.length);
            }
        }
        
        // Verify the upload by getting the current pointer position
        await this.sendPacket({
            type: 'PointerGet'
        });
        
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline) {
            const response = await this.receivePacket();
            if (!response) continue;
            
            if (response.type === 'PointerCur') {
                if (response.offset !== bytes.length) {
                    throw new Error(`Upload did not complete. Expected ${bytes.length} bytes, got ${response.offset}`);
                }
                break;
            }
        }
        
        // Set the address mask parameter
        await this.sendPacket({
            type: 'ParameterSet',
            param: 'addr_mask',
            value: `0x${addrMask.toString(16)}`
        });
        
        // Commit the flash
        await this.sendPacket({
            type: 'CommitFlash'
        });
        
        // Wait for the commit to complete
        const commitDeadline = Date.now() + 5000; // 5 second timeout for commit
        while (Date.now() < commitDeadline) {
            const response = await this.receivePacket();
            if (!response) continue;
            
            if (response.type === 'CommitDone') {
                return; // Success
            }
        }
        
        throw new Error('Timeout waiting for commit to complete');
    }

    /**
     * Read the entire ROM image from the PicoROM device
     * @param {Function} progressCallback - Callback for read progress
     * @returns {Promise<ArrayBuffer>} - The ROM image data
     */
    async readImage(progressCallback = null) {
        // Get the address mask to determine the ROM size
        const addrMaskStr = await this.getParameter('addr_mask');
        const addrMask = parseInt(addrMaskStr, 16);
        const imageSize = addrMask + 1;

        if (isNaN(imageSize) || imageSize <= 0) {
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

            const response = await this.receivePacket(1000);

            if (response && response.type === 'ReadData') {
                const chunk = response.data;
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
            try {
                const picoROM = new PicoROM(port);
                await picoROM.open();
                const name = await picoROM.getName();
                names.push(name);
            } catch (error) {
                // This port might not be a PicoROM device, skip it
                console.debug(`Port is not a PicoROM device:`, error);
            } finally {
                // Try to close the port if it was opened
                try {
                    if (port.readable) {
                        await port.close();
                    }
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
    try {
        // Request a serial port - user will need to select the correct one
        const port = await navigator.serial.requestPort({
            // Note: We can't filter by VID/PID in Web Serial API
            // User will need to select the correct PicoROM device
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
    let port;
    let picoROM;
    
    try {
        // Request permission to access a PicoROM device
        port = await requestPicoROMDevice();
        
        // Connect to the device
        picoROM = new PicoROM(port);
        await picoROM.open();
        
        // Upload the binary data
        await picoROM.upload(binaryData, 0xFFFFFFFF, progressCallback);
        
        // Set the name parameter if provided
        if (name) {
            await picoROM.setParameter('name', name);
        }
        
        return true;
    } catch (error) {
        console.error("Error uploading to PicoROM:", error);
        throw error;
    } finally {
        // Close the connection
        if (picoROM) {
            await picoROM.close();
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

    try {
        port = await requestPicoROMDevice();
        picoROM = new PicoROM(port);
        await picoROM.open();
        const image = await picoROM.readImage(progressCallback);
        return image;
    } catch (error) {
        console.error("Error reading image from PicoROM:", error);
        throw error;
    } finally {
        if (picoROM) {
            await picoROM.close();
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
