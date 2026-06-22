// --- State Management ---
    const state = {
      screen: 'intro', // intro, playing, victory
      pilotName: '연우',
      menuType: 'full', // full, single
      isDemoMode: false,
      gameTime: 1200,
      maxGameTime: 1200,
      score: 0,
      isMuted: false,
      phase: 'spoon', // spoon, side, soup, chew, scan
      currentMealStep: 'rice', // rice, side, soup, single
      phaseTimer: 15,
      chewProgress: 0,
      scanningStatus: 'ready', // ready, scanning, success
      cameraActive: false
    };

    let mainTimerInterval = null;
    let phaseTimerInterval = null;
    let videoStream = null;
    let mouthCheckFrameId = null;
    let faceLandmarker = null;
    let faceLandmarkerPromise = null;
    let mouthOpenStartedAt = null;
    let lastMouthDetectionAt = 0;

    const fullMealSequence = ['rice', 'side', 'soup'];
    const mealStepDetails = {
      rice: {
        phase: 'spoon',
        title: '밥 한 숟가락!',
        badge: '밥 에너지',
        image: 'assets/images/spoon-meal.png',
        alt: '밥을 숟가락으로 뜨는 그림',
        color: 'cyan',
        body: '먼저 <strong>밥</strong>을 한 숟가락 크게 떠서<br />입에 쏙 넣어주세요!'
      },
      side: {
        phase: 'side',
        title: '반찬 집기!',
        badge: '반찬 에너지',
        image: 'assets/images/spoon-meal.png',
        alt: '반찬을 먹는 그림',
        color: 'indigo',
        body: '이번엔 <strong>반찬</strong> 차례예요.<br />맛있는 반찬을 골라 입에 넣어주세요!'
      },
      soup: {
        phase: 'soup',
        title: '국 한 입!',
        badge: '국 에너지',
        image: 'assets/images/spoon-meal.png',
        alt: '국을 먹는 그림',
        color: 'sky',
        body: '마지막으로 <strong>국</strong>을 한 입 먹어요.<br />따뜻한 국 에너지까지 채우면 한 바퀴 완료!'
      },
      single: {
        phase: 'spoon',
        title: '한 입 에너지!',
        badge: '단일 에너지',
        image: 'assets/images/spoon-meal.png',
        alt: '음식을 한 입 뜨는 그림',
        color: 'cyan',
        body: '지금은 <strong>한 그릇 에너지</strong>를<br />한 입 크게 떠서 입에 넣는 시간!'
      }
    };

    const MOUTH_OPEN_HOLD_MS = 1200;
    const MOUTH_DETECTION_INTERVAL_MS = 160;
    const MOUTH_OPEN_RATIO_THRESHOLD = 0.2;
    const JAW_OPEN_THRESHOLD = 0.35;
    const MEDIAPIPE_TASKS_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';
    const MEDIAPIPE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
    const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

    // --- Audio Generator ---
    const playSound = (type) => {
      if (state.isMuted) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        
        if (type === 'beep') {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          gain.gain.setValueAtTime(0.05, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
        } else if (type === 'success') {
          const notes = [523.25, 659.25, 783.99, 1046.50];
          notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.1);
            gain.gain.setValueAtTime(0.08, ctx.currentTime + idx * 0.1);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.1 + 0.2);
            osc.start(ctx.currentTime + idx * 0.1);
            osc.stop(ctx.currentTime + idx * 0.1 + 0.2);
          });
        } else if (type === 'alert') {
          const duration = 1.0;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(300, ctx.currentTime);
          osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.3);
          osc.frequency.linearRampToValueAtTime(300, ctx.currentTime + 0.6);
          osc.frequency.linearRampToValueAtTime(600, ctx.currentTime + 0.9);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
          osc.start();
          osc.stop(ctx.currentTime + duration);
        } else if (type === 'victory') {
          const melody = [523.25, 523.25, 523.25, 523.25, 659.25, 587.33, 659.25, 783.99, 1046.50];
          const times = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.35];
          melody.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime + times[idx]);
            gain.gain.setValueAtTime(0.1, ctx.currentTime + times[idx]);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + times[idx] + (idx === 8 ? 0.8 : 0.2));
            osc.start(ctx.currentTime + times[idx]);
            osc.stop(ctx.currentTime + times[idx] + (idx === 8 ? 0.8 : 0.2));
          });
        }
      } catch (e) {
        console.error("Audio Synthesis Error: ", e);
      }
    };

    // --- Scan Flow Helpers ---
    const setScanLoading = (isLoading) => {
      document.getElementById('scan-loading-state').classList.toggle('hidden', !isLoading);
    };

    const setScanSuccessVisible = (isVisible) => {
      document.getElementById('scan-success-state').classList.toggle('hidden', !isVisible);
    };

    const resetScanFeedback = () => {
      setScanLoading(false);
      setScanSuccessVisible(false);
    };

    const animatePointGain = (points) => {
      const layer = document.getElementById('point-animation-layer');
      const scoreDisplay = document.getElementById('score-display');
      if (!layer || !scoreDisplay) return;

      const rect = scoreDisplay.getBoundingClientRect();
      const point = document.createElement('div');
      point.className = 'point-pop absolute px-4 py-2 rounded-full bg-yellow-400 text-slate-950 font-black text-2xl shadow-[0_0_28px_rgba(250,204,21,0.8)] border-2 border-white';
      point.style.left = `${rect.left + rect.width / 2}px`;
      point.style.top = `${rect.top + rect.height / 2}px`;
      point.textContent = `+${points}P`;

      const sparkles = document.createElement('div');
      sparkles.className = 'absolute -inset-4 text-center text-xl';
      sparkles.textContent = '✨ ✨ ✨';
      point.appendChild(sparkles);

      layer.appendChild(point);
      setTimeout(() => point.remove(), 1300);
    };

    const updateMouthCheckStatus = (message, tone = 'scanning') => {
      const dot = document.getElementById('camera-status-dot');
      const text = document.getElementById('camera-status-text');
      const hint = document.getElementById('scan-hint-text');
      if (!dot || !text) return;

      const toneClass = tone === 'ok'
        ? 'bg-emerald-500 animate-ping'
        : tone === 'warn'
          ? 'bg-amber-500'
          : 'bg-purple-500 animate-pulse';

      dot.className = 'w-2.5 h-2.5 rounded-full ' + toneClass;
      text.innerText = message;
      if (hint && state.phase === 'scan') {
        hint.innerText = message;
      }
    };

    const completeScanSuccess = ({ points = 150, nextPhase = 'spoon' } = {}) => {
      if (state.scanningStatus === 'success') return;

      state.scanningStatus = 'success';
      stopMouthCheck();
      setScanLoading(false);
      setScanSuccessVisible(true);
      updateMouthCheckStatus('입 벌림 확인 완료!', 'ok');
      playSound('success');

      state.score += points;
      updateScoreDisplay();
      animatePointGain(points);

      setTimeout(() => {
        setScanSuccessVisible(false);
        goToNextPhase(nextPhase);
      }, 1500);
    };

    const getFaceLandmarker = async () => {
      if (faceLandmarker) return faceLandmarker;
      if (faceLandmarkerPromise) return faceLandmarkerPromise;

      faceLandmarkerPromise = (async () => {
        const { FaceLandmarker, FilesetResolver } = await import(MEDIAPIPE_TASKS_URL);
        const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

        const createLandmarker = (delegate) => FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_LANDMARKER_MODEL_URL,
            delegate
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        try {
          faceLandmarker = await createLandmarker('GPU');
        } catch (gpuError) {
          console.warn('MediaPipe GPU delegate failed. Falling back to CPU.', gpuError);
          faceLandmarker = await createLandmarker('CPU');
        }

        return faceLandmarker;
      })();

      return faceLandmarkerPromise;
    };

    const distance2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    const getBlendshapeScore = (result, categoryName) => {
      const categories = result.faceBlendshapes?.[0]?.categories || [];
      return categories.find(category => category.categoryName === categoryName)?.score || 0;
    };

    const getMouthOpenReading = (result) => {
      const landmarks = result.faceLandmarks?.[0];
      if (!landmarks) return null;

      const upperInnerLip = landmarks[13];
      const lowerInnerLip = landmarks[14];
      const leftMouthCorner = landmarks[61];
      const rightMouthCorner = landmarks[291];
      if (!upperInnerLip || !lowerInnerLip || !leftMouthCorner || !rightMouthCorner) return null;

      const mouthHeight = distance2d(upperInnerLip, lowerInnerLip);
      const mouthWidth = Math.max(distance2d(leftMouthCorner, rightMouthCorner), 0.001);
      const mouthOpenRatio = mouthHeight / mouthWidth;
      const jawOpen = getBlendshapeScore(result, 'jawOpen');
      const normalizedRatio = Math.min(1, mouthOpenRatio / 0.38);
      const score = Math.max(jawOpen, normalizedRatio);

      return {
        score,
        mouthOpenRatio,
        jawOpen,
        isOpen: mouthOpenRatio >= MOUTH_OPEN_RATIO_THRESHOLD || jawOpen >= JAW_OPEN_THRESHOLD
      };
    };

    const runMouthCheckLoop = () => {
      const video = document.getElementById('webcam-video');

      const tick = () => {
        if (state.phase !== 'scan' || state.scanningStatus !== 'scanning') return;

        const now = performance.now();
        mouthCheckFrameId = requestAnimationFrame(tick);

        if (!state.cameraActive || !video || video.readyState < 2) {
          mouthOpenStartedAt = null;
          updateMouthCheckStatus('카메라를 준비하는 중...', 'warn');
          return;
        }

        if (now - lastMouthDetectionAt < MOUTH_DETECTION_INTERVAL_MS) return;
        lastMouthDetectionAt = now;

        let result;
        try {
          result = faceLandmarker.detectForVideo(video, now);
        } catch (err) {
          console.warn('Mouth check frame failed.', err);
          mouthOpenStartedAt = null;
          updateMouthCheckStatus('입 스캐너가 잠시 흔들렸어요', 'warn');
          return;
        }

        const reading = getMouthOpenReading(result);
        if (!reading) {
          mouthOpenStartedAt = null;
          updateMouthCheckStatus('얼굴을 카메라 가운데에 보여주세요', 'warn');
          return;
        }

        if (!reading.isOpen) {
          mouthOpenStartedAt = null;
          updateMouthCheckStatus('입을 크게 아- 하고 보여주세요', 'scanning');
          return;
        }

        if (!mouthOpenStartedAt) mouthOpenStartedAt = now;
        const heldMs = now - mouthOpenStartedAt;
        const progress = Math.min(100, Math.round((heldMs / MOUTH_OPEN_HOLD_MS) * 100));
        updateMouthCheckStatus(`좋아요! 그대로 ${progress}%`, 'ok');

        if (heldMs >= MOUTH_OPEN_HOLD_MS) {
          completeScanSuccess({ nextPhase: getNextMealPhase() });
        }
      };

      tick();
    };

    const startMouthCheck = async () => {
      stopMouthCheck();
      if (state.phase !== 'scan') return;

      state.scanningStatus = 'scanning';
      mouthOpenStartedAt = null;
      lastMouthDetectionAt = 0;
      setScanLoading(true);
      updateMouthCheckStatus('입 스캐너 준비 중...', 'scanning');

      try {
        await getFaceLandmarker();
        if (state.phase !== 'scan' || state.scanningStatus !== 'scanning') return;
        setScanLoading(false);
        updateMouthCheckStatus('입을 크게 아- 하고 보여주세요', 'scanning');
        runMouthCheckLoop();
      } catch (err) {
        console.warn('Mouth checker could not start.', err);
        setScanLoading(false);
        updateMouthCheckStatus('AI 스캐너 준비 실패 - 수동 완료를 눌러주세요', 'warn');
      }
    };

    const stopMouthCheck = () => {
      if (mouthCheckFrameId) {
        cancelAnimationFrame(mouthCheckFrameId);
        mouthCheckFrameId = null;
      }
      mouthOpenStartedAt = null;
    };

    // --- Camera Handling ---
    const startCamera = async () => {
      const video = document.getElementById('webcam-video');
      const fallback = document.getElementById('camera-fallback');
      const dot = document.getElementById('camera-status-dot');
      const text = document.getElementById('camera-status-text');

      try {
        if (videoStream) {
          videoStream.getTracks().forEach(track => track.stop());
        }
        videoStream = await navigator.mediaDevices.getUserMedia({ 
          video: { facingMode: 'user', width: 400, height: 300 } 
        });
        video.srcObject = videoStream;
        video.classList.remove('hidden');
        fallback.classList.add('hidden');
        
        dot.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping";
        text.innerText = "실시간 우주 스캐너 ON";
        state.cameraActive = true;
      } catch (err) {
        console.warn("Camera fallback applied.", err);
        video.classList.add('hidden');
        fallback.classList.remove('hidden');
        dot.className = "w-2.5 h-2.5 rounded-full bg-amber-500";
        text.innerText = "스캐너 시뮬레이터 활성";
        state.cameraActive = false;
      }
    };

    const stopCamera = () => {
      if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
      }
      state.cameraActive = false;
      stopMouthCheck();
    };

    // --- Screen Transitions ---
    const changeScreen = (screenName) => {
      state.screen = screenName;
      document.getElementById('screen-intro').classList.add('hidden');
      document.getElementById('screen-playing').classList.add('hidden');
      document.getElementById('screen-victory').classList.add('hidden');

      document.getElementById(`screen-${screenName}`).classList.remove('hidden');

      if (screenName !== 'playing') {
        stopCamera();
        clearInterval(mainTimerInterval);
        clearInterval(phaseTimerInterval);
      }
    };

    const setMenuType = (type) => {
      state.menuType = type;
      if (type === 'full') {
        document.getElementById('btn-menu-full').className = "p-4 rounded-xl border-2 flex flex-col items-center justify-center transition-all border-cyan-400 bg-cyan-950/40 text-cyan-200";
        document.getElementById('btn-menu-single').className = "p-4 rounded-xl border-2 flex flex-col items-center justify-center transition-all border-slate-800 bg-slate-950 text-slate-400";
      } else {
        document.getElementById('btn-menu-full').className = "p-4 rounded-xl border-2 flex flex-col items-center justify-center transition-all border-slate-800 bg-slate-950 text-slate-400";
        document.getElementById('btn-menu-single').className = "p-4 rounded-xl border-2 flex flex-col items-center justify-center transition-all border-cyan-400 bg-cyan-950/40 text-cyan-200";
      }
    };

    const toggleMute = () => {
      state.isMuted = !state.isMuted;
      document.getElementById('btn-mute').innerText = state.isMuted ? '🔇' : '🔊';
    };

    // --- Gameplay Loop ---
    const startGame = () => {
      const nameInput = document.getElementById('input-pilot-name').value;
      state.pilotName = nameInput || '연우';
      state.isDemoMode = document.getElementById('checkbox-demo').checked;
      
      // Update Name text elements
      document.querySelectorAll('.pilot-name-text').forEach(el => el.innerText = state.pilotName);
      document.getElementById('playing-pilot-name').innerText = `${state.pilotName} 우주 대원`;
      document.getElementById('playing-mission-type').innerText = state.menuType === 'full' ? '임무: 우주 정식 완식' : '단일 에너지 흡수';

      const totalDuration = state.isDemoMode ? 120 : 1200;
      state.gameTime = totalDuration;
      state.maxGameTime = totalDuration;
      state.score = 0;
      state.phase = 'spoon';
      state.currentMealStep = state.menuType === 'full' ? 'rice' : 'single';
      state.phaseTimer = 15;
      state.chewProgress = 0;
      state.scanningStatus = 'ready';

      updateScoreDisplay();
      goToNextPhase('spoon');
      changeScreen('playing');
      startCamera();
      playSound('success');

      // 1. Main Game Countdown Timer (Total 20m / 2m)
      mainTimerInterval = setInterval(() => {
        if (state.gameTime <= 1) {
          endGameWithVictory();
          return;
        }
        state.gameTime--;
        updateTimerProgressBar();
      }, 1000);

      // 2. Phase Game Countdown Timer (Individual loop phases)
      phaseTimerInterval = setInterval(() => {
        if (state.phaseTimer <= 1) {
          handlePhaseTimeOut();
          return;
        }

        state.phaseTimer--;
        document.getElementById('phase-timer-display').innerText = `남은 시간: ${state.phaseTimer}초`;

        // Metronome effect on chew phase
        if (state.phase === 'chew') {
          if (state.phaseTimer % 2 === 0) {
            playSound('beep');
            state.chewProgress = Math.min(30, state.chewProgress + 2);
            renderPhaseUI();
          }
        }
      }, 1000);
    };

    const handlePhaseTimeOut = () => {
      playSound('success');
      if (state.phase === 'spoon' || state.phase === 'side' || state.phase === 'soup') {
        goToNextPhase('chew');
      } else if (state.phase === 'chew') {
        goToNextPhase('scan');
      } else if (state.phase === 'scan') {
        state.phaseTimer = 10;
        document.getElementById('phase-timer-display').innerText = `스캔 대기: ${state.phaseTimer}초`;
        updateMouthCheckStatus('입을 보여주면 자동으로 넘어가요', 'scanning');
      }
    };

    const goToNextPhase = (nextPhase) => {
      state.phase = nextPhase;
      state.scanningStatus = 'ready';
      stopMouthCheck();
      resetScanFeedback();
      
      if (nextPhase === 'spoon') {
        state.phaseTimer = 15;
        state.currentMealStep = state.menuType === 'full' ? 'rice' : 'single';
      } else if (nextPhase === 'side') {
        state.phaseTimer = 15;
        state.currentMealStep = 'side';
      } else if (nextPhase === 'soup') {
        state.phaseTimer = 15;
        state.currentMealStep = 'soup';
      } else if (nextPhase === 'chew') {
        state.phaseTimer = 25;
        state.chewProgress = 0;
      } else if (nextPhase === 'scan') {
        state.phaseTimer = 20;
      }

      renderPhaseUI();

      if (nextPhase === 'scan') {
        startMouthCheck();
      }
    };

    const handleForceComplete = () => {
      playSound('success');
      state.score += 100;
      updateScoreDisplay();
      animatePointGain(100);

      if (state.phase === 'spoon' || state.phase === 'side' || state.phase === 'soup') {
        goToNextPhase('chew');
      } else if (state.phase === 'chew') {
        goToNextPhase('scan');
      } else if (state.phase === 'scan') {
        goToNextPhase(getNextMealPhase());
      }
    };

    const handleStartScanning = () => {
      if (state.phase !== 'scan' || state.scanningStatus === 'success') return;
      completeScanSuccess({ nextPhase: getNextMealPhase() });
    };

    const getNextMealStep = (step) => {
      if (state.menuType !== 'full') return 'single';
      const currentIndex = fullMealSequence.indexOf(step);
      return fullMealSequence[(currentIndex + 1) % fullMealSequence.length];
    };

    const getMealStepForPhase = (phase) => {
      if (state.menuType !== 'full') return mealStepDetails.single;
      return Object.values(mealStepDetails).find(detail => detail.phase === phase) || mealStepDetails.rice;
    };

    const getNextMealPhase = () => {
      const nextStep = getNextMealStep(state.currentMealStep);
      return mealStepDetails[nextStep].phase;
    };

    const renderPhaseImage = (src, alt) => `
      <img
        src="${src}"
        alt="${alt}"
        class="w-44 h-44 md:w-52 md:h-52 object-contain drop-shadow-[0_0_24px_rgba(34,211,238,0.35)]"
        draggable="false"
      />
    `;

    const renderChewingAnimation = () => `
      <div class="relative w-44 h-44 md:w-52 md:h-52">
        <img
          src="assets/images/chew-frame-1.png"
          alt="아이가 음식을 먹고 씹는 첫 번째 그림"
          class="chew-frame-a absolute inset-0 w-full h-full object-contain drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]"
          draggable="false"
        />
        <img
          src="assets/images/chew-frame-2.png"
          alt="아이가 음식을 먹고 씹는 두 번째 그림"
          class="chew-frame-b absolute inset-0 w-full h-full object-contain drop-shadow-[0_0_24px_rgba(52,211,153,0.35)]"
          draggable="false"
        />
      </div>
    `;

    const renderMealStepper = () => {
      if (state.menuType !== 'full') return '';
      return `
        <div class="flex justify-center gap-2 mb-3">
          ${fullMealSequence.map(step => {
            const isActive = state.currentMealStep === step;
            const label = step === 'rice' ? '밥' : step === 'side' ? '반찬' : '국';
            return `
              <span class="${isActive ? 'bg-cyan-400 text-slate-950' : 'bg-slate-800 text-slate-400'} px-3 py-1 rounded-full text-xs font-black border ${isActive ? 'border-white' : 'border-slate-700'}">
                ${label}
              </span>
            `;
          }).join('')}
        </div>
      `;
    };

    const getMealColorClass = (color) => {
      if (color === 'indigo') return 'text-indigo-300';
      if (color === 'sky') return 'text-sky-300';
      return 'text-cyan-300';
    };

    const renderMealPrompt = (detail) => `
      <div class="mb-4 animate-pulse">
        ${renderPhaseImage(detail.image, detail.alt)}
      </div>
      ${renderMealStepper()}
      <span class="inline-flex items-center px-3 py-1 rounded-full bg-slate-800 border border-slate-700 ${getMealColorClass(detail.color)} text-xs font-black mb-2">
        ${detail.badge}
      </span>
      <h3 class="text-3xl font-black ${getMealColorClass(detail.color)} mb-2">${detail.title}</h3>
      <p class="text-slate-300 text-base leading-relaxed">
        ${detail.body}
      </p>
    `;

    // --- Dynamic Phase Rendering ---
    const renderPhaseUI = () => {
      const guide = document.getElementById('guide-content');
      const scanOverlay = document.getElementById('scan-radar-overlay');
      const btnScan = document.getElementById('btn-scan-start');
      const scanHint = document.getElementById('scan-hint-text');

      document.getElementById('phase-timer-display').innerText = `남은 시간: ${state.phaseTimer}초`;

      // Reset Scanning UI Elements
      scanOverlay.classList.add('hidden');
      btnScan.classList.add('hidden');
      scanHint.classList.remove('hidden');

      if (state.phase === 'spoon' || state.phase === 'side' || state.phase === 'soup') {
        const mealStep = getMealStepForPhase(state.phase);
        guide.innerHTML = `
          ${renderMealPrompt(mealStep)}
        `;
      } else if (state.phase === 'chew') {
        const percent = (state.chewProgress / 30) * 100;
        guide.innerHTML = `
          <div class="relative mb-4">
            ${renderChewingAnimation()}
          </div>
          <h3 class="text-3xl font-black text-emerald-300 mb-2">꼭꼭꼭꼭! 아작아작!</h3>
          <p class="text-slate-300 text-base leading-relaxed mb-4">
            음식을 삼키기 전, 이빨 분쇄기를 가동해요!<br />
            대장 몬스터와 함께 <strong>30번 꼭꼭</strong> 씹기!
          </p>
          
          <div class="w-full bg-slate-950 h-5 rounded-full border border-slate-800 overflow-hidden relative">
            <div class="bg-emerald-500 h-full transition-all duration-300" style="width: ${percent}%"></div>
            <span class="absolute inset-0 text-[10px] font-mono font-bold flex items-center justify-center text-white">
              에너지 가공 상태: ${state.chewProgress} / 30 씹기 완료
            </span>
          </div>
        `;
      } else if (state.phase === 'scan') {
        guide.innerHTML = `
          <div class="mb-4 animate-pulse">
            ${renderPhaseImage('assets/images/mouth-scan.png', '아이가 입을 벌리고 있는 그림')}
          </div>
          <h3 class="text-3xl font-black text-purple-300 mb-2">입속 우주스캔 가동!</h3>
          <p class="text-slate-300 text-sm leading-relaxed mb-4">
            에너지를 무사히 위(Stomach)로 전송했나요?<br />
            카메라를 보며 <strong>아~</strong> 하고 입을 크게 보여주세요!
          </p>
        `;
        scanOverlay.classList.remove('hidden');
        btnScan.innerText = '👌 인식이 안 되면 수동 완료';
        btnScan.classList.remove('hidden');
        scanHint.innerText = '입 스캐너 준비 중...';
        scanHint.classList.remove('hidden');
      }
    };

    const updateScoreDisplay = () => {
      document.getElementById('score-display').innerText = `⭐ ${state.score} P`;
    };

    const updateTimerProgressBar = () => {
      const minutes = Math.floor(state.gameTime / 60);
      const seconds = state.gameTime % 60;
      document.getElementById('timer-display').innerText = `⏱️ ${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;

      const progress = ((state.maxGameTime - state.gameTime) / state.maxGameTime) * 100;
      document.getElementById('progress-bar').style.width = `${progress}%`;
      document.getElementById('ship-marker').style.left = `${progress}%`;
    };

    const endGameWithVictory = () => {
      changeScreen('victory');
      playSound('victory');
      document.getElementById('victory-score').innerText = `${state.score} P`;
      
      const takenTime = state.maxGameTime - state.gameTime;
      const m = Math.floor(takenTime / 60);
      const s = takenTime % 60;
      document.getElementById('victory-duration').innerText = `${m}:${s < 10 ? '0' : ''}${s}`;
    };

    // --- Onload Check ---
    window.onload = () => {
      // Setup initial visual representation
      updateTimerProgressBar();
    };
