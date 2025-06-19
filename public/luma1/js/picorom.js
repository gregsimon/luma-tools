/**
 * PicoROM WebUSB API
 * 
 * This file provides a JavaScript implementation for communicating with PicoROM devices
 * via WebUSB, based on the protocol defined in the Rust implementation at:
 * https://github.com/wickerwaka/PicoROM/blob/main/host/picolink/src/lib.rs
 */

// PicoROM USB Vendor ID and Product ID
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
 * PicoROM class for communicating with PicoROM devices via WebUSB
 */
class PicoROM {
    constructor(device) {
        this.device = device;
        this.interface = null;
        this.endpointIn = null;
        this.endpointOut = null;
        this.debug = false;
    }

    /**
     * Open a connection to the PicoROM device
     */
    async open() {
        try {
            await this.device.open();
            
            // If the device is not configured yet, select the configuration
            if (this.device.configuration === null) {
                await this.device.selectConfiguration(1);
            }
            
            // Claim the interface
            const interfaceObj = this.device.configuration.interfaces[0];
            this.interface = interfaceObj.alternates[0];
            
            // Get the endpoints
            for (const endpoint of this.interface.endpoints) {
                if (endpoint.direction === 'in') {
                    this.endpointIn = endpoint.endpointNumber;
                } else {
                    this.endpointOut = endpoint.endpointNumber;
                }
            }
            
            await this.device.claimInterface(interfaceObj.interfaceNumber);
            
            // Wait for the "PicoROM Hello" message
            const expected = "PicoROM Hello";
            let preamble = "";
            
            while (preamble.length < expected.length || !preamble.includes(expected)) {
                const result = await this.device.transferIn(this.endpointIn, 64);
                const data = new Uint8Array(result.data.buffer);
                const text = String.fromCharCode.apply(null, data.slice(0, result.data.byteLength));
                preamble += text;
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
        if (this.device && this.device.opened) {
            await this.device.close();
        }
    }

    /**
     * Send a packet to the PicoROM device
     * @param {Object} packet - The packet to send
     */
    async sendPacket(packet) {
        try {
            const encodedPacket = this.encodePacket(packet);
            await this.device.transferOut(this.endpointOut, encodedPacket);
        } catch (error) {
            console.error("Error sending packet:", error);
            throw error;
        }
    }

    /**
     * Encode a packet for sending to the PicoROM device
     * @param {Object} packet - The packet to encode
     * @returns {ArrayBuffer} - The encoded packet
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

        return data.buffer;
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
            
            // Read the packet header (kind and size)
            const headerResult = await this.device.transferIn(this.endpointIn, 2);
            if (headerResult.status !== 'ok' || headerResult.data.byteLength < 2) {
                throw new Error('Failed to read packet header');
            }
            
            const headerData = new Uint8Array(headerResult.data.buffer);
            const kind = headerData[0];
            const size = headerData[1];
            
            if (size > 30) {
                throw new Error(`Packet payload too large: ${size}`);
            }
            
            // Read the packet payload
            const payloadResult = await this.device.transferIn(this.endpointIn, size);
            if (payloadResult.status !== 'ok' || payloadResult.data.byteLength < size) {
                throw new Error('Failed to read packet payload');
            }
            
            const payload = new Uint8Array(payloadResult.data.buffer, 0, size);
            
            // Decode the packet based on its kind
            return this.decodePacket(kind, payload);
        } catch (error) {
            if (error.name === 'TimeoutError') {
                return null; // Timeout, no packet received
            }
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
}

/**
 * List all PicoROM devices connected to the computer
 * @returns {Promise<Array<string>>} - Array of PicoROM device names
 */
async function listPicoROMs() {
    try {
        // Request permission to access USB devices
        const devices = await navigator.usb.getDevices();
        
        // Filter for PicoROM devices
        const picoROMDevices = devices.filter(device => 
            device.vendorId === PICOROM_VID && device.productId === PICOROM_PID
        );
        
        // Get the names of all connected PicoROM devices
        const names = [];
        for (const device of picoROMDevices) {
            const picoROM = new PicoROM(device);
            try {
                await picoROM.open();
                const name = await picoROM.getName();
                names.push(name);
            } catch (error) {
                console.error(`Error getting name for device:`, error);
            } finally {
                await picoROM.close();
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
 * @returns {Promise<USBDevice>} - The selected USB device
 */
async function requestPicoROMDevice() {
    try {
        const device = await navigator.usb.requestDevice({
            filters: [{
                vendorId: PICOROM_VID,
                productId: PICOROM_PID
            }]
        });
        return device;
    } catch (error) {
        console.error("Error requesting PicoROM device:", error);
        throw error;
    }
}

/**
 * Upload binary data to a PicoROM device
 * @param {ArrayBuffer} binaryData - The binary data to upload
 * @param {Function} progressCallback - Callback for upload progress
 * @returns {Promise<void>}
 */
async function uploadToPicoROM(binaryData, progressCallback = null) {
    let device;
    let picoROM;
    
    try {
        // Request permission to access a PicoROM device
        device = await requestPicoROMDevice();
        
        // Connect to the device
        picoROM = new PicoROM(device);
        await picoROM.open();
        
        // Upload the binary data
        await picoROM.upload(binaryData, 0xFFFFFFFF, progressCallback);
        
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

// Export the API functions
window.PicoROM = {
    listDevices: listPicoROMs,
    upload: uploadToPicoROM,
    requestDevice: requestPicoROMDevice
};
