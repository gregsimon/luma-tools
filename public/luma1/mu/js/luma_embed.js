// Bridge for the Luma Tools shell (../index.html), which hosts this editor in Luma-Mu mode.
// The shell's Librarian uses it to open Drive files here and to save this editor's sound and bank.
window.LumaMuBridge = Object.freeze({
  importFile(arrayBuffer, filename) {
    return importFiles([new File([arrayBuffer], filename)]);
  },
  hasEditorSound() {
    return !!editorSound;
  },
  // The current selection as it would be added to a slot (pitch applied), as ROM bytes and WAV.
  editorFiles() {
    if (!editorSound) throw new Error('No sound in the Luma-Mu editor.');
    const rendered = renderEditorSelection(false);
    const name = withoutExtension(de('sample_name_mu').value || sampleName);
    const wav = wavBytes(LumaSound.fromBytes(rendered.bytes, rendered.rate).pcm, rendered.rate);
    return { name, bin: rendered.bytes, wav };
  },
  bankZip() {
    return buildBankZip();
  },
  stop() {
    stopPlayingSound();
  },
});

// The shell talks to this editor with postMessage rather than by reaching into this window:
// opened from disk (file://), every file is its own origin and direct access is blocked.
// Request:  {lumaMu:'call', id, method, args}   Reply: {lumaMu:'result', id, ok, value|error}
// Sent once this editor is ready: {lumaMu:'ready'}
(function () {
  if (window.parent === window) return;
  const fromDisk = location.protocol === 'file:';
  const target = fromDisk ? '*' : location.origin; // a file:// origin is "null" and can't be named
  window.addEventListener('message', async event => {
    if (event.source !== window.parent || (!fromDisk && event.origin !== location.origin)) return;
    const msg = event.data;
    if (!msg || msg.lumaMu !== 'call') return;
    let reply;
    try {
      const fn = window.LumaMuBridge[msg.method];
      if (typeof fn !== 'function') throw new Error('Unknown request ' + msg.method);
      reply = { lumaMu: 'result', id: msg.id, ok: true, value: await fn(...(msg.args || [])) };
    } catch (error) {
      reply = { lumaMu: 'result', id: msg.id, ok: false, error: error.message || String(error) };
    }
    window.parent.postMessage(reply, target);
  });
  // body onload (luma1_init) runs after this listener, so announce on the next tick
  window.addEventListener('load', () => setTimeout(() => window.parent.postMessage({ lumaMu: 'ready' }, target)));
})();
