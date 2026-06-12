class SynthEngine {
  constructor() {
    this.audioCtx = null;
    this.isPlaying = false;
    this.timeouts = [];
    this.activeNodes = [];
  }

  play(onProgress, onEnded) {
    if (this.isPlaying) this.stop();
    this.isPlaying = true;
    try {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      this.isPlaying = false;
      if (onEnded) onEnded();
      return;
    }
    const notes = [
      { freq: 261.63, type: 'triangle' },
      { freq: 329.63, type: 'triangle' },
      { freq: 392.00, type: 'sine' },
      { freq: 523.25, type: 'triangle' },
      { freq: 392.00, type: 'sine' },
      { freq: 523.25, type: 'triangle' },
      { freq: 659.25, type: 'sine' },
      { freq: 783.99, type: 'triangle' },
      { freq: 659.25, type: 'sine' },
      { freq: 783.99, type: 'triangle' },
      { freq: 1046.50, type: 'triangle' },
      { freq: 783.99, type: 'sine' },
      { freq: 659.25, type: 'triangle' },
      { freq: 523.25, type: 'sine' },
      { freq: 392.00, type: 'triangle' },
      { freq: 329.63, type: 'sine' },
      { freq: 261.63, type: 'triangle' },
      { freq: 329.63, type: 'triangle' },
      { freq: 392.00, type: 'sine' },
      { freq: 523.25, type: 'triangle' }
    ];
    const tempo = 150;
    const noteLength = 60 / tempo / 2;
    const totalDuration = notes.length * noteLength;
    let startTime = this.audioCtx.currentTime + 0.1;
    notes.forEach((note, index) => {
      const noteTime = startTime + index * noteLength;
      const osc = this.audioCtx.createOscillator();
      const gainNode = this.audioCtx.createGain();
      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freq, noteTime);
      gainNode.gain.setValueAtTime(0, noteTime);
      gainNode.gain.linearRampToValueAtTime(0.12, noteTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, noteTime + noteLength - 0.01);
      osc.connect(gainNode);
      gainNode.connect(this.audioCtx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + noteLength);
      this.activeNodes.push(osc);
      const progressTimeout = setTimeout(() => {
        if (!this.isPlaying) return;
        if (onProgress) onProgress((index + 1) / notes.length, (index + 1) * noteLength, totalDuration);
      }, (noteTime - this.audioCtx.currentTime) * 1000);
      this.timeouts.push(progressTimeout);
    });
    const endTimeout = setTimeout(() => {
      this.isPlaying = false;
      this.cleanup();
      if (onEnded) onEnded();
    }, (startTime + totalDuration - this.audioCtx.currentTime) * 1000);
    this.timeouts.push(endTimeout);
  }

  stop() {
    this.isPlaying = false;
    this.timeouts.forEach(clearTimeout);
    this.timeouts = [];
    this.activeNodes.forEach(node => { try { node.stop(); } catch(e) {} });
    this.activeNodes = [];
    this.cleanup();
  }

  cleanup() {
    if (this.audioCtx) {
      if (this.audioCtx.state !== 'closed') this.audioCtx.close();
      this.audioCtx = null;
    }
  }
}
window.SynthEngine = SynthEngine;
