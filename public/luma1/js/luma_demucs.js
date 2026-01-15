// Drum extraction using Demucs ONNX
// This module requires onnxruntime-web to be loaded.

let demucsSession = null;

async function loadDemucsModel() {
  if (demucsSession) return demucsSession;
  
  updateDemucsStatus("Loading model...", 0);
  try {
    const modelUrl = 'models/htdemucs.onnx';
    
    // Explicitly check if the files are reachable
    const response = await fetch(modelUrl);
    if (!response.ok) throw new Error(`Could not find model at ${modelUrl}`);
    
    // Check for the .data file manually too
    const dataCheck = await fetch(modelUrl + '.data', { method: 'HEAD' });
    if (!dataCheck.ok) {
        throw new Error(`Model structure found, but ${modelUrl}.data weights file is missing!`);
    }

    // Configure global ONNX environment
    ort.env.wasm.numThreads = 1; // Double-ensure single threading
    
    // Configure session options to be robust for local servers
    const sessionOptions = {
      executionProviders: ['webgpu', 'wasm'],
      graphOptimizationLevel: 'all',
      // Disable threading to avoid SharedArrayBuffer/COOP/COEP issues
      wasm: {
        numThreads: 1,
        proxy: false
      }
    };

    console.log("Attempting to load model from:", modelUrl);
    demucsSession = await ort.InferenceSession.create(modelUrl, sessionOptions);
    console.log("Model loaded successfully!");
    updateDemucsStatus("Model loaded.", 100);
    return demucsSession;
  } catch (e) {
    console.error("Failed to load Demucs model. Full error object:", e);
    
    let errorMsg = e.message || "Unknown error";
    if (typeof e === 'number') {
        errorMsg = `WASM Error Code: ${e} (This often indicates an Out-of-Memory or Initialization error with 100MB+ models)`;
    }
    
    console.error("Diagnostic Message:", errorMsg);
    
    // Try fallback to WASM only with explicit single thread
    try {
        console.log("Attempting WASM fallback...");
        const modelUrl = 'models/htdemucs.onnx';
        demucsSession = await ort.InferenceSession.create(modelUrl, {
            executionProviders: ['wasm'],
            wasm: { numThreads: 1 }
        });
        console.log("WASM fallback loaded successfully!");
        updateDemucsStatus("Model loaded (WASM fallback).", 100);
        return demucsSession;
    } catch (e2) {
        console.error("WASM fallback also failed. Full error:", e2);
        let errorMsg2 = e2.message || "Unknown error";
        if (typeof e2 === 'number') errorMsg2 = `WASM Error Code: ${e2}`;
        updateDemucsStatus(`Error: ${errorMsg2}`, 0);
        return null;
    }
  }
}

function updateDemucsStatus(text, progress) {
  const statusDiv = document.getElementById("demucs_status");
  const progressSpan = document.getElementById("demucs_progress");
  if (statusDiv) statusDiv.style.display = "block";
  if (progressSpan) {
    progressSpan.textContent = text + (progress !== undefined && progress < 100 ? ` (${progress}%)` : "");
  }
}

async function extractDrumsFromEditor() {
  if (!editorSampleData || editorSampleLength === 0) {
    alert("No sample loaded in editor.");
    return;
  }

  const currentRate = getSelectedSampleRate();
  const audioBuffer = createAudioBufferFromBytes(editorSampleData, currentRate);
  
  const drumsBuffer = await extractDrumsFromAudioBuffer(audioBuffer);
  if (drumsBuffer) {
    // Convert extracted drums back to u-law
    const drumsData = createBytesFromAudioBuffer(drumsBuffer);
    editorSampleData = drumsData;
    editorSampleLength = drumsData.length;
    
    if (typeof resetRange === 'function') resetRange();
    updateBinaryFileOriginal();
    if (typeof redrawAllWaveforms === 'function') redrawAllWaveforms();
    updateDemucsStatus("Drums extracted!", 100);
    setTimeout(() => {
      const statusDiv = document.getElementById("demucs_status");
      if (statusDiv) statusDiv.style.display = "none";
    }, 3000);
  }
}

async function extractDrumsFromAudioBuffer(audioBuffer) {
  const session = await loadDemucsModel();
  if (!session) return null;

  updateDemucsStatus("Preprocessing audio...", 10);
  
  // Demucs v4 (htdemucs) expects 44.1kHz stereo
  const targetRate = 44100;
  
  // Create a stereo buffer if mono
  let stereoBuffer;
  if (audioBuffer.numberOfChannels === 1) {
    stereoBuffer = actx.createBuffer(2, audioBuffer.length, audioBuffer.sampleRate);
    const data = audioBuffer.getChannelData(0);
    stereoBuffer.getChannelData(0).set(data);
    stereoBuffer.getChannelData(1).set(data);
  } else {
    stereoBuffer = audioBuffer;
  }

  // Resample to 44.1kHz using OfflineAudioContext
  const offlineCtx = new OfflineAudioContext(2, Math.ceil(stereoBuffer.duration * targetRate), targetRate);
  const source = offlineCtx.createBufferSource();
  source.buffer = stereoBuffer;
  source.connect(offlineCtx.destination);
  source.start();
  const resampledBuffer = await offlineCtx.startRendering();

  updateDemucsStatus("Running inference...", 30);
  
  // Prepare input tensor: [1, 2, length]
  const length = resampledBuffer.length;
  const floatData = new Float32Array(length * 2);
  floatData.set(resampledBuffer.getChannelData(0), 0);
  floatData.set(resampledBuffer.getChannelData(1), length);
  
  const inputTensor = new ort.Tensor('float32', floatData, [1, 2, length]);
  
  try {
    const feeds = {};
    feeds[session.inputNames[0]] = inputTensor;
    
    const results = await session.run(feeds);
    const outputTensor = results[session.outputNames[0]];
    
    updateDemucsStatus("Postprocessing...", 80);
    
    // Output tensor for a drums-only model is expected to be [1, 2, length]
    // or if it's a full htdemucs model, it might be [1, 4, 2, length] (4 stems)
    let drumsData;
    let outChannels = 2;
    
    if (outputTensor.dims.length === 4) {
        // [batch, stem, channel, length] - assume drums is stem 0
        const stemLength = outputTensor.data.length / outputTensor.dims[1];
        drumsData = outputTensor.data.subarray(0, stemLength);
    } else {
        drumsData = outputTensor.data;
    }
    
    const outLength = drumsData.length / outChannels;
    const drumsBuffer = new AudioBuffer({
      numberOfChannels: 2,
      length: outLength,
      sampleRate: targetRate
    });
    
    drumsBuffer.getChannelData(0).set(drumsData.subarray(0, outLength));
    drumsBuffer.getChannelData(1).set(drumsData.subarray(outLength));
    
    return drumsBuffer;
  } catch (e) {
    console.error("Inference failed:", e);
    updateDemucsStatus("Error: Inference failed.", 0);
    return null;
  }
}
