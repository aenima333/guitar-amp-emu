class GuitarAmp {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    // Start in suspended state
    if (this.audioContext.state === 'running') {
      this.audioContext.suspend();
    }
    this.setupAudioNodes();
    this.setupEventListeners();
    this.currentChannel = 'clean';
    this.currentStream = null;
    this.visualizerCtx = null;
    this.visualizerData = null;
    this.setupVisualizer();
    this.audioResumed = false;
  }

  setupAudioNodes() {
    // Create audio nodes
    this.input = this.audioContext.createGain();
    this.gainNode = this.audioContext.createGain();
    
    // Create EQ nodes
    this.bass = this.audioContext.createBiquadFilter();
    this.lowMid = this.audioContext.createBiquadFilter();
    this.highMid = this.audioContext.createBiquadFilter();
    this.treble = this.audioContext.createBiquadFilter();
    this.presence = this.audioContext.createBiquadFilter();
    
    // Configure EQ
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 120;
    this.lowMid.type = 'peaking';
    this.lowMid.frequency.value = 400;
    this.lowMid.Q.value = 1;
    this.highMid.type = 'peaking';
    this.highMid.frequency.value = 2000;
    this.highMid.Q.value = 1;
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 5000;
    this.presence.type = 'highshelf';
    this.presence.frequency.value = 8000;
    
    // Create dynamics processors
    this.noiseGate = this.audioContext.createDynamicsCompressor();
    this.noiseGate.threshold.value = -50;
    this.noiseGate.knee.value = 0;
    this.noiseGate.ratio.value = 20;
    this.noiseGate.attack.value = 0.003;
    this.noiseGate.release.value = 0.250;
    
    this.compressor = this.audioContext.createDynamicsCompressor();
    this.compressor.threshold.value = -24;
    this.compressor.knee.value = 30;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.010;
    this.compressor.release.value = 0.250;
    
    // Create reverb
    this.reverb = this.audioContext.createConvolver();
    this.reverbDry = this.audioContext.createGain();
    this.reverbWet = this.audioContext.createGain();
    this.reverbDry.gain.value = 1;
    this.reverbWet.gain.value = 0;
    
    this.toneNode = this.audioContext.createBiquadFilter();
    this.output = this.audioContext.createGain();
    this.convolver = this.audioContext.createConvolver();
    
    // Create analyzer nodes for level meters
    this.inputAnalyzer = this.audioContext.createAnalyser();
    this.outputAnalyzer = this.audioContext.createAnalyser();
    this.inputAnalyzer.fftSize = 32;
    this.outputAnalyzer.fftSize = 32;
    
    // Configure nodes
    this.gainNode.gain.value = 0.5;
    this.toneNode.type = 'lowpass';
    this.toneNode.frequency.value = 2000;
    this.output.gain.value = 0.5;
    
    // Create distortion curve
    this.distortion = this.audioContext.createWaveShaper();
    this.distortion.curve = this.makeDistortionCurve(400);
    this.distortion.oversample = '4x';
    
    // Connect nodes for clean channel
    this.input.connect(this.inputAnalyzer);
    this.inputAnalyzer.connect(this.noiseGate);
    this.noiseGate.connect(this.gainNode);
    this.gainNode.connect(this.bass);
    this.bass.connect(this.lowMid);
    this.lowMid.connect(this.highMid);
    this.highMid.connect(this.treble);
    this.treble.connect(this.presence);
    this.presence.connect(this.compressor);
    this.compressor.connect(this.toneNode);
    
    // Create parallel reverb path
    this.toneNode.connect(this.reverbDry);
    this.toneNode.connect(this.reverb);
    this.reverb.connect(this.reverbWet);
    
    // Mix dry and wet signals
    this.reverbDry.connect(this.convolver);
    this.reverbWet.connect(this.convolver);
    
    this.convolver.connect(this.output);
    this.output.connect(this.outputAnalyzer);
    this.outputAnalyzer.connect(this.audioContext.destination);

    // Start meter update loop
    this.updateMeters();
  }

  async loadIR(file) {
    const irLoader = document.querySelector('.ir-loader');
    try {
      // Set loading state
      irLoader.classList.add('loading');
      irLoader.classList.remove('error');
      
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.convolver.buffer = audioBuffer;
      
      // Clear loading state
      irLoader.classList.remove('loading');
    } catch (error) {
      console.error('Error loading IR file:', error);
      // Set error state
      irLoader.classList.remove('loading');
      irLoader.classList.add('error');
    }
  }

  async setupDeviceSelector() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter(device => device.kind === 'audioinput');
      
      const deviceSelect = document.getElementById('audio-device');
      deviceSelect.innerHTML = '<option value="">Select Device</option>';
      
      audioInputs.forEach(device => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.text = device.label || `Device ${deviceSelect.length}`;
        deviceSelect.appendChild(option);
      });
      
      deviceSelect.addEventListener('change', () => {
        this.changeInputDevice(deviceSelect.value);
      });
    } catch (error) {
      console.error('Error setting up device selector:', error);
    }
  }

  async changeInputDevice(deviceId) {
    try {
      if (this.currentStream) {
        this.currentStream.getTracks().forEach(track => track.stop());
      }

      const constraints = {
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };
      
      this.currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      const source = this.audioContext.createMediaStreamSource(this.currentStream);
      this.input.gain.value = 1.5; // Boost input gain for better signal
      source.connect(this.input);
      console.log('Input device connected:', deviceId);
    } catch (error) {
      console.error('Error changing input device:', error);
    }
  }

  setupVisualizer() {
    const canvas = document.createElement('canvas');
    canvas.id = 'visualizer';
    canvas.width = 300;
    canvas.height = 100;
    canvas.style.width = '100%';
    canvas.style.height = '100px';
    canvas.style.backgroundColor = '#222';
    document.querySelector('.controls').prepend(canvas);
    
    this.visualizerCtx = canvas.getContext('2d');
    this.visualizerData = new Uint8Array(this.inputAnalyzer.fftSize);
  }

  drawVisualizer() {
    if (!this.visualizerCtx) return;
    
    const canvas = this.visualizerCtx.canvas;
    const width = canvas.width;
    const height = canvas.height;
    
    this.inputAnalyzer.getByteTimeDomainData(this.visualizerData);
    
    this.visualizerCtx.fillStyle = '#222';
    this.visualizerCtx.fillRect(0, 0, width, height);
    
    this.visualizerCtx.lineWidth = 2;
    this.visualizerCtx.strokeStyle = '#4caf50';
    this.visualizerCtx.beginPath();
    
    const sliceWidth = width / this.visualizerData.length;
    let x = 0;
    
    for (let i = 0; i < this.visualizerData.length; i++) {
      const v = this.visualizerData[i] / 128.0;
      const y = (v * height) / 2;
      
      if (i === 0) {
        this.visualizerCtx.moveTo(x, y);
      } else {
        this.visualizerCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    
    this.visualizerCtx.lineTo(width, height / 2);
    this.visualizerCtx.stroke();
    
    requestAnimationFrame(() => this.drawVisualizer());
  }

  setupEventListeners() {
    const resumeAudio = () => {
      if (!this.audioResumed) {
        this.audioContext.resume();
        this.audioResumed = true;
      }
    };

    // Channel switching
    document.getElementById('clean-channel').addEventListener('click', () => {
      resumeAudio();
      this.switchChannel('clean');
    });
    
    document.getElementById('distorted-channel').addEventListener('click', () => {
      resumeAudio();
      this.switchChannel('distorted');
    });

    // Real-time controls
    document.getElementById('gain').addEventListener('input', (e) => {
      resumeAudio();
      this.gainNode.gain.value = parseFloat(e.target.value);
    });

    document.getElementById('volume').addEventListener('input', (e) => {
      resumeAudio();
      this.output.gain.value = parseFloat(e.target.value);
    });

    document.getElementById('tone').addEventListener('input', (e) => {
      resumeAudio();
      this.toneNode.frequency.value = 100 + (parseFloat(e.target.value) * 4900);
    });

    // EQ Controls
    document.getElementById('bass').addEventListener('input', (e) => {
      resumeAudio();
      this.bass.gain.value = parseFloat(e.target.value);
    });
    document.getElementById('low-mid').addEventListener('input', (e) => {
      resumeAudio();
      this.lowMid.gain.value = parseFloat(e.target.value);
    });
    document.getElementById('high-mid').addEventListener('input', (e) => {
      resumeAudio();
      this.highMid.gain.value = parseFloat(e.target.value);
    });
    document.getElementById('treble').addEventListener('input', (e) => {
      resumeAudio();
      this.treble.gain.value = parseFloat(e.target.value);
    });
    document.getElementById('presence').addEventListener('input', (e) => {
      resumeAudio();
      this.presence.gain.value = parseFloat(e.target.value);
    });

    // Dynamics Controls
    document.getElementById('noise-gate-threshold').addEventListener('input', (e) => {
      resumeAudio();
      this.noiseGate.threshold.value = parseFloat(e.target.value);
    });
    document.getElementById('compressor-threshold').addEventListener('input', (e) => {
      resumeAudio();
      this.compressor.threshold.value = parseFloat(e.target.value);
    });
    document.getElementById('compressor-ratio').addEventListener('input', (e) => {
      resumeAudio();
      this.compressor.ratio.value = parseFloat(e.target.value);
    });

    // Reverb Control
    document.getElementById('reverb-mix').addEventListener('input', (e) => {
      resumeAudio();
      const mix = parseFloat(e.target.value);
      this.reverbDry.gain.value = 1 - mix;
      this.reverbWet.gain.value = mix;
    });
  }

  switchChannel(channel) {
    if (channel === this.currentChannel) return;
    
    // Update UI
    document.querySelectorAll('.channel-selector button').forEach(btn => {
      btn.classList.remove('active');
    });
    document.getElementById(`${channel}-channel`).classList.add('active');
    
    // Reconnect audio nodes based on channel
    this.gainNode.disconnect();
    this.toneNode.disconnect();
    
    if (channel === 'clean') {
      this.gainNode.connect(this.toneNode);
      this.toneNode.connect(this.output);
    } else {
      this.gainNode.connect(this.distortion);
      this.distortion.connect(this.toneNode);
      this.toneNode.connect(this.output);
    }
    
    this.currentChannel = channel;
  }

  makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 400;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    
    for (let i = 0; i < n_samples; i++) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  updateMeters() {
    const inputData = new Float32Array(this.inputAnalyzer.fftSize);
    const outputData = new Float32Array(this.outputAnalyzer.fftSize);
    
    this.inputAnalyzer.getFloatTimeDomainData(inputData);
    this.outputAnalyzer.getFloatTimeDomainData(outputData);
    
    // Calculate RMS levels
    const inputLevel = Math.sqrt(inputData.reduce((sum, x) => sum + x * x, 0) / inputData.length);
    const outputLevel = Math.sqrt(outputData.reduce((sum, x) => sum + x * x, 0) / outputData.length);
    
    // Update meter elements
    const inputMeter = document.querySelector('.input-meter .meter-fill');
    const outputMeter = document.querySelector('.output-meter .meter-fill');
    
    if (inputMeter) {
      inputMeter.style.height = `${Math.min(inputLevel * 100, 100)}%`;
    }
    if (outputMeter) {
      outputMeter.style.height = `${Math.min(outputLevel * 100, 100)}%`;
    }
    
    // Request next frame
    requestAnimationFrame(() => this.updateMeters());
  }
}

// Initialize amp when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const amp = new GuitarAmp();
  
  // Setup IR file loader
  document.getElementById('ir-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      amp.loadIR(file);
    }
  });

  // Setup device selector
  amp.setupDeviceSelector();
  
  // Setup microphone input
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        amp.currentStream = stream;
        const source = amp.audioContext.createMediaStreamSource(stream);
        source.connect(amp.input);
      })
      .catch(err => {
        console.error('Error accessing microphone:', err);
      });
  }
});
