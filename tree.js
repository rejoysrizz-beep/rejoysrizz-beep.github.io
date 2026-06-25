// =================================================================
// YoYoVaYo! FAMILY TREE LAYOUT ENGINE & ZOOMABLE CANVAS
// =================================================================

// --- NAVIGATION & COORDINATE MATRIX ---
let scale = 1.0;
let offsetX = 100;
let offsetY = 50;
let isDragging = false;
let startX = 0, startY = 0;
let activeHighlightedCardId = null;
let focusedBranchRootId = null; // Global tracker for isolative branch focusing
// Layout Grid parameters
const CARD_WIDTH = 220;
const CARD_HEIGHT = 120;
const LAYER_HEIGHT = 280; // Vertical gap between generations
const CARD_GAP_X = 260;    // Horizontal gap between members

// --- INITIALIZE INTERACTIVE CANVAS ---
function initializeTreeCanvas() {
  const container = document.getElementById('tree-container');
  const zoomLayer = document.getElementById('zoom-layer');
  if (!container || !zoomLayer) return;

  // Mouse wheel zoom
  container.onwheel = (e) => {
    e.preventDefault();
    const zoomSpeed = 0.05;
    const oldScale = scale;
    
    // Zoom toward mouse pointer
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (e.deltaY < 0) {
      scale = Math.min(scale + zoomSpeed, 2.5);
    } else {
      scale = Math.max(scale - zoomSpeed, 0.2);
    }

    // Adjust offsets to zoom toward pointer
    const ratio = scale / oldScale;
    offsetX = mouseX - (mouseX - offsetX) * ratio;
    offsetY = mouseY - (mouseY - offsetY) * ratio;

    applyCanvasTransform();
  };

  // Pointer drag panning
  container.onpointerdown = (e) => {
    // Only drag on canvas or zoom layer background (not card nodes or empty state card)
    if (e.target.closest('.family-card') || e.target.closest('.tree-controls') || e.target.closest('.empty-welcome-card')) return;
    
    isDragging = true;
    container.setPointerCapture(e.pointerId);
    startX = e.clientX - offsetX;
    startY = e.clientY - offsetY;
  };

  container.onpointermove = (e) => {
    if (!isDragging) return;
    offsetX = e.clientX - startX;
    offsetY = e.clientY - startY;
    applyCanvasTransform();
  };

  container.onpointerup = (e) => {
    if (!isDragging) return;
    isDragging = false;
    container.releasePointerCapture(e.pointerId);
  };
}

function applyCanvasTransform() {
  const zoomLayer = document.getElementById('zoom-layer');
  if (zoomLayer) {
    zoomLayer.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
  }
}

// Control buttons
function zoomIn() {
  scale = Math.min(scale + 0.15, 2.5);
  applyCanvasTransform();
}
function zoomOut() {
  scale = Math.max(scale - 0.15, 0.2);
  applyCanvasTransform();
}
function resetZoom() {
  const container = document.getElementById('tree-container');
  const nodeContainer = document.getElementById('tree-nodes');
  if (!container || !nodeContainer) return;
  const cards = nodeContainer.querySelectorAll('.family-card');
  if (cards.length === 0) {
    scale = 1.0; offsetX = 100; offsetY = 50; applyCanvasTransform();
    return;
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  cards.forEach(card => {
    const left = parseFloat(card.style.left) || 0;
    const top = parseFloat(card.style.top) || 0;
    const w = card.offsetWidth || CARD_WIDTH || 220;
    const h = card.offsetHeight || CARD_HEIGHT || 120;
    if (left < minX) minX = left;
    if (left + w > maxX) maxX = left + w;
    if (top < minY) minY = top;
    if (top + h > maxY) maxY = top + h;
  });
  const pad = 80;
  const contentW = (maxX - minX) + pad * 2;
  const contentH = (maxY - minY) + pad * 2;
  const rect = container.getBoundingClientRect();

  if (rect.width === 0 || rect.height === 0) {
    // Layout not complete yet (common on initial startup or tab switch)
    // Use window sizes as fallback and retry shortly
    const tempW = window.innerWidth - 280;
    const tempH = window.innerHeight - 70;
    const wVal = tempW > 0 ? tempW : 1000;
    const hVal = tempH > 0 ? tempH : 600;
    scale = Math.max(0.25, Math.min(Math.min(wVal / contentW, hVal / contentH), 1.5));
    offsetX = wVal / 2 - (minX + (maxX - minX) / 2) * scale;
    offsetY = hVal / 2 - (minY + (maxY - minY) / 2) * scale;
    applyCanvasTransform();
    setTimeout(resetZoom, 50);
    return;
  }

  scale = Math.max(0.25, Math.min(Math.min(rect.width / contentW, rect.height / contentH), 1.5));
  offsetX = rect.width / 2 - (minX + (maxX - minX) / 2) * scale;
  offsetY = rect.height / 2 - (minY + (maxY - minY) / 2) * scale;
  applyCanvasTransform();
}

// =================================================================
// RECURSIVE BRANCH FOCUS & FILTERING ENGINE
// =================================================================

/**
 * Recursively crawls downward to find all descendants, their spouses,
 * the root member, and the root member's spouse.
 */
function getBranchSubTree(rootId) {
  const branchIds = new Set();
  const queue = [rootId];
  
  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!branchIds.has(currentId)) {
      branchIds.add(currentId);
      
      const member = familyData.find(m => m.id === currentId);
      if (member) {
        // Add spouse if any
        if (member.spouseId) {
          branchIds.add(member.spouseId);
        }
        // Find children
        const children = familyData.filter(m => m.fatherId === currentId || m.motherId === currentId);
        children.forEach(child => {
          if (!branchIds.has(child.id)) {
            queue.push(child.id);
          }
        });
      }
    }
  }
  return branchIds;
}

/**
 * Returns filtered members list if a branch focus is active,
 * otherwise returns raw familyData.
 */
function getFilteredTreeMembers() {
  if (!focusedBranchRootId) {
    return familyData;
  }
  const activeIds = getBranchSubTree(focusedBranchRootId);
  return familyData.filter(m => activeIds.has(m.id));
}

/**
 * Isolate tree focus to a chosen branch.
 */
function isolateTreeBranch(memberId) {
  const member = familyData.find(m => m.id === memberId);
  if (!member) return;

  focusedBranchRootId = memberId;
  
  const resetBtn = document.getElementById('search-reset-btn');
  if (resetBtn) {
    resetBtn.classList.remove('hidden');
    safeCreateIcons(); // Ensure the "x" icon is properly rendered inside the button
  }
  
  renderFamilyTree();
  showGenericAlert(`Focused tree view on ${member.firstName}'s branch!`, 'success');
}

/**
 * Reset branch focus to restore complete tree.
 */
function resetTreeBranchFocus() {
  focusedBranchRootId = null;
  
  const resetBtn = document.getElementById('search-reset-btn');
  if (resetBtn) {
    resetBtn.classList.add('hidden');
  }
  
  renderFamilyTree();
  showGenericAlert('Reset view to full family tree.', 'info');
}


// =================================================================
// RENDER FAMILY CARDS & DRAW CONNECTIONS
// =================================================================

let treeCanvasInitialized = false;

function renderFamilyTree() {
  const nodeContainer = document.getElementById('tree-nodes');
  const svg = document.getElementById('tree-svg');

  // Lazy initialize tree canvas listeners once
  if (!treeCanvasInitialized) {
    initializeTreeCanvas();
    treeCanvasInitialized = true;
  }

  const filtered = getFilteredTreeMembers();
  if (filtered.length === 0) {
    nodeContainer.innerHTML = '';
    svg.innerHTML = '';
    if (focusedBranchRootId) {
      resetTreeBranchFocus();
      return;
    }
    showEmptyDatabaseWelcome();
    return;
  }

  // Remove any existing empty welcome card since we now have data to render
  const welcomeCard = document.getElementById('tree-container')?.querySelector('.empty-welcome-card');
  if (welcomeCard) {
    welcomeCard.remove();
  }

  renderStandardTree();

  // By default, zoom to fit all available data in the viewport
  resetZoom();
}


// =================================================================
// RECURSIVE BRANCHING STANDARD DESCENDANT TREE LAYOUT
// =================================================================

function renderStandardTree() {
  const nodeContainer = document.getElementById('tree-nodes');
  const svg = document.getElementById('tree-svg');

  nodeContainer.innerHTML = '';
  svg.innerHTML = '';

  // Let's set standard large bounds for SVG canvas so panning works perfectly
  svg.setAttribute("width", "4000");
  svg.setAttribute("height", "2500");

  const filtered = getFilteredTreeMembers();

  // Find all roots in the tree (members with no parents in filtered set)
  let roots = filtered.filter(m => {
    const hasFather = m.fatherId && filtered.some(p => p.id === m.fatherId);
    const hasMother = m.motherId && filtered.some(p => p.id === m.motherId);
    if (hasFather || hasMother) return false;

    if (m.spouseId) {
      const spouse = filtered.find(s => s.id === m.spouseId);
      if (spouse) {
        const spouseHasFather = spouse.fatherId && filtered.some(p => p.id === spouse.fatherId);
        const spouseHasMother = spouse.motherId && filtered.some(p => p.id === spouse.motherId);
        if (spouseHasFather || spouseHasMother) return false;
      }
    }
    return true;
  });

  if (roots.length === 0 && filtered.length > 0) {
    // Fallback: if there are no true roots (due to circular references), use the first member
    roots = [filtered[0]];
  }

  const coords = {};
  const arranged = new Set();
  const visited = new Set();

  // 1. Recursive helper to measure the width of each branch
  function measureSubtree(memberId) {
    if (visited.has(memberId)) return 0;
    visited.add(memberId);

    const m = filtered.find(x => x.id === memberId);
    if (!m) return 0;

    const children = filtered.filter(x => x.fatherId === m.id || x.motherId === m.id);

    // If married, count spouse as part of this node's horizontal footprint
    if (m.spouseId && filtered.some(x => x.id === m.spouseId)) {
      visited.add(m.spouseId);
    }

    const selfWidth = m.spouseId ? (CARD_WIDTH * 2 + 40) : CARD_WIDTH; // 480px for couple vs. 220px single

    if (children.length === 0) {
      return selfWidth;
    }

    let totalChildrenWidth = 0;
    children.forEach((child, idx) => {
      totalChildrenWidth += measureSubtree(child.id);
      if (idx < children.length - 1) {
        totalChildrenWidth += 80; // Gap between sibling subtrees
      }
    });

    return Math.max(selfWidth, totalChildrenWidth);
  }

  // 2. Recursive helper to position the subtrees
  function positionSubtree(memberId, startX, gen) {
    if (arranged.has(memberId)) return;

    const m = filtered.find(x => x.id === memberId);
    if (!m) return;

    const children = filtered.filter(x => x.fatherId === m.id || x.motherId === m.id);
    const isCouple = m.spouseId && filtered.some(x => x.id === m.spouseId);

    if (isCouple) {
      arranged.add(m.spouseId);
    }
    arranged.add(m.id);

    // Dynamic vertical layer coordinate
    const yCoord = gen * LAYER_HEIGHT + 100;

    visited.clear();
    const subtreeWidth = measureSubtree(memberId);

    if (children.length === 0) {
      // Leaf node: center card(s) in allocated space
      if (isCouple) {
        const midX = startX + (subtreeWidth - (CARD_WIDTH * 2 + 40)) / 2;
        coords[m.id] = { x: midX, y: yCoord, gen };
        coords[m.spouseId] = { x: midX + CARD_GAP_X, y: yCoord, gen };
      } else {
        const midX = startX + (subtreeWidth - CARD_WIDTH) / 2;
        coords[m.id] = { x: midX, y: yCoord, gen };
      }
      return;
    }

    // Recursively layout all children side-by-side
    let currentX = startX;
    const childCenters = [];

    children.forEach(child => {
      visited.clear();
      const childWidth = measureSubtree(child.id);
      positionSubtree(child.id, currentX, gen + 1);

      // Find positioned child visual center
      if (coords[child.id]) {
        let cCenter = coords[child.id].x + CARD_WIDTH / 2;
        const childIsCouple = child.spouseId && filtered.some(x => x.id === child.spouseId);
        if (childIsCouple && coords[child.spouseId]) {
          cCenter = (coords[child.id].x + coords[child.spouseId].x + CARD_WIDTH) / 2;
        }
        childCenters.push(cCenter);
      }

      currentX += childWidth + 80; // Sibling gap
    });

    if (childCenters.length > 0) {
      // Position parents centered directly above child centers
      const minC = Math.min(...childCenters);
      const maxC = Math.max(...childCenters);
      const childrenMid = (minC + maxC) / 2;

      if (isCouple) {
        const parentLeftX = childrenMid - CARD_GAP_X / 2 - CARD_WIDTH / 2;
        coords[m.id] = { x: parentLeftX, y: yCoord, gen };
        coords[m.spouseId] = { x: parentLeftX + CARD_GAP_X, y: yCoord, gen };
      } else {
        coords[m.id] = { x: childrenMid - CARD_WIDTH / 2, y: yCoord, gen };
      }
    } else {
      // Fallback if children couldn't be positioned
      if (isCouple) {
        coords[m.id] = { x: startX, y: yCoord, gen };
        coords[m.spouseId] = { x: startX + CARD_GAP_X, y: yCoord, gen };
      } else {
        coords[m.id] = { x: startX, y: yCoord, gen };
      }
    }
  }

  // 3. Layout multiple roots side-by-side
  const rootPlaced = new Set();
  let globalX = 200;

  roots.forEach(r => {
    if (rootPlaced.has(r.id)) return;

    visited.clear();
    const rootWidth = measureSubtree(r.id);
    positionSubtree(r.id, globalX, 0);

    rootPlaced.add(r.id);
    if (r.spouseId) rootPlaced.add(r.spouseId);

    globalX += rootWidth + 150; // Distinct space between root trees
  });

  // Keep track of marriage midpoints to drop parent lines
  const marriageMidpoints = {};

  // 4. Draw Marriage Connectors
  filtered.forEach(m => {
    const c = coords[m.id];
    if (!c) return;

    if (m.spouseId && coords[m.spouseId] && m.id < m.spouseId && filtered.some(x => x.id === m.spouseId)) {
      const spouseC = coords[m.spouseId];
      
      const startX = c.x + CARD_WIDTH;
      const startY = c.y + CARD_HEIGHT / 2;
      const endX = spouseC.x;
      const endY = spouseC.y + CARD_HEIGHT / 2;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${startY} L ${endX} ${endY}`);
      path.setAttribute("class", "connector-line connector-spouse");
      path.setAttribute("id", `marriage-line-${m.id}-${m.spouseId}`);
      svg.appendChild(path);

      const midKey = [m.id, m.spouseId].sort().join('-');
      marriageMidpoints[midKey] = {
        x: (startX + endX) / 2,
        y: startY
      };

      if (m.marriageDate) {
        const midX = (startX + endX) / 2;
        const midY = startY;

        const textGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        textGroup.setAttribute("transform", `translate(${midX}, ${midY})`);

        const heartCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        heartCircle.setAttribute("r", "14");
        heartCircle.setAttribute("fill", "var(--bg-secondary)");
        heartCircle.setAttribute("stroke", "var(--pink)");
        heartCircle.setAttribute("stroke-width", "1");
        textGroup.appendChild(heartCircle);

        const heartText = document.createElementNS("http://www.w3.org/2000/svg", "text");
        heartText.setAttribute("text-anchor", "middle");
        heartText.setAttribute("dy", "4");
        heartText.setAttribute("fill", "var(--pink)");
        heartText.setAttribute("font-size", "9px");
        heartText.setAttribute("font-weight", "800");
        heartText.setAttribute("font-family", "var(--font-sans)");
        heartText.textContent = "💖";
        textGroup.appendChild(heartText);

        svg.appendChild(textGroup);
      }
    }
  });

  // 5. Draw Parent-to-Child Connectors
  filtered.forEach(m => {
    const c = coords[m.id];
    if (!c) return;

    const hasFather = m.fatherId && coords[m.fatherId] && filtered.some(x => x.id === m.fatherId);
    const hasMother = m.motherId && coords[m.motherId] && filtered.some(x => x.id === m.motherId);

    if (hasFather || hasMother) {
      let parentAnchorX = 0;
      let parentAnchorY = 0;

      if (hasFather && hasMother) {
        const midKey = [m.fatherId, m.motherId].sort().join('-');
        if (marriageMidpoints[midKey]) {
          parentAnchorX = marriageMidpoints[midKey].x;
          parentAnchorY = marriageMidpoints[midKey].y;
        } else {
          parentAnchorX = (coords[m.fatherId].x + coords[m.motherId].x) / 2 + CARD_WIDTH / 2;
          parentAnchorY = coords[m.fatherId].y + CARD_HEIGHT;
        }
      } else if (hasFather) {
        parentAnchorX = coords[m.fatherId].x + CARD_WIDTH / 2;
        parentAnchorY = coords[m.fatherId].y + CARD_HEIGHT;
      } else if (hasMother) {
        parentAnchorX = coords[m.motherId].x + CARD_WIDTH / 2;
        parentAnchorY = coords[m.motherId].y + CARD_HEIGHT;
      }

      const childX = c.x + CARD_WIDTH / 2;
      const childY = c.y;

      const dropY = parentAnchorY + 40;
      const pathData = `
        M ${parentAnchorX} ${parentAnchorY}
        L ${parentAnchorX} ${dropY}
        L ${childX} ${dropY}
        L ${childX} ${childY}
      `;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("class", "connector-line");
      path.setAttribute("id", `child-line-${m.id}`);
      svg.appendChild(path);
    }
  });

  // 6. Draw HTML Cards
  filtered.forEach(m => {
    const c = coords[m.id];
    if (!c) return;

    const card = document.createElement('div');
    card.className = 'family-card';
    card.style.left = `${c.x}px`;
    card.style.top = `${c.y}px`;
    card.setAttribute('data-id', m.id);

    const editable = canEdit(m.id);
    if (editable) {
      card.classList.add('is-editable');
    }

    const bdayCountdown = m.birthDate && !m.isDeceased ? getEventCountdown(m.birthDate) : null;
    const isBdayToday = bdayCountdown && bdayCountdown.daysRemaining === 0;

    const annivCountdown = m.marriageDate && m.spouseId ? getEventCountdown(m.marriageDate) : null;
    const isAnnivToday = annivCountdown && annivCountdown.daysRemaining === 0;
    if (isBdayToday || isAnnivToday) {
      card.classList.add('celebrating-today-card');
    }

    let badgesHtml = '';
    if (m.isDeceased) {
      badgesHtml += `<span class="card-badge deceased">🕊️ Passed</span>`;
    } else if (editable) {
      badgesHtml += `<span class="card-badge editable" title="You have edit rights on this member">✍️ Edit</span>`;
    } else if (currentSession) {
      badgesHtml += `<span class="card-badge lock" title="View Only: restricted to descendants"><i data-lucide="lock" style="width: 8px; height: 8px;"></i> Lock</span>`;
    }

    card.innerHTML = `
      <div class="card-badges">${badgesHtml}</div>
      <div class="card-avatar-wrapper">
        <div class="card-avatar">${getMemberAvatarHtml(m)}</div>
        <div class="gender-dot ${m.gender.toLowerCase()}"></div>
      </div>
      <div class="card-name">${m.firstName} ${m.lastName}</div>
      ${m.nickname ? `<div class="card-nickname">"${m.nickname}"</div>` : ''}
      <div class="card-dates">${getYearRange(m)}</div>
    `;

    card.onclick = (e) => {
      e.stopPropagation();
      openInfoDrawer(m.id);
    };

    card.ondblclick = (e) => {
      e.stopPropagation();
      if (editable) {
        openEditMemberModal(m.id);
      } else {
        showGenericAlert(getPermissionMessage(m.id), 'warning');
      }
    };

    card.onmouseenter = () => highlightRelations(m.id, true);
    card.onmouseleave = () => highlightRelations(m.id, false);

    nodeContainer.appendChild(card);
  });

  if (activeHighlightedCardId) {
    focusOnTreeCard(activeHighlightedCardId, false);
  }

  safeCreateIcons();
}

// =================================================================
// DRAWER INSPECTOR & CONNECTOR HIGHLIGHTING
// =================================================================

function openInfoDrawer(memberId) {
  const member = familyData.find(m => m.id === memberId);
  if (!member) return;

  activeHighlightedCardId = memberId;

  // Add visual selection class on tree cards
  document.querySelectorAll('.family-card').forEach(c => c.classList.remove('active-selected'));
  const card = document.querySelector(`.family-card[data-id="${memberId}"]`);
  if (card) card.classList.add('active-selected');

  const drawer = document.getElementById('info-drawer');
  const content = document.getElementById('drawer-content');

  // Load relation pointers
  const father = member.fatherId ? familyData.find(m => m.id === member.fatherId) : null;
  const mother = member.motherId ? familyData.find(m => m.id === member.motherId) : null;
  const spouse = member.spouseId ? familyData.find(m => m.id === member.spouseId) : null;
  const children = familyData.filter(m => m.fatherId === memberId || m.motherId === memberId);

  // Parse age or custom milestone notes
  const age = shouldHideAge(member.id) ? null : calculateAge(member.birthDate);
  const zodiac = member.birthDate ? getZodiacSign(member.birthDate) : null;

  // Action buttons dynamically loaded
  const canModify = canEdit(memberId);
  let editActionsHtml = '';
  
  if (canModify) {
    editActionsHtml = `
      <button class="btn btn-primary" onclick="openEditMemberModal('${member.id}')" style="width: 100%;">
        <i data-lucide="edit-3"></i> Edit Profile
      </button>
      <div class="form-row-2">
        <button class="btn btn-secondary" onclick="openAddMemberModal('child', '${member.id}')">
          <i data-lucide="user-plus"></i> Add Child
        </button>
        <button class="btn btn-secondary" onclick="openAddMemberModal('spouse', '${member.id}')">
          <i data-lucide="heart-handshake"></i> Add Spouse
        </button>
      </div>
      <button class="btn btn-danger" onclick="deleteFamilyMember('${member.id}')" style="width: 100%;">
        <i data-lucide="trash-2"></i> Delete Member
      </button>
    `;
  } else {
    editActionsHtml = `
      <div class="glass p-12 border-radius-12 font-size-11 color-dim line-height-1.4 text-center">
        ${getPermissionMessage(memberId)}
      </div>
    `;
  }

  // Relations roster list
  let relationsHtml = '';
  if (father) {
    relationsHtml += `
      <div class="drawer-relation-card" onclick="focusOnTreeCard('${father.id}')">
        <div class="avatar-sm">${getMemberAvatarHtml(father)}</div>
        <div class="relation-details">
          <span class="relation-type">Father</span>
          <span class="relation-name">${father.firstName} ${father.lastName}</span>
        </div>
      </div>
    `;
  }
  if (mother) {
    relationsHtml += `
      <div class="drawer-relation-card" onclick="focusOnTreeCard('${mother.id}')">
        <div class="avatar-sm">${getMemberAvatarHtml(mother)}</div>
        <div class="relation-details">
          <span class="relation-type">Mother</span>
          <span class="relation-name">${mother.firstName} ${mother.lastName}</span>
        </div>
      </div>
    `;
  }
  if (spouse) {
    relationsHtml += `
      <div class="drawer-relation-card" onclick="focusOnTreeCard('${spouse.id}')">
        <div class="avatar-sm">${getMemberAvatarHtml(spouse)}</div>
        <div class="relation-details">
          <span class="relation-type">Spouse</span>
          <span class="relation-name">${spouse.firstName} ${spouse.lastName}</span>
        </div>
      </div>
    `;
  }
  children.forEach(child => {
    relationsHtml += `
      <div class="drawer-relation-card" onclick="focusOnTreeCard('${child.id}')">
        <div class="avatar-sm">${getMemberAvatarHtml(child)}</div>
        <div class="relation-details">
          <span class="relation-type">Child</span>
          <span class="relation-name">${child.firstName} ${child.lastName}</span>
        </div>
      </div>
    `;
  });

  if (!relationsHtml) {
    relationsHtml = `<p class="color-dim font-size-11">No parents, spouse or children recorded.</p>`;
  }

  // Contact list rows (Show only if available, not deceased, and not hidden)
  let contactHtml = '';
  const hasContacts = !member.isDeceased && !shouldHideContacts(member.id) && (member.phone || member.email || member.instagramId);
  if (hasContacts) {
    if (member.phone) {
      contactHtml += `
        <div class="contact-row" onclick="openGreetingPortal('${member.id}', 'general')">
          <div class="contact-info-label">
            <span class="contact-label">WhatsApp Number</span>
            <span class="contact-value">${member.phone}</span>
          </div>
          <i data-lucide="message-circle" title="Click to send WhatsApp Message"></i>
        </div>
      `;
    }
    if (member.email) {
      contactHtml += `
        <div class="contact-row" onclick="window.open('mailto:${member.email}', '_blank')">
          <div class="contact-info-label">
            <span class="contact-label">Email Address</span>
            <span class="contact-value">${member.email}</span>
          </div>
          <i data-lucide="mail" style="color: var(--accent-color);" title="Send Email"></i>
        </div>
      `;
    }
    if (member.instagramId) {
      contactHtml += `
        <div class="contact-row" onclick="window.open('https://instagram.com/${member.instagramId}', '_blank')">
          <div class="contact-info-label">
            <span class="contact-label">Instagram</span>
            <span class="contact-value">@${member.instagramId}</span>
          </div>
          <i data-lucide="instagram" style="color: var(--pink);" title="View Instagram Profile"></i>
        </div>
      `;
    }
  }

  // Draw role indicator
  let roleBadgeClass = 'member';
  let roleLabel = 'Family Member';
  if (member.systemRole === 'super_admin') {
    roleBadgeClass = 'super-admin';
    roleLabel = '👑 Super Admin';
  } else if (member.systemRole === 'admin') {
    roleBadgeClass = 'admin';
    roleLabel = '🛠️ Admin Editor';
  }

  // Conditional Instagram DM button rendering (Only if both target and user have handles + target contact info not hidden)
  let instagramDmBtnHtml = '';
  const loggedInMember = currentSession ? familyData.find(m => m.id === currentSession.memberId) : null;
  if (member.instagramId && !shouldHideContacts(member.id) && loggedInMember && loggedInMember.instagramId) {
    instagramDmBtnHtml = `
      <button class="btn" onclick="window.open('https://instagram.com/direct/t/${member.instagramId}/', '_blank')" style="background: linear-gradient(135deg, #f9ce34, #ee2a7b, #6228d7); color: white; width: 100%; border: none; font-weight: 600;">
        <i data-lucide="instagram"></i> Instagram Direct Message
      </button>
    `;
  }

  content.innerHTML = `
    <div class="drawer-profile">
      <div class="avatar-lg">${getMemberAvatarHtml(member)}</div>
      <div>
        <h3 class="cinzel-title" style="font-size: 20px;">${member.firstName} ${member.lastName}</h3>
        ${member.nickname ? `<p class="color-dim font-style-italic font-size-13" style="margin-top: 2px;">"${member.nickname}"</p>` : ''}
      </div>
      <span class="drawer-role-tag ${roleBadgeClass}">${roleLabel}</span>
      <div class="font-size-12 color-dim" style="font-weight: 600;">
        📅 ${getYearRange(member)}
        ${age !== null ? ` | 🎂 ${age} Years Old` : ''}
        ${zodiac ? ` | ✨ ${zodiac}` : ''}
      </div>
    </div>

    <div class="drawer-sections">
      ${hasContacts ? `
      <div class="drawer-section">
        <h5><i data-lucide="phone"></i> Contact Details</h5>
        ${contactHtml}
      </div>
      ` : ''}

      <div class="drawer-section">
        <h5><i data-lucide="users"></i> Relationships</h5>
        ${relationsHtml}
      </div>

      <div class="drawer-actions">
        <button class="btn btn-secondary" onclick="isolateTreeBranch('${member.id}')" style="width: 100%;">
          <i data-lucide="git-branch"></i> Set as Branch Focus
        </button>
        ${instagramDmBtnHtml}
        ${editActionsHtml}
      </div>
    </div>
  `;

  drawer.classList.remove('hidden');
  safeCreateIcons();
}

function closeInfoDrawer() {
  document.getElementById('info-drawer').classList.add('hidden');
  document.querySelectorAll('.family-card').forEach(c => c.classList.remove('active-selected'));
  activeHighlightedCardId = null;
}

/**
 * Focuses/pans/zooms the canvas directly on a card node.
 * @param {string} memberId 
 * @param {boolean} triggerClick If true, opens the inspector panel
 */
function focusOnTreeCard(memberId, triggerClick = true) {
  const card = document.querySelector(`.family-card[data-id="${memberId}"]`);
  if (!card) return;

  const left = parseFloat(card.style.left) || 0;
  const top = parseFloat(card.style.top) || 0;

  // Center on card: center of screen minus card size scaled
  const container = document.getElementById('tree-container');
  const rect = container ? container.getBoundingClientRect() : { width: 0, height: 0 };
  const rectW = rect.width || window.innerWidth - 280;
  const rectH = rect.height || window.innerHeight - 70;

  scale = 1.0; // Reset to 1.0 for precise focus
  offsetX = rectW / 2 - left - CARD_WIDTH / 2;
  offsetY = rectH / 2 - top - CARD_HEIGHT / 2;

  applyCanvasTransform();

  if (triggerClick) {
    openInfoDrawer(memberId);
  } else {
    // Select silently
    document.querySelectorAll('.family-card').forEach(c => c.classList.remove('active-selected'));
    card.classList.add('active-selected');
  }
}

/**
 * Highlights relationships when hovering a card node.
 */
function highlightRelations(memberId, highlight = true) {
  const opVal = highlight ? '1.0' : '0.5';
  const widthVal = highlight ? '4px' : '2.5px';
  const shadowColor = highlight ? 'var(--accent-color)' : 'transparent';

  // Toggle child connector drop lines
  const childLine = document.getElementById(`child-line-${memberId}`);
  if (childLine) {
    childLine.style.opacity = opVal;
    childLine.style.strokeWidth = widthVal;
    if (highlight) childLine.style.stroke = 'var(--accent-color)';
    else childLine.style.stroke = 'var(--text-dim)';
  }

  // Toggle marriage lines
  const filtered = getFilteredTreeMembers();
  filtered.forEach(m => {
    if (m.spouseId === memberId || (m.id === memberId && m.spouseId)) {
      const spA = m.id < m.spouseId ? m.id : m.spouseId;
      const spB = m.id < m.spouseId ? m.spouseId : m.id;
      const marriageLine = document.getElementById(`marriage-line-${spA}-${spB}`);
      if (marriageLine) {
        marriageLine.style.opacity = highlight ? '1.0' : '0.8';
        marriageLine.style.strokeWidth = highlight ? '3.5px' : '2px';
      }
    }
  });
}

// Window resize listener to automatically recenter tree
window.addEventListener('resize', () => {
  if (typeof currentTab !== 'undefined' && currentTab === 'tree') {
    resetZoom();
  }
});
