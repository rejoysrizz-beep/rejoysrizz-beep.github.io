// =================================================================
// CELEBRATION PORTAL VISUAL EFFECTS ENGINE & SWIPE SLIDER
// =================================================================

// --- STATE FOR VISUAL EFFECTS ---
let confettiParticles = [];
let fireworkLaunchers = [];
let fireworkExplosions = [];
let activeCelebrationLoop = null;

let confettiCtx = null;
let fireworksCtx = null;
let confettiCanvas = null;
let fireworksCanvas = null;

// --- STATE FOR HORIZONTAL PORTAL SLIDER ---
let currentDayOffset = 0; // 0 = Today, +1 = Tomorrow, -1 = Yesterday...
let currentSlideIndex = 0;

// --- CELEBRATION TRIGGERS ---

/**
 * Checks if there are any birthdays or wedding anniversaries occurring on Today's Month/Day.
 * If yes, triggers the celebration portal overlay on startup.
 */
function checkAndTriggerCelebrationsToday() {
  const todayEvents = getEventsForOffset(0);
  if (todayEvents.length > 0) {
    // There are events today! Launch the flash page!
    openCelebrationPortalForce(0);
  }
}

function openCelebrationPortalForce(initialOffset = 0) {
  currentDayOffset = initialOffset;
  
  // Reset overlay
  const portal = document.getElementById('celebration-portal');
  portal.classList.remove('hidden');

  // Load active slider content
  renderDaySlideContent();

  // Initialize Canvas graphics
  initCelebrationCanvases();

  // Start Visual Effects Loop
  startCelebrationVfxLoop();

  // Programmatically spawn floating items!
  startFloatingSpawns();
}

function closeCelebrationPortal() {
  document.getElementById('celebration-portal').classList.add('hidden');
  stopCelebrationVfxLoop();
  stopFloatingSpawns();
  
  // Wipe balloons/floating elements
  const container = document.getElementById('balloon-container');
  if (container) container.innerHTML = '';
}

// =================================================================
// EVENT RESOLVER FOR HORIZONTAL SLIDER
// =================================================================

/**
 * Calculates events for a specific day relative to today.
 * @param {number} offset Positive or negative day offset (e.g. 0=Today, +1=Tomorrow, -1=Yesterday)
 * @returns {Array} List of events matching this specific month/day
 */
function getEventsForOffset(offset) {
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + offset);
  
  const tMonth = targetDate.getMonth();
  const tDay = targetDate.getDate();

  const events = [];

  familyData.forEach(m => {
    // 1. Birthdays (Only if living)
    if (m.birthDate && !m.isDeceased) {
      const bDate = new Date(m.birthDate);
      if (!isNaN(bDate.getTime())) {
        if (bDate.getMonth() === tMonth && bDate.getDate() === tDay) {
          const age = targetDate.getFullYear() - bDate.getFullYear();
          events.push({
            member: m,
            type: 'birthday',
            title: 'Birthday',
            milestone: age > 0 ? age : null,
            emoji: '🎂'
          });
        }
      }
    }

    // 2. Remembrances (Only if deceased)
    if (m.birthDate && m.isDeceased) {
      const bDate = new Date(m.birthDate);
      if (!isNaN(bDate.getTime())) {
        if (bDate.getMonth() === tMonth && bDate.getDate() === tDay) {
          const anniversary = targetDate.getFullYear() - bDate.getFullYear();
          events.push({
            member: m,
            type: 'death',
            title: 'Remembrance Day',
            milestone: anniversary > 0 ? anniversary : null,
            emoji: '🕊️'
          });
        }
      }
    }

    // 3. Wedding Anniversaries
    if (m.marriageDate && m.spouseId && m.id < m.spouseId) {
      const annivDate = new Date(m.marriageDate);
      if (!isNaN(annivDate.getTime())) {
        if (annivDate.getMonth() === tMonth && annivDate.getDate() === tDay) {
          const spouse = familyData.find(s => s.id === m.spouseId);
          const years = targetDate.getFullYear() - annivDate.getFullYear();
          if (spouse) {
            events.push({
              member: m,
              spouse: spouse,
              type: 'marriage',
              title: 'Wedding Anniversary',
              milestone: years > 0 ? years : null,
              emoji: '💑'
            });
          }
        }
      }
    }
  });

  return events;
}

// =================================================================
// SLIDER RENDERING & CONTROLLER
// =================================================================

function renderDaySlideContent() {
  const track = document.getElementById('slider-track');
  track.innerHTML = '';

  const events = getEventsForOffset(currentDayOffset);
  
  // Format Slide Label (Header date indicator)
  let dateLabel = '';
  if (currentDayOffset === 0) dateLabel = 'Today\'s Celebrations 🎉';
  else if (currentDayOffset === 1) dateLabel = 'Tomorrow\'s Milestones ⏰';
  else if (currentDayOffset === -1) dateLabel = 'Yesterday\'s Celebrations 🍂';
  else {
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + currentDayOffset);
    const options = { month: 'long', day: 'numeric' };
    dateLabel = targetDate.toLocaleDateString('en-US', options) + ' Events';
  }

  // Update subtitle indicator if needed
  document.querySelector('.celebration-subtitle').innerText = dateLabel;

  if (events.length === 0) {
    // Starry Sky Slide Empty State
    const slide = document.createElement('div');
    slide.className = 'celebration-slide';
    slide.innerHTML = `
      <div class="slide-empty-icon">✨</div>
      <h3 class="slide-empty-title">A quiet day in family history.</h3>
      <p class="color-dim font-size-13 margin-top-8 max-width-450">
        No birthdays or anniversaries fell on this calendar day. Slide forwards to see upcoming dates, or backwards to view yesterday's events.
      </p>
    `;
    track.appendChild(slide);
    
    // Remove dots if present
    const dotsContainer = document.getElementById('slider-dots');
    if (dotsContainer) dotsContainer.remove();
    
    updateSliderPosition();
    return;
  }

  // Draw slides for each event on this day
  events.forEach(ev => {
    const slide = document.createElement('div');
    slide.className = 'celebration-slide';

    let messageTitle = '';
    let messageDesc = '';
    let decorationHtml = '';
    let waActionHtml = '';

    const profileName = ev.type === 'marriage' 
      ? `${ev.member.firstName} & ${ev.spouse.firstName}`
      : `${ev.member.firstName} ${ev.member.lastName}`;

    const hideAgeVal = shouldHideAge(ev.member.id);
    const hideContactsVal = shouldHideContacts(ev.member.id);

    if (ev.type === 'birthday') {
      const label = (ev.milestone && !hideAgeVal) ? `Happy ${ev.milestone}th Birthday!` : 'Happy Birthday!';
      messageTitle = `<span class="celebration-clickable-name" onclick="viewProfileFromCelebration('${ev.member.id}')" title="Click to view profile">${profileName}</span> 🎂`;
      messageDesc = `${label} Sending dearest thoughts, warm smiles, and endless blessings from the whole family tree! ❤️`;
      
      decorationHtml = `
        <div class="slide-deco">
          <div class="deco-item">🎂</div>
          <div class="deco-item delay-1">🎁</div>
          <div class="deco-item">🎈</div>
        </div>
      `;

      if (ev.member.phone && !hideContactsVal) {
        waActionHtml = `<button class="btn btn-success btn-glow margin-top-16" onclick="openGreetingPortal('${ev.member.id}', 'birthday')">
          <i data-lucide="message-square"></i> Send Birthday Wish via WhatsApp
        </button>`;
      }
    } else if (ev.type === 'marriage') {
      const spouseHideAge = ev.spouse ? shouldHideAge(ev.spouse.id) : false;
      const label = (ev.milestone && !hideAgeVal && !spouseHideAge) ? `Happy ${ev.milestone}th Anniversary!` : 'Happy Wedding Anniversary!';
      messageTitle = `<span class="celebration-clickable-name" onclick="viewProfileFromCelebration('${ev.member.id}')" title="Click to view profile">${ev.member.firstName}</span> &amp; <span class="celebration-clickable-name" onclick="viewProfileFromCelebration('${ev.spouse.id}')" title="Click to view profile">${ev.spouse.firstName}</span> 💑`;
      messageDesc = `${label} Wishing a lifetime of love, shared smiles, and warm memories together. Happy Anniversary! 💖`;
      
      decorationHtml = `
        <div class="slide-deco">
          <div class="deco-item">💍</div>
          <div class="deco-item delay-1">💖</div>
          <div class="deco-item">🥂</div>
        </div>
      `;

      if (ev.member.phone && !hideContactsVal) {
        waActionHtml = `<button class="btn btn-success btn-glow margin-top-16" onclick="openGreetingPortal('${ev.member.id}', 'marriage')">
          <i data-lucide="message-square"></i> Wish Anniversary on WhatsApp
        </button>`;
      }
    } else {
      // Remembrance Deceased Day
      messageTitle = `Remembering <span class="celebration-clickable-name" onclick="viewProfileFromCelebration('${ev.member.id}')" title="Click to view profile">${ev.member.firstName}</span> 🕊️`;
      const milestoneText = (ev.milestone && !hideAgeVal) ? `${ev.milestone}th ` : '';
      messageDesc = `${milestoneText}Memorial Birth Anniversary. Keeping their beautiful life achievements, laughter, and wisdom forever tucked inside our family memory vaults. 🕯️`;
      
      decorationHtml = `
        <div class="slide-deco">
          <div class="deco-item">🕯️</div>
          <div class="deco-item delay-1">🤍</div>
        </div>
      `;
    }

    const tagLabel = ev.type === 'death' ? 'In Remembrance' : ev.title;

    const isMarriage = ev.type === 'marriage';
    const ringClass = isMarriage ? 'slide-avatar-ring anniversary-ring' : 'slide-avatar-ring';
    const avatarHtml = isMarriage
      ? `<div class="overlapping-avatars-wrapper slide-overlap">
          <div class="overlap-avatar primary">${getMemberAvatarHtml(ev.member)}</div>
          <div class="overlap-avatar secondary">${getMemberAvatarHtml(ev.spouse)}</div>
         </div>`
      : `<div class="slide-avatar">${getMemberAvatarHtml(ev.member)}</div>`;

    slide.innerHTML = `
      <span class="slide-tag">${tagLabel}</span>
      <div class="${ringClass} cursor-pointer" onclick="viewProfileFromCelebration('${ev.member.id}')" title="Click to view profile">
        ${avatarHtml}
      </div>
      <h3 class="slide-title cinzel-title">${messageTitle}</h3>
      <p class="slide-subtitle">${messageDesc}</p>
      ${decorationHtml}
      ${waActionHtml}
    `;

    track.appendChild(slide);
  });

  // Render horizontal slide dots
  let dotsContainer = document.getElementById('slider-dots');
  if (events.length > 1) {
    if (!dotsContainer) {
      dotsContainer = document.createElement('div');
      dotsContainer.id = 'slider-dots';
      dotsContainer.className = 'slider-dots';
      const sliderOuter = document.querySelector('.slider-outer');
      if (sliderOuter) {
        sliderOuter.insertAdjacentElement('afterend', dotsContainer);
      }
    }
    dotsContainer.innerHTML = '';
    events.forEach((ev, idx) => {
      const dot = document.createElement('div');
      dot.className = `slider-dot ${idx === currentSlideIndex ? 'active' : ''}`;
      dot.onclick = () => {
        currentSlideIndex = idx;
        updateSliderPosition();
        triggerSoftBurst();
      };
      dotsContainer.appendChild(dot);
    });
  } else {
    if (dotsContainer) dotsContainer.remove();
  }

  updateSliderPosition();
  safeCreateIcons();
}

function updateSliderPosition() {
  const track = document.getElementById('slider-track');
  if (track) {
    track.style.transform = `translateX(-${currentSlideIndex * 100}%)`;
  }
  
  // Update active dots
  const dots = document.querySelectorAll('.slider-dot');
  dots.forEach((dot, idx) => {
    if (idx === currentSlideIndex) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });

  // Dynamically update background and floating items
  updateCelebrationBackground();
  const container = document.getElementById('balloon-container');
  if (container) {
    container.innerHTML = '';
  }
  startFloatingSpawns();
}

function navigateSlider(direction) {
  const events = getEventsForOffset(currentDayOffset);
  
  if (direction === 'next') {
    if (events.length > 1 && currentSlideIndex < events.length - 1) {
      currentSlideIndex++;
      updateSliderPosition();
      triggerSoftBurst();
    } else {
      currentDayOffset++;
      currentSlideIndex = 0;
      renderDaySlideContent();
      triggerSoftBurst();
    }
  } else if (direction === 'prev') {
    if (events.length > 1 && currentSlideIndex > 0) {
      currentSlideIndex--;
      updateSliderPosition();
      triggerSoftBurst();
    } else {
      currentDayOffset--;
      const prevEvents = getEventsForOffset(currentDayOffset);
      currentSlideIndex = prevEvents.length > 0 ? prevEvents.length - 1 : 0;
      renderDaySlideContent();
      triggerSoftBurst();
    }
  }
}

// Attach Slider Buttons Action handlers
document.getElementById('slide-prev').onclick = () => {
  navigateSlider('prev');
};

document.getElementById('slide-next').onclick = () => {
  navigateSlider('next');
};

// Keyboard sliding handler (arrow keys)
document.addEventListener('keydown', (e) => {
  const portal = document.getElementById('celebration-portal');
  if (!portal.classList.contains('hidden')) {
    if (e.key === 'ArrowLeft') {
      navigateSlider('prev');
    } else if (e.key === 'ArrowRight') {
      navigateSlider('next');
    } else if (e.key === 'Escape') {
      closeCelebrationPortal();
    }
  }
});

// =================================================================
// CONFETTI & FIREWORKS MATHEMATICS (CANVAS PHYSICS)
// =================================================================

function initCelebrationCanvases() {
  confettiCanvas = document.getElementById('confetti-canvas');
  fireworksCanvas = document.getElementById('fireworks-canvas');

  confettiCtx = confettiCanvas.getContext('2d');
  fireworksCtx = fireworksCanvas.getContext('2d');

  resizeCanvases();
  window.onresize = resizeCanvases;

  // Clicking on fireworks canvas shoots a rocket!
  fireworksCanvas.onclick = (e) => {
    launchRocket(e.clientX, e.clientY);
  };

  // Seed initial confetti particles
  confettiParticles = [];
  for (let i = 0; i < 150; i++) {
    confettiParticles.push(createConfettiParticle());
  }

  fireworkLaunchers = [];
  fireworkExplosions = [];
}

function resizeCanvases() {
  if (confettiCanvas && fireworksCanvas) {
    confettiCanvas.width = window.innerWidth;
    confettiCanvas.height = window.innerHeight;
    fireworksCanvas.width = window.innerWidth;
    fireworksCanvas.height = window.innerHeight;
  }
}

// --- CONFETTI LOGIC ---
function createConfettiParticle() {
  const colors = ['#ec4899', '#f59e0b', '#10b981', '#6366f1', '#a855f7', '#06b6d4', '#f43f5e'];
  return {
    x: Math.random() * window.innerWidth,
    y: Math.random() * -window.innerHeight - 20,
    size: Math.random() * 8 + 6,
    color: colors[Math.floor(Math.random() * colors.length)],
    speedY: Math.random() * 3 + 2,
    speedX: Math.random() * 2 - 1,
    rotation: Math.random() * 360,
    rotationSpeed: Math.random() * 4 - 2
  };
}

function updateAndDrawConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);

  confettiParticles.forEach(p => {
    // Physics
    p.y += p.speedY;
    p.x += p.speedX + Math.sin(p.y / 30) * 0.5; // swing sway
    p.rotation += p.rotationSpeed;

    // Boundary wrap
    if (p.y > window.innerHeight) {
      Object.assign(p, createConfettiParticle());
      p.y = -10;
    }

    // Draw
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rotation * Math.PI / 180);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    confettiCtx.restore();
  });
}

// --- FIREWORKS PARTICLE SYSTEM ---
function launchRocket(targetX = null, targetY = null) {
  const startX = Math.random() * window.innerWidth * 0.6 + window.innerWidth * 0.2;
  const startY = window.innerHeight;
  
  const tx = targetX !== null ? targetX : Math.random() * window.innerWidth;
  const ty = targetY !== null ? targetY : Math.random() * window.innerHeight * 0.4 + 100;

  const dx = tx - startX;
  const dy = ty - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = 40 + Math.random() * 20;

  fireworkLaunchers.push({
    x: startX,
    y: startY,
    tx: tx,
    ty: ty,
    vx: dx / steps,
    vy: dy / steps,
    stepsRemaining: steps,
    color: `hsl(${Math.random() * 360}, 100%, 65%)`
  });
}

function explodeFirework(x, y, color) {
  const particleCount = 40 + Math.floor(Math.random() * 30);
  for (let i = 0; i < particleCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 5 + 1.5;
    fireworkExplosions.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      alpha: 1,
      decay: Math.random() * 0.02 + 0.012,
      color: color,
      size: Math.random() * 2 + 1.5
    });
  }
}

function updateAndDrawFireworks() {
  // Fade trailing canvas clear to create cool spark glow trails!
  fireworksCtx.fillStyle = 'rgba(3, 3, 8, 0.15)';
  fireworksCtx.fillRect(0, 0, fireworksCanvas.width, fireworksCanvas.height);

  // 1. Update Rockets
  for (let i = fireworkLaunchers.length - 1; i >= 0; i--) {
    const r = fireworkLaunchers[i];
    r.x += r.vx;
    r.y += r.vy;
    r.stepsRemaining--;

    // Rocket Spark tail
    fireworksCtx.beginPath();
    fireworksCtx.arc(r.x, r.y, 2, 0, Math.PI * 2);
    fireworksCtx.fillStyle = '#ffffff';
    fireworksCtx.fill();

    if (r.stepsRemaining <= 0) {
      explodeFirework(r.tx, r.ty, r.color);
      fireworkLaunchers.splice(i, 1);
    }
  }

  // 2. Update Spark Particles
  for (let i = fireworkExplosions.length - 1; i >= 0; i--) {
    const p = fireworkExplosions[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.06; // Gravity drag pull down
    p.vx *= 0.98; // Friction
    p.alpha -= p.decay;

    if (p.alpha <= 0) {
      fireworkExplosions.splice(i, 1);
      continue;
    }

    fireworksCtx.save();
    fireworksCtx.globalAlpha = p.alpha;
    fireworksCtx.beginPath();
    fireworksCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    fireworksCtx.fillStyle = p.color;
    // Glow effect
    fireworksCtx.shadowBlur = 6;
    fireworksCtx.shadowColor = p.color;
    fireworksCtx.fill();
    fireworksCtx.restore();
  }

  // Auto launch rockets on intervals
  if (Math.random() < 0.03 && fireworkLaunchers.length < 5) {
    launchRocket();
  }
}

// --- GENERAL LOOP CONTROL ---
function startCelebrationVfxLoop() {
  if (activeCelebrationLoop) cancelAnimationFrame(activeCelebrationLoop);

  function loop() {
    updateAndDrawConfetti();
    updateAndDrawFireworks();
    activeCelebrationLoop = requestAnimationFrame(loop);
  }

  activeCelebrationLoop = requestAnimationFrame(loop);
}

function stopCelebrationVfxLoop() {
  if (activeCelebrationLoop) {
    cancelAnimationFrame(activeCelebrationLoop);
    activeCelebrationLoop = null;
  }
}

function triggerSoftBurst() {
  // Clears and launches 2 instant rockets on page slide
  launchRocket(window.innerWidth * 0.35, window.innerHeight * 0.35);
  launchRocket(window.innerWidth * 0.65, window.innerHeight * 0.35);
}

// =================================================================
// CUSTOM-THEMED FLOATING CELEBRATION ELEMENTS ENGINE
// =================================================================

let activeSpawnInterval = null;

function updateCelebrationBackground() {
  const portal = document.getElementById('celebration-portal');
  const bgDecor = document.getElementById('celebration-bg-decor');
  if (!portal) return;

  const events = getEventsForOffset(currentDayOffset);
  if (events.length === 0 || !events[currentSlideIndex]) {
    // Starry Sky Empty State
    portal.style.background = 'radial-gradient(circle at center, #0f0f23 0%, #030308 100%)';
    if (bgDecor) bgDecor.innerHTML = '';
    return;
  }

  const activeEvent = events[currentSlideIndex];
  
  if (activeEvent.type === 'birthday') {
    portal.style.background = 'radial-gradient(circle at center, #0f0f23 0%, #030308 100%)';
    if (bgDecor) bgDecor.innerHTML = '';
  } else if (activeEvent.type === 'death') {
    // Remembrance Day - tranquil, lighted gold-amber candlelight glow
    portal.style.background = 'radial-gradient(circle at center, #1b130e 0%, #020204 100%)';
    
    if (bgDecor) {
      let candlesHtml = '<div class="candle-row">';
      for (let i = 0; i < 10; i++) {
        const height = Math.floor(Math.random() * 50) + 40; // 40px to 90px
        const left = i * 10 + Math.random() * 2; // spread evenly
        const delay = (Math.random() * 2).toFixed(1);
        candlesHtml += `
          <div class="candle" style="height: ${height}px; left: ${left}vw; animation-delay: -${delay}s;">
            <div class="candle-body"></div>
            <div class="candle-wick"></div>
            <div class="candle-flame"></div>
            <div class="candle-glow"></div>
          </div>
        `;
      }
      candlesHtml += '</div>';

      let dovesHtml = '';
      for (let i = 0; i < 3; i++) {
        const top = Math.floor(Math.random() * 30) + 15; // 15vh to 45vh
        const delay = i * 4.5 + Math.random() * 1.5;
        const duration = Math.floor(Math.random() * 6) + 12; // 12s to 18s
        dovesHtml += `
          <div class="bg-dove-wrapper" style="top: ${top}vh; animation-delay: ${delay}s; animation-duration: ${duration}s;">
            <span class="bg-dove-inner">🕊️</span>
          </div>
        `;
      }
      bgDecor.innerHTML = candlesHtml + dovesHtml;
    }
  } else if (activeEvent.type === 'marriage') {
    // Wedding Anniversary - romantic velvet-wine / rose love glow
    portal.style.background = 'radial-gradient(circle at center, #300a12 0%, #050102 100%)';
    
    if (bgDecor) {
      const cornersHtml = `
        <div class="anniv-corner anniv-corner-left">🌹💖🌹✨</div>
        <div class="anniv-corner anniv-corner-right">✨🌹💖🌹</div>
      `;
      
      let driftingHtml = '';
      const symbols = ['🌹', '💖', '❤️', '🌹', '💖'];
      for (let i = 0; i < 8; i++) {
        const left = Math.floor(Math.random() * 90) + 5; // 5vw to 95vw
        const delay = (Math.random() * 8).toFixed(1);
        const duration = Math.floor(Math.random() * 5) + 8; // 8s to 13s
        const size = (Math.random() * 12 + 18).toFixed(0); // 18px to 30px
        const sym = symbols[i % symbols.length];
        driftingHtml += `
          <div class="bg-rose-drift" style="left: ${left}vw; font-size: ${size}px; animation-delay: -${delay}s; animation-duration: ${duration}s;">
            ${sym}
          </div>
        `;
      }
      bgDecor.innerHTML = cornersHtml + driftingHtml;
    }
  }
}

function stopFloatingSpawns() {
  if (activeSpawnInterval) {
    clearInterval(activeSpawnInterval);
    activeSpawnInterval = null;
  }
}

function startFloatingSpawns() {
  stopFloatingSpawns();

  const container = document.getElementById('balloon-container');
  if (!container) return;

  // Initial spawner batch (seed 8 items instantly)
  for (let i = 0; i < 8; i++) {
    setTimeout(createFloatingElement, Math.random() * 3000);
  }

  // Keep spawning every 1.8 seconds
  activeSpawnInterval = setInterval(createFloatingElement, 1800);
}

function createFloatingElement() {
  const portal = document.getElementById('celebration-portal');
  if (!portal || portal.classList.contains('hidden')) return;

  const container = document.getElementById('balloon-container');
  if (!container) return;

  const events = getEventsForOffset(currentDayOffset);
  let activeEvent = null;
  if (events.length > 0 && events[currentSlideIndex]) {
    activeEvent = events[currentSlideIndex];
  }

  const type = activeEvent ? activeEvent.type : 'birthday';

  const b = document.createElement('div');
  b.style.left = (Math.random() * 85 + 5) + 'vw';
  b.style.animationDuration = (Math.random() * 5 + 7) + 's'; // float speed 7-12s
  
  const sizeScale = Math.random() * 0.4 + 0.8;
  b.style.transform = `scale(${sizeScale})`;

  if (type === 'birthday') {
    b.className = 'balloon';
    const balloonColors = [
      'rgba(236, 72, 153, 0.7)',
      'rgba(245, 158, 11, 0.7)',
      'rgba(16, 185, 129, 0.7)',
      'rgba(99, 102, 241, 0.7)',
      'rgba(6, 182, 212, 0.7)',
      'rgba(244, 63, 94, 0.7)'
    ];
    const color = balloonColors[Math.floor(Math.random() * balloonColors.length)];
    b.style.backgroundColor = color;

    const string = document.createElement('div');
    string.className = 'balloon-string';
    b.appendChild(string);
  } else if (type === 'death') {
    // Remembrance: lighted candles and flying white doves
    b.className = 'floating-item-emoji';
    const items = ['🕯️', '🕊️', '✨', '🕯️'];
    b.textContent = items[Math.floor(Math.random() * items.length)];
    b.style.filter = 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.45))';
  } else if (type === 'marriage') {
    // Wedding Anniversary: roses, hearts, and sparkles
    b.className = 'floating-item-emoji';
    const items = ['🌹', '💖', '❤️', '🌹', '💖', '✨'];
    b.textContent = items[Math.floor(Math.random() * items.length)];
    b.style.filter = 'drop-shadow(0 0 10px rgba(244, 63, 94, 0.45))';
  }

  container.appendChild(b);

  b.addEventListener('animationend', () => {
    b.remove();
  });
}

function viewProfileFromCelebration(memberId) {
  closeCelebrationPortal();
  if (typeof openInfoDrawer === 'function') {
    openInfoDrawer(memberId);
  }
}

