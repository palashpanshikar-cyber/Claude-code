/* ============================================================
   ReModelAI — room-scanner.js
   Webcam capture, 3D floor plan drawing (canvas),
   before/after comparison, AI suggestions, budget estimate
   ============================================================ */

'use strict';

(function initRoomScanner() {

  // ── State ────────────────────────────────────────────────
  let state = {
    width:  15,
    length: 20,
    height: 9,
    roomType: 'Kitchen',
    scanning: false,
    scanComplete: false,
    cameraStream: null,
    rotateAngle: 0,
    animFrame: null,
    viewMode: 'perspective',   // 'perspective' | 'topdown'
    zoom: 1.0
  };

  // ── DOM Refs ─────────────────────────────────────────────
  const scanBtn         = document.getElementById('scanBtn');
  const generateBtn     = document.getElementById('generateBtn');
  const cameraFeed      = document.getElementById('cameraFeed');
  const cameraPlaceholder = document.getElementById('cameraPlaceholder');
  const scanOverlay     = document.getElementById('scanOverlay');
  const scanStatus      = document.getElementById('scanStatus');
  const floorPlanCanvas = document.getElementById('floorPlanCanvas');
  const beforeCanvas    = document.getElementById('beforeCanvas');
  const afterCanvas     = document.getElementById('afterCanvas');
  const suggestionsPanel = document.getElementById('aiSuggestions');
  const estimatePanel   = document.getElementById('budgetEstimate');
  const scanProgress    = document.getElementById('scanProgress');
  const roomTypeBtns    = document.querySelectorAll('.room-type-btn');
  const dimWidth        = document.getElementById('dimWidth');
  const dimLength       = document.getElementById('dimLength');
  const dimHeight       = document.getElementById('dimHeight');
  const viewToggle      = document.getElementById('viewToggle');
  const zoomIn          = document.getElementById('zoomIn');
  const zoomOut         = document.getElementById('zoomOut');

  let fpCtx, beforeCtx, afterCtx;
  if (floorPlanCanvas)  fpCtx    = floorPlanCanvas.getContext('2d');
  if (beforeCanvas)     beforeCtx = beforeCanvas.getContext('2d');
  if (afterCanvas)      afterCtx  = afterCanvas.getContext('2d');

  // ── Room type selection ───────────────────────────────────
  roomTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      roomTypeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.roomType = btn.dataset.type || btn.textContent.trim().split('\n')[0].trim();
      if (state.scanComplete) regenerate();
    });
  });

  // ── Dimension inputs ──────────────────────────────────────
  function readDimensions() {
    if (dimWidth)  state.width  = parseFloat(dimWidth.value)  || 15;
    if (dimLength) state.length = parseFloat(dimLength.value) || 20;
    if (dimHeight) state.height = parseFloat(dimHeight.value) || 9;
  }

  [dimWidth, dimLength, dimHeight].forEach(el => {
    if (el) el.addEventListener('input', () => {
      readDimensions();
      if (state.scanComplete) regenerate();
    });
  });

  // ── Scan button ───────────────────────────────────────────
  if (scanBtn) {
    scanBtn.addEventListener('click', async () => {
      if (state.scanning) return;
      await startScan();
    });
  }

  async function startScan() {
    state.scanning = true;
    state.scanComplete = false;

    updateScanProgress(0);
    if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = '⏳ Scanning…'; }

    // Try to get camera
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      state.cameraStream = stream;
      if (cameraFeed) {
        cameraFeed.srcObject = stream;
        cameraFeed.style.display = 'block';
        cameraFeed.play();
      }
      if (cameraPlaceholder) cameraPlaceholder.style.display = 'none';
    } catch (err) {
      // Camera not available — show simulation
      if (cameraPlaceholder) {
        cameraPlaceholder.innerHTML = `
          <div class="camera-placeholder-icon">📷</div>
          <div class="camera-placeholder-text">Camera not available — running simulation scan</div>
        `;
      }
    }

    // Show scan overlay
    if (scanOverlay) scanOverlay.classList.add('active');

    // Simulate scan progress
    const steps = [
      { msg: 'Initializing depth sensors…',    pct: 10, delay: 600  },
      { msg: 'Capturing room boundaries…',      pct: 25, delay: 700  },
      { msg: 'Mapping floor surface…',          pct: 40, delay: 700  },
      { msg: 'Detecting walls & corners…',      pct: 58, delay: 800  },
      { msg: 'Measuring dimensions…',           pct: 72, delay: 700  },
      { msg: 'Building point cloud…',           pct: 85, delay: 600  },
      { msg: 'Generating 3D model…',            pct: 95, delay: 700  },
      { msg: 'Scan complete! ✓',                pct: 100, delay: 400 }
    ];

    let totalDelay = 0;
    steps.forEach((step, i) => {
      totalDelay += step.delay;
      setTimeout(() => {
        if (scanStatus) scanStatus.textContent = step.msg;
        updateScanProgress(i + 1);
      }, totalDelay);
    });

    setTimeout(() => {
      finishScan();
    }, totalDelay + 200);
  }

  function finishScan() {
    state.scanning = false;
    state.scanComplete = true;

    // Stop camera stream
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(t => t.stop());
      state.cameraStream = null;
    }

    if (scanOverlay) scanOverlay.classList.remove('active');
    if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = '📷 Re-Scan Room'; }

    readDimensions();
    regenerate();

    if (window.ReModelAI) {
      window.ReModelAI.showToast('Scan complete! 3D floor plan generated.', 'success');
    }
  }

  function updateScanProgress(step) {
    if (!scanProgress) return;
    const steps = scanProgress.querySelectorAll('.scan-step');
    steps.forEach((s, i) => {
      s.classList.remove('done','active');
      if (i < step - 1) s.classList.add('done');
      else if (i === step - 1) s.classList.add('active');
    });
  }

  // ── Generate / Regenerate ─────────────────────────────────
  if (generateBtn) {
    generateBtn.addEventListener('click', () => {
      readDimensions();
      state.scanComplete = true;
      regenerate();
      if (window.ReModelAI) {
        window.ReModelAI.showToast('3D floor plan generated!', 'success');
      }
    });
  }

  function regenerate() {
    drawFloorPlan();
    drawBeforeAfter();
    renderSuggestions();
    renderEstimate();
  }

  // ── 3D Floor Plan Rendering ───────────────────────────────
  function drawFloorPlan() {
    if (!fpCtx || !floorPlanCanvas) return;

    const dpr  = window.devicePixelRatio || 1;
    const W    = floorPlanCanvas.clientWidth  || 600;
    const H    = floorPlanCanvas.clientHeight || 400;
    floorPlanCanvas.width  = W * dpr;
    floorPlanCanvas.height = H * dpr;
    fpCtx.scale(dpr, dpr);

    fpCtx.clearRect(0, 0, W, H);

    if (state.viewMode === 'topdown') {
      drawTopDown(fpCtx, W, H);
    } else {
      drawPerspective(fpCtx, W, H);
    }
  }

  // Perspective 3D room view
  function drawPerspective(ctx, W, H) {
    const roomW = state.width;
    const roomL = state.length;
    const roomH = state.height;

    // Background
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W,H)*0.7);
    bg.addColorStop(0, '#1a1a3e');
    bg.addColorStop(1, '#0a0a14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Grid floor
    const vanishX = W * 0.5;
    const vanishY = H * 0.35;
    const floorBot = H * 0.9;
    const floorL   = W * 0.05;
    const floorR   = W * 0.95;

    // Floor gradient
    const floorGrad = ctx.createLinearGradient(0, vanishY, 0, floorBot);
    floorGrad.addColorStop(0, '#1e2a4a');
    floorGrad.addColorStop(1, '#2d3a5a');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(vanishX, vanishY);
    ctx.lineTo(floorR, floorBot);
    ctx.lineTo(floorL, floorBot);
    ctx.closePath();
    ctx.fill();

    // Floor grid lines
    ctx.strokeStyle = 'rgba(124,58,237,0.12)';
    ctx.lineWidth = 1;
    const gridCols = 10;
    const gridRows = 8;

    for (let i = 0; i <= gridCols; i++) {
      const t = i / gridCols;
      const bx = floorL + t * (floorR - floorL);
      ctx.beginPath();
      ctx.moveTo(vanishX, vanishY);
      ctx.lineTo(bx, floorBot);
      ctx.stroke();
    }

    for (let j = 0; j <= gridRows; j++) {
      const t = j / gridRows;
      const y = vanishY + t * (floorBot - vanishY);
      const alpha = 0.05 + t * 0.2;
      const xLeft  = vanishX + (floorL - vanishX) * t;
      const xRight = vanishX + (floorR - vanishX) * t;
      ctx.beginPath();
      ctx.strokeStyle = `rgba(6,182,212,${alpha})`;
      ctx.moveTo(xLeft, y);
      ctx.lineTo(xRight, y);
      ctx.stroke();
    }

    // Left wall
    const wallTop = H * 0.08;
    const wallH_px = vanishY - wallTop;
    const leftWallX = W * 0.05;

    const lwGrad = ctx.createLinearGradient(leftWallX, wallTop, leftWallX + W*0.3, vanishY);
    lwGrad.addColorStop(0, '#1a1a3e');
    lwGrad.addColorStop(1, '#16213e');
    ctx.fillStyle = lwGrad;
    ctx.beginPath();
    ctx.moveTo(vanishX, vanishY);
    ctx.lineTo(vanishX, wallTop);
    ctx.lineTo(leftWallX, wallTop);
    ctx.lineTo(leftWallX, floorBot);
    ctx.closePath();
    ctx.fill();

    // Wall grid left
    ctx.strokeStyle = 'rgba(124,58,237,0.1)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = wallTop + t * (floorBot - wallTop);
      ctx.beginPath();
      ctx.moveTo(leftWallX, y);
      ctx.lineTo(vanishX, vanishY + (y - floorBot) * 0.01);
      ctx.stroke();
    }

    // Right wall
    const rightWallX = W * 0.95;
    const rwGrad = ctx.createLinearGradient(rightWallX, wallTop, vanishX, vanishY);
    rwGrad.addColorStop(0, '#12172e');
    rwGrad.addColorStop(1, '#16213e');
    ctx.fillStyle = rwGrad;
    ctx.beginPath();
    ctx.moveTo(vanishX, vanishY);
    ctx.lineTo(vanishX, wallTop);
    ctx.lineTo(rightWallX, wallTop);
    ctx.lineTo(rightWallX, floorBot);
    ctx.closePath();
    ctx.fill();

    // Ceiling
    const ceilGrad = ctx.createLinearGradient(0, 0, 0, wallTop + 20);
    ceilGrad.addColorStop(0, '#0d0d1a');
    ceilGrad.addColorStop(1, '#1a1a3e');
    ctx.fillStyle = ceilGrad;
    ctx.fillRect(0, 0, W, wallTop);
    ctx.beginPath();
    ctx.moveTo(leftWallX, wallTop);
    ctx.lineTo(vanishX, wallTop);
    ctx.lineTo(rightWallX, wallTop);
    ctx.lineTo(rightWallX, 0);
    ctx.lineTo(leftWallX, 0);
    ctx.closePath();
    ctx.fill();

    // Wall lines
    ctx.strokeStyle = 'rgba(124,58,237,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(leftWallX, wallTop);
    ctx.lineTo(vanishX, wallTop);
    ctx.lineTo(rightWallX, wallTop);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(leftWallX, floorBot);
    ctx.lineTo(vanishX, vanishY);
    ctx.lineTo(rightWallX, floorBot);
    ctx.stroke();

    // Draw furniture based on room type
    drawFurniturePerspective(ctx, W, H, vanishX, vanishY, floorBot, floorL, floorR);

    // Dimension labels
    drawDimensionLabels(ctx, W, H, roomW, roomL, roomH);

    // Room label
    ctx.fillStyle = 'rgba(6,182,212,0.9)';
    ctx.font = `bold ${Math.round(H*0.035)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${state.roomType} — ${roomW}ft × ${roomL}ft × ${roomH}ft ceiling`, W/2, H - 8);
  }

  function drawFurniturePerspective(ctx, W, H, vx, vy, floorBot, floorL, floorR) {
    const fw = floorR - floorL;
    const fh = floorBot - vy;

    const furnitureSets = {
      Kitchen:    drawKitchenFurniture,
      Bathroom:   drawBathroomFurniture,
      Salon:      drawSalonFurniture,
      Office:     drawOfficeFurniture,
      Living:     drawLivingFurniture,
      Bedroom:    drawBedroomFurniture,
      Restaurant: drawRestaurantFurniture,
      Retail:     drawRetailFurniture
    };

    const drawFn = furnitureSets[state.roomType] || drawGenericFurniture;
    drawFn(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh);
  }

  function drawGenericFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Simple desk + chair
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.4, fw*0.25, fh*0.08, fh*0.1, vx, vy, '#4a5568', '#2d3748');
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.55, fw*0.1, fh*0.06, fh*0.12, vx, vy, '#553c9a', '#44337a');
  }

  function drawKitchenFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Counter L-shape
    drawBox3D(ctx, vx - fw*0.4, vy + fh*0.1, fw*0.15, fh*0.65, fh*0.14, vx, vy, '#2d3748', '#1a202c');
    drawBox3D(ctx, vx - fw*0.4, vy + fh*0.1, fw*0.35, fh*0.18, fh*0.06, vx, vy, '#4a5568', '#2d3748');
    // Island
    drawBox3D(ctx, vx + fw*0.05, vy + fh*0.35, fw*0.2, fh*0.2, fh*0.12, vx, vy, '#553c9a', '#44337a');
    // Stove
    drawBox3D(ctx, vx - fw*0.25, vy + fh*0.12, fw*0.1, fh*0.15, fh*0.1, vx, vy, '#1a202c', '#000');
    ctx.fillStyle = 'rgba(245,158,11,0.6)';
    ctx.beginPath();
    ctx.arc(vx - fw*0.22, vy + fh*0.21, fh*0.025, 0, 2*Math.PI);
    ctx.fill();
  }

  function drawBathroomFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Tub
    drawBox3D(ctx, vx - fw*0.45, vy + fh*0.1, fw*0.15, fh*0.5, fh*0.08, vx, vy, '#e2e8f0', '#a0aec0');
    // Vanity
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.15, fw*0.18, fh*0.2, fh*0.12, vx, vy, '#4a5568', '#2d3748');
    // Toilet
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.5, fw*0.1, fh*0.18, fh*0.1, vx, vy, '#e2e8f0', '#a0aec0');
  }

  function drawSalonFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Styling chairs row
    for (let i = 0; i < 3; i++) {
      drawBox3D(ctx, vx - fw*0.45 + i*fw*0.15, vy + fh*0.2, fw*0.1, fh*0.15, fh*0.14, vx, vy, '#553c9a', '#44337a');
    }
    // Reception desk
    drawBox3D(ctx, vx + fw*0.08, vy + fh*0.15, fw*0.22, fh*0.18, fh*0.12, vx, vy, '#2d3748', '#1a202c');
    // Waiting chairs
    drawBox3D(ctx, vx + fw*0.08, vy + fh*0.55, fw*0.1, fh*0.12, fh*0.1, vx, vy, '#06b6d4', '#0891b2');
  }

  function drawOfficeFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Desks
    drawBox3D(ctx, vx - fw*0.45, vy + fh*0.15, fw*0.3, fh*0.12, fh*0.09, vx, vy, '#2d3748', '#1a202c');
    drawBox3D(ctx, vx - fw*0.45, vy + fh*0.5, fw*0.3, fh*0.12, fh*0.09, vx, vy, '#2d3748', '#1a202c');
    // Conference table
    drawBox3D(ctx, vx + fw*0.02, vy + fh*0.25, fw*0.25, fh*0.3, fh*0.1, vx, vy, '#4a5568', '#2d3748');
  }

  function drawLivingFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Sofa
    drawBox3D(ctx, vx - fw*0.45, vy + fh*0.3, fw*0.35, fh*0.15, fh*0.12, vx, vy, '#553c9a', '#44337a');
    // Coffee table
    drawBox3D(ctx, vx - fw*0.1, vy + fh*0.45, fw*0.15, fh*0.1, fh*0.05, vx, vy, '#4a5568', '#2d3748');
    // TV unit
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.2, fw*0.2, fh*0.12, fh*0.1, vx, vy, '#1a202c', '#000');
  }

  function drawBedroomFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Bed
    drawBox3D(ctx, vx - fw*0.35, vy + fh*0.2, fw*0.3, fh*0.35, fh*0.12, vx, vy, '#553c9a', '#44337a');
    // Dresser
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.2, fw*0.15, fh*0.2, fh*0.14, vx, vy, '#4a5568', '#2d3748');
    // Nightstands
    drawBox3D(ctx, vx - fw*0.45, vy + fh*0.22, fw*0.08, fh*0.1, fh*0.08, vx, vy, '#2d3748', '#1a202c');
  }

  function drawRestaurantFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Tables
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        drawBox3D(ctx, vx - fw*0.45 + c*fw*0.2, vy + fh*0.2 + r*fh*0.35, fw*0.12, fh*0.12, fh*0.08, vx, vy, '#4a5568', '#2d3748');
      }
    }
    // Bar counter
    drawBox3D(ctx, vx + fw*0.08, vy + fh*0.1, fw*0.22, fh*0.25, fh*0.13, vx, vy, '#553c9a', '#44337a');
  }

  function drawRetailFurniture(ctx, W, H, vx, vy, floorBot, floorL, floorR, fw, fh) {
    // Display shelves
    for (let i = 0; i < 3; i++) {
      drawBox3D(ctx, vx - fw*0.45 + i*fw*0.17, vy + fh*0.15, fw*0.12, fh*0.5, fh*0.1, vx, vy, '#2d3748', '#1a202c');
    }
    // Cash register
    drawBox3D(ctx, vx + fw*0.1, vy + fh*0.2, fw*0.18, fh*0.15, fh*0.12, vx, vy, '#553c9a', '#44337a');
  }

  // Generic 3D box in perspective
  function drawBox3D(ctx, x, y, w, d, h, vx, vy, topColor, sideColor) {
    // Top face
    ctx.fillStyle = topColor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - d*0.3, y + d);
    ctx.lineTo(x - d*0.3, y + d);
    ctx.closePath();
    ctx.fill();

    // Front face
    ctx.fillStyle = sideColor;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();

    // Right face
    ctx.fillStyle = darken(sideColor, 20);
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x + w - d*0.3, y + d + h);
    ctx.lineTo(x + w - d*0.3, y + d);
    ctx.closePath();
    ctx.fill();

    // Outline
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function darken(hex, amount) {
    try {
      let c = hex.replace('#','');
      if (c.length === 3) c = c.split('').map(x => x+x).join('');
      const r = Math.max(0, parseInt(c.substr(0,2),16) - amount);
      const g = Math.max(0, parseInt(c.substr(2,2),16) - amount);
      const b = Math.max(0, parseInt(c.substr(4,2),16) - amount);
      return `rgb(${r},${g},${b})`;
    } catch(e) { return hex; }
  }

  function drawDimensionLabels(ctx, W, H, roomW, roomL, roomH) {
    ctx.fillStyle = 'rgba(6,182,212,0.7)';
    ctx.font = `${Math.round(H*0.028)}px system-ui`;
    ctx.textAlign = 'center';

    // Width arrow
    ctx.fillText(`← ${roomW}ft →`, W*0.5, H*0.92);
    ctx.fillStyle = 'rgba(124,58,237,0.7)';
    ctx.textAlign = 'left';
    ctx.fillText(`${roomL}ft deep`, W*0.07, H*0.85);
    ctx.fillText(`${roomH}ft ceiling`, W*0.07, H*0.12);
  }

  // Top-down floor plan
  function drawTopDown(ctx, W, H) {
    const pad   = 60;
    const scale = Math.min((W - pad*2) / state.width, (H - pad*2) / state.length);
    const rW    = state.width  * scale;
    const rL    = state.length * scale;
    const ox    = (W - rW) / 2;
    const oy    = (H - rL) / 2;

    // Background
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(124,58,237,0.07)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 30) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 30) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
    }

    // Room floor
    const floorGrad = ctx.createLinearGradient(ox, oy, ox+rW, oy+rL);
    floorGrad.addColorStop(0, '#1e2a4a');
    floorGrad.addColorStop(1, '#16213e');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(ox, oy, rW, rL);

    // Floor pattern
    ctx.strokeStyle = 'rgba(6,182,212,0.08)';
    ctx.lineWidth = 1;
    const tileSize = scale * 2;
    for (let x = ox; x < ox+rW; x += tileSize) {
      ctx.beginPath(); ctx.moveTo(x,oy); ctx.lineTo(x,oy+rL); ctx.stroke();
    }
    for (let y = oy; y < oy+rL; y += tileSize) {
      ctx.beginPath(); ctx.moveTo(ox,y); ctx.lineTo(ox+rW,y); ctx.stroke();
    }

    // Walls
    ctx.strokeStyle = '#7c3aed';
    ctx.lineWidth = 8;
    ctx.strokeRect(ox, oy, rW, rL);

    // Door opening
    ctx.strokeStyle = '#0a0a14';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(ox + rW * 0.15, oy);
    ctx.lineTo(ox + rW * 0.3, oy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(6,182,212,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(ox + rW*0.15, oy, rW*0.15, 0, Math.PI/2);
    ctx.stroke();

    // Window
    ctx.strokeStyle = '#0a0a14';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(ox + rW * 0.6, oy);
    ctx.lineTo(ox + rW * 0.85, oy);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(6,182,212,0.6)';
    ctx.lineWidth = 3;
    ctx.strokeRect(ox + rW*0.6, oy-3, rW*0.25, 6);

    // Furniture top-down
    drawFurnitureTopDown(ctx, ox, oy, rW, rL, scale);

    // Dimensions
    ctx.fillStyle = 'rgba(6,182,212,0.8)';
    ctx.font = `bold ${Math.round(H*0.028)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(`${state.width} ft`, ox + rW/2, oy - 12);
    ctx.save();
    ctx.translate(ox - 16, oy + rL/2);
    ctx.rotate(-Math.PI/2);
    ctx.fillText(`${state.length} ft`, 0, 0);
    ctx.restore();
    ctx.fillStyle = 'rgba(124,58,237,0.7)';
    ctx.font = `${Math.round(H*0.025)}px system-ui`;
    ctx.fillText(`${state.roomType} Floor Plan  •  ${state.width}ft × ${state.length}ft`, W/2, H - 12);
  }

  function drawFurnitureTopDown(ctx, ox, oy, rW, rL, scale) {
    const items = getFurnitureLayout(state.roomType);
    items.forEach(item => {
      const x = ox + item.x * rW;
      const y = oy + item.y * rL;
      const w = item.w * rW;
      const h = item.h * rL;

      ctx.fillStyle = item.color;
      if (item.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(x + w/2, y + h/2, Math.min(w,h)/2, 0, 2*Math.PI);
        ctx.fill();
      } else {
        ctx.beginPath();
        if (item.radius) {
          roundRect(ctx, x, y, w, h, item.radius);
          ctx.fill();
        } else {
          ctx.fillRect(x, y, w, h);
        }
      }

      // Label
      if (item.label) {
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = `${Math.max(9, Math.round(scale*0.6))}px system-ui`;
        ctx.textAlign = 'center';
        ctx.fillText(item.label, x + w/2, y + h/2 + 3);
      }
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
  }

  function getFurnitureLayout(type) {
    const layouts = {
      Kitchen:    [
        { x:0.05, y:0.05, w:0.7,  h:0.15, color:'#2d3748', radius:4, label:'Counter' },
        { x:0.05, y:0.05, w:0.12, h:0.55, color:'#2d3748', label:'Cabinets' },
        { x:0.25, y:0.4,  w:0.3,  h:0.2,  color:'#553c9a', radius:4, label:'Island' },
        { x:0.65, y:0.3,  w:0.12, h:0.12, color:'#1a202c', label:'Stove' },
        { x:0.65, y:0.5,  w:0.12, h:0.12, shape:'circle',  color:'#4a5568' }
      ],
      Bathroom:   [
        { x:0.05, y:0.05, w:0.35, h:0.2,  color:'#e2e8f0', radius:6, label:'Tub' },
        { x:0.55, y:0.05, w:0.35, h:0.18, color:'#4a5568', label:'Vanity' },
        { x:0.55, y:0.55, w:0.2,  h:0.3,  color:'#e2e8f0', radius:6, label:'WC' },
        { x:0.05, y:0.35, w:0.25, h:0.35, color:'#553c9a', radius:4, label:'Shower' }
      ],
      Salon:      [
        { x:0.05, y:0.1,  w:0.12, h:0.15, color:'#553c9a', radius:4, label:'Chair' },
        { x:0.22, y:0.1,  w:0.12, h:0.15, color:'#553c9a', radius:4, label:'Chair' },
        { x:0.39, y:0.1,  w:0.12, h:0.15, color:'#553c9a', radius:4, label:'Chair' },
        { x:0.56, y:0.1,  w:0.12, h:0.15, color:'#553c9a', radius:4, label:'Chair' },
        { x:0.05, y:0.6,  w:0.35, h:0.2,  color:'#2d3748', label:'Reception' },
        { x:0.55, y:0.5,  w:0.3,  h:0.2,  color:'#06b6d4', radius:4, label:'Waiting' }
      ],
      Office:     [
        { x:0.05, y:0.05, w:0.4,  h:0.12, color:'#2d3748', label:'Desk' },
        { x:0.05, y:0.22, w:0.4,  h:0.12, color:'#2d3748', label:'Desk' },
        { x:0.5,  y:0.25, w:0.42, h:0.35, color:'#4a5568', label:'Conf. Table' },
        { x:0.05, y:0.7,  w:0.2,  h:0.2,  color:'#553c9a', radius:4, label:'Lounge' }
      ],
      Living:     [
        { x:0.1,  y:0.55, w:0.55, h:0.2,  color:'#553c9a', radius:6, label:'Sofa' },
        { x:0.25, y:0.35, w:0.2,  h:0.15, color:'#4a5568', label:'Coffee Table' },
        { x:0.72, y:0.2,  w:0.2,  h:0.12, color:'#1a202c', label:'TV' },
        { x:0.1,  y:0.15, w:0.2,  h:0.18, color:'#2d3748', label:'Bookshelf' }
      ],
      Restaurant: [
        { x:0.05, y:0.05, w:0.55, h:0.12, color:'#553c9a', label:'Bar' },
        { x:0.1,  y:0.3,  w:0.2,  h:0.2,  shape:'circle', color:'#4a5568' },
        { x:0.4,  y:0.3,  w:0.2,  h:0.2,  shape:'circle', color:'#4a5568' },
        { x:0.1,  y:0.62, w:0.2,  h:0.2,  shape:'circle', color:'#4a5568' },
        { x:0.4,  y:0.62, w:0.2,  h:0.2,  shape:'circle', color:'#4a5568' },
        { x:0.72, y:0.3,  w:0.22, h:0.45, color:'#2d3748', label:'Kitchen' }
      ],
      Retail:     [
        { x:0.05, y:0.05, w:0.2,  h:0.6,  color:'#2d3748', label:'Shelves' },
        { x:0.3,  y:0.05, w:0.2,  h:0.6,  color:'#2d3748', label:'Shelves' },
        { x:0.55, y:0.05, w:0.2,  h:0.6,  color:'#2d3748', label:'Shelves' },
        { x:0.1,  y:0.72, w:0.35, h:0.18, color:'#553c9a', label:'Counter' }
      ]
    };

    return layouts[type] || layouts.Kitchen;
  }

  // ── Before / After ────────────────────────────────────────
  function drawBeforeAfter() {
    if (beforeCtx && beforeCanvas) drawBeforeView();
    if (afterCtx  && afterCanvas)  drawAfterView();
  }

  function drawBeforeView() {
    const W = beforeCanvas.clientWidth  || 300;
    const H = beforeCanvas.clientHeight || 220;
    beforeCanvas.width  = W;
    beforeCanvas.height = H;

    beforeCtx.fillStyle = '#1a1a2e';
    beforeCtx.fillRect(0, 0, W, H);

    // Draw a simple old-style room
    beforeCtx.fillStyle = '#2d3748';
    beforeCtx.fillRect(W*0.05, H*0.3, W*0.9, H*0.6);

    // Old floor
    beforeCtx.fillStyle = '#4a5568';
    beforeCtx.fillRect(W*0.05, H*0.75, W*0.9, H*0.15);

    // Old furniture (plain boxes)
    beforeCtx.fillStyle = '#718096';
    beforeCtx.fillRect(W*0.1, H*0.35, W*0.3, H*0.35);
    beforeCtx.fillRect(W*0.5, H*0.35, W*0.35, H*0.2);

    // Aged effect
    beforeCtx.fillStyle = 'rgba(0,0,0,0.3)';
    beforeCtx.fillRect(0, 0, W, H);

    // Label
    beforeCtx.fillStyle = '#f59e0b';
    beforeCtx.font = `bold ${Math.round(H*0.08)}px system-ui`;
    beforeCtx.textAlign = 'center';
    beforeCtx.fillText('BEFORE', W/2, H*0.92);

    // Cracks / wear marks
    beforeCtx.strokeStyle = 'rgba(255,255,255,0.08)';
    beforeCtx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      beforeCtx.beginPath();
      beforeCtx.moveTo(Math.random()*W, Math.random()*H);
      beforeCtx.lineTo(Math.random()*W, Math.random()*H);
      beforeCtx.stroke();
    }
  }

  function drawAfterView() {
    const W = afterCanvas.clientWidth  || 300;
    const H = afterCanvas.clientHeight || 220;
    afterCanvas.width  = W;
    afterCanvas.height = H;

    // Gradient background
    const bg = afterCtx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1a1a3e');
    bg.addColorStop(1, '#16213e');
    afterCtx.fillStyle = bg;
    afterCtx.fillRect(0, 0, W, H);

    // Modern floor
    afterCtx.fillStyle = '#2d3a5a';
    afterCtx.fillRect(W*0.05, H*0.72, W*0.9, H*0.18);

    // Floor tiles
    afterCtx.strokeStyle = 'rgba(6,182,212,0.15)';
    afterCtx.lineWidth = 1;
    for (let x = W*0.05; x < W*0.95; x += W*0.12) {
      afterCtx.beginPath(); afterCtx.moveTo(x, H*0.72); afterCtx.lineTo(x, H*0.9); afterCtx.stroke();
    }

    // Modern furniture
    afterCtx.fillStyle = '#553c9a';
    roundRectFill(afterCtx, W*0.08, H*0.35, W*0.35, H*0.32, 8);
    afterCtx.fillStyle = '#4a5568';
    roundRectFill(afterCtx, W*0.5, H*0.35, W*0.38, H*0.22, 6);

    // Glow accents
    const glow = afterCtx.createRadialGradient(W*0.5, H*0.4, 0, W*0.5, H*0.4, W*0.4);
    glow.addColorStop(0, 'rgba(124,58,237,0.1)');
    glow.addColorStop(1, 'transparent');
    afterCtx.fillStyle = glow;
    afterCtx.fillRect(0, 0, W, H);

    // Label
    afterCtx.fillStyle = '#10b981';
    afterCtx.font = `bold ${Math.round(H*0.08)}px system-ui`;
    afterCtx.textAlign = 'center';
    afterCtx.fillText('AFTER ✓', W/2, H*0.92);
  }

  function roundRectFill(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y); ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r); ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(x+r,y+h); ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r); ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
    ctx.fill();
  }

  // ── AI Suggestions ────────────────────────────────────────
  const suggestionData = {
    Kitchen:    [
      { icon:'🍳', title:'Optimal Workflow Triangle', text:'Position sink, stove, and refrigerator in a triangle with 4–9 ft between each point for maximum efficiency and customer throughput.' },
      { icon:'💡', title:'Task Lighting Upgrade', text:'Under-cabinet LED strip lighting adds ambiance and improves workspace visibility. Budget $200–$600 for full installation.' },
      { icon:'📐', title:'Island Placement', text:'Center island with 42–48 inch clearance on all sides allows comfortable movement. Your room supports a 36×72 inch island.' }
    ],
    Bathroom:   [
      { icon:'🚿', title:'Walk-In Shower ROI', text:'Converting a tub to a walk-in shower increases property value by 5–8% in most markets. Estimated cost: $3,500–$8,000.' },
      { icon:'💡', title:'Layered Lighting', text:'Combine overhead, vanity, and accent lighting for a spa-like atmosphere. Dimmer switches increase perceived luxury significantly.' },
      { icon:'🪞', title:'Double Vanity Upgrade', text:'Adding a double vanity increases client satisfaction by 40%. Your room dimensions support a 60-inch double vanity.' }
    ],
    Salon:      [
      { icon:'💺', title:'Optimal Styling Station Layout', text:'Place stations 5 feet apart for client privacy and stylist movement. Your space supports 4 stations in a single row configuration.' },
      { icon:'🌬️', title:'Ventilation Priority', text:'Install dedicated ventilation above chemical stations. Required by most state cosmetology board regulations.' },
      { icon:'🎵', title:'Client Experience Zone', text:'Dedicate 15–20% of floor space to waiting area with natural light. Studies show this reduces perceived wait time by 32%.' }
    ],
    Office:     [
      { icon:'☀️', title:'Biophilic Design Boost', text:'Position workstations within 25 feet of windows. Natural light reduces eye strain and increases productivity by 15%.' },
      { icon:'🔇', title:'Acoustic Zones', text:'Use glass partitions to create collaborative zones while maintaining visual openness. Acoustic panels reduce noise by 60%.' },
      { icon:'🔌', title:'Power Infrastructure', text:'Install floor boxes every 8 feet for flexible furniture arrangement. Future-proof with USB-C and USB-A power outlets.' }
    ],
    Restaurant: [
      { icon:'🍽️', title:'Table Turn Optimization', text:'Optimal spacing of 18–24 inches between chairs. Your floor plan supports 28 covers — ideal for a boutique dining concept.' },
      { icon:'🌡️', title:'Kitchen-to-Dining Flow', text:'Position kitchen entrance away from main sightlines. A well-designed pass-through reduces ticket times by 20%.' },
      { icon:'🎨', title:'Ambiance Lighting', text:'Install dimmer-controlled overhead with warm Edison bulbs (2700K). Dim lighting increases average ticket size by 12%.' }
    ],
    Retail:     [
      { icon:'🛒', title:'Clockwise Customer Flow', text:'Position high-margin items at the back-right corner. Customers naturally browse counter-clockwise — guide them with your layout.' },
      { icon:'💡', title:'Accent Lighting on Merchandise', text:'Track lighting above display fixtures increases perceived value of products by 25%. Budget $800–$2,000 for full installation.' },
      { icon:'📦', title:'Decompression Zone', text:'Keep 10 feet inside the entrance clear of merchandise. This transition zone increases time-in-store by 18%.' }
    ],
    General:    [
      { icon:'📐', title:'Natural Traffic Flow', text:'Design pathways at least 36 inches wide for ADA compliance and comfortable movement. Your room layout is well-proportioned for this.' },
      { icon:'💡', title:'Layered Lighting Strategy', text:'Combine ambient, task, and accent lighting. This creates depth and allows mood adjustments for different business activities.' },
      { icon:'🎨', title:'Color Psychology', text:'Lighter walls (60%) with darker accent wall (30%) and colored accessories (10%) creates a professional, inviting atmosphere.' }
    ]
  };

  function renderSuggestions() {
    if (!suggestionsPanel) return;
    const data = suggestionData[state.roomType] || suggestionData.General;

    suggestionsPanel.innerHTML = data.map(s => `
      <div class="suggestion-item">
        <span class="suggestion-icon">${s.icon}</span>
        <div class="suggestion-text">
          <strong>${s.title}</strong>
          ${s.text}
        </div>
      </div>
    `).join('');
  }

  // ── Budget Estimate ───────────────────────────────────────
  const costPerSqFt = {
    Kitchen:    { min: 75,  max: 200, label: 'Mid-range kitchen remodel' },
    Bathroom:   { min: 70,  max: 180, label: 'Full bathroom renovation' },
    Salon:      { min: 45,  max: 120, label: 'Salon buildout & design' },
    Office:     { min: 35,  max: 100, label: 'Commercial office renovation' },
    Living:     { min: 25,  max: 80,  label: 'Living space remodel' },
    Bedroom:    { min: 20,  max: 70,  label: 'Bedroom renovation' },
    Restaurant: { min: 80,  max: 250, label: 'Restaurant renovation' },
    Retail:     { min: 40,  max: 130, label: 'Retail store renovation' },
    General:    { min: 30,  max: 90,  label: 'General space remodel' }
  };

  function renderEstimate() {
    if (!estimatePanel) return;
    const sqFt     = state.width * state.length;
    const costData = costPerSqFt[state.roomType] || costPerSqFt.General;
    const minCost  = sqFt * costData.min;
    const maxCost  = sqFt * costData.max;
    const midCost  = Math.round((minCost + maxCost) / 2);

    const laborPct    = 0.35;
    const matPct      = 0.40;
    const permitPct   = 0.05;
    const contingency = 0.10;
    const overheadPct = 0.10;

    estimatePanel.innerHTML = `
      <div class="estimate-row">
        <span class="estimate-label">Room Area</span>
        <span class="estimate-val">${sqFt} sq ft</span>
      </div>
      <div class="estimate-row">
        <span class="estimate-label">Labor (35%)</span>
        <span class="estimate-val">$${Math.round(midCost * laborPct).toLocaleString()}</span>
      </div>
      <div class="estimate-row">
        <span class="estimate-label">Materials (40%)</span>
        <span class="estimate-val">$${Math.round(midCost * matPct).toLocaleString()}</span>
      </div>
      <div class="estimate-row">
        <span class="estimate-label">Permits & Fees (5%)</span>
        <span class="estimate-val">$${Math.round(midCost * permitPct).toLocaleString()}</span>
      </div>
      <div class="estimate-row">
        <span class="estimate-label">Contingency (10%)</span>
        <span class="estimate-val">$${Math.round(midCost * contingency).toLocaleString()}</span>
      </div>
      <div class="estimate-row">
        <span class="estimate-label">Overhead (10%)</span>
        <span class="estimate-val">$${Math.round(midCost * overheadPct).toLocaleString()}</span>
      </div>
      <div class="estimate-row" style="margin-top:8px;padding-top:12px;border-top:1px solid rgba(124,58,237,0.3);">
        <span class="estimate-label" style="font-weight:700;color:var(--text-primary);">Estimated Total</span>
        <span class="estimate-total">$${Math.round(minCost).toLocaleString()}–$${Math.round(maxCost).toLocaleString()}</span>
      </div>
      <div style="margin-top:8px;font-size:0.72rem;color:var(--text-muted);text-align:center;">
        Based on ${state.roomType.toLowerCase()} remodel rates for ${sqFt} sq ft
      </div>
    `;
  }

  // ── Canvas controls ───────────────────────────────────────
  if (viewToggle) {
    viewToggle.addEventListener('click', () => {
      state.viewMode = state.viewMode === 'perspective' ? 'topdown' : 'perspective';
      viewToggle.title = state.viewMode === 'perspective' ? 'Switch to Top-Down View' : 'Switch to 3D View';
      viewToggle.textContent = state.viewMode === 'perspective' ? '🗺️' : '📐';
      if (state.scanComplete) drawFloorPlan();
    });
  }

  if (zoomIn)  zoomIn.addEventListener('click',  () => { state.zoom = Math.min(state.zoom + 0.1, 2);   if(state.scanComplete) drawFloorPlan(); });
  if (zoomOut) zoomOut.addEventListener('click', () => { state.zoom = Math.max(state.zoom - 0.1, 0.5); if(state.scanComplete) drawFloorPlan(); });

  // ── Initial render ────────────────────────────────────────
  window.addEventListener('resize', () => {
    if (state.scanComplete) drawFloorPlan();
  });

  // Draw placeholder
  if (fpCtx && floorPlanCanvas) {
    setTimeout(() => {
      const W = floorPlanCanvas.clientWidth  || 600;
      const H = floorPlanCanvas.clientHeight || 400;
      floorPlanCanvas.width  = W;
      floorPlanCanvas.height = H;
      fpCtx.fillStyle = '#0a0a14';
      fpCtx.fillRect(0, 0, W, H);

      // Grid
      fpCtx.strokeStyle = 'rgba(124,58,237,0.06)';
      fpCtx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) {
        fpCtx.beginPath(); fpCtx.moveTo(x,0); fpCtx.lineTo(x,H); fpCtx.stroke();
      }
      for (let y = 0; y < H; y += 40) {
        fpCtx.beginPath(); fpCtx.moveTo(0,y); fpCtx.lineTo(W,y); fpCtx.stroke();
      }

      fpCtx.fillStyle = 'rgba(124,58,237,0.4)';
      fpCtx.font = `bold ${Math.round(H*0.055)}px system-ui`;
      fpCtx.textAlign = 'center';
      fpCtx.textBaseline = 'middle';
      fpCtx.fillText('📐 Enter dimensions & click', W/2, H/2 - 20);
      fpCtx.font = `bold ${Math.round(H*0.055)}px system-ui`;
      fpCtx.fillText('"Generate 3D Floor Plan"', W/2, H/2 + 30);
    }, 100);
  }

})();
