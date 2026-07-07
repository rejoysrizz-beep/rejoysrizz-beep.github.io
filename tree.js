// =================================================================
// YoyoVayo! FAMILY TREE LAYOUT ENGINE & ZOOMABLE CANVAS
// =================================================================

// --- NAVIGATION & COORDINATE MATRIX ---
let scale = 1.0;
let offsetX = 100;
let offsetY = 50;
let isDragging = false;
let startX = 0, startY = 0;
let activeHighlightedCardId = null;
let focusedBranchRootId = null; // Global tracker for isolative branch focusing
// Layout Grid parameters - updated for high compactness
const CARD_WIDTH = 180;
const CARD_HEIGHT = 96;
const LAYER_HEIGHT = 180; // Compact vertical gap between generations (horizontal layout)
const CARD_GAP_X = 200;    // Compact horizontal gap between spouses (horizontal layout)
const SIBLING_GAP = 40;    // Compact gap between sibling subtrees

// Load orientation preference
window.treeOrientation = localStorage.getItem('yoyovayo_tree_orientation') || 'vertical';

// --- EXPAND/COLLAPSE GLOBAL STATE ---
window.collapsedChildren = window.collapsedChildren || null;
window.collapsedSiblings = window.collapsedSiblings || null;
window.collapsedParents = window.collapsedParents || null;
window.searchFocusMemberId = window.searchFocusMemberId || null;



// --- INITIALIZE INTERACTIVE CANVAS ---
function initializeTreeCanvas() {
  const container = document.getElementById('tree-container');
  const zoomLayer = document.getElementById('zoom-layer');
  if (!container || !zoomLayer) return;

  // Track active pointer events for multi-touch (pinch) and robust drag-pan
  const activePointers = new Map();
  let lastPointerX = null;
  let lastPointerY = null;
  let lastPinchDistance = null;
  let lastMidX = null;
  let lastMidY = null;

  // Mouse wheel zoom (Zooms toward mouse pointer)
  container.onwheel = (e) => {
    e.preventDefault();
    const zoomSpeed = 0.08; // Snappy, premium zoom rate
    const oldScale = scale;
    
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

  // Pointer down (Grab and hold)
  container.onpointerdown = (e) => {
    // Only drag on canvas or zoom layer background (not card nodes or empty state cards or controls)
    if (
      e.target.closest('.family-card') || 
      e.target.closest('.tree-controls') || 
      e.target.closest('.empty-welcome-card') ||
      e.target.closest('button') ||
      e.target.closest('input')
    ) {
      return;
    }
    
    // Prevent default touch behaviors like scrolling the browser body
    if (e.pointerType === 'touch') {
      e.preventDefault();
    }

    container.style.cursor = 'grabbing';
    container.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, e);

    if (activePointers.size === 1) {
      isDragging = true;
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
    } else if (activePointers.size === 2) {
      isDragging = false; // Disable single pointer panning when pinching
      const pointers = [...activePointers.values()];
      lastPinchDistance = Math.hypot(pointers[0].clientX - pointers[1].clientX, pointers[0].clientY - pointers[1].clientY);
      lastMidX = (pointers[0].clientX + pointers[1].clientX) / 2;
      lastMidY = (pointers[0].clientY + pointers[1].clientY) / 2;
    }
  };

  // Pointer move (Smooth delta pan & pinch-zoom)
  container.onpointermove = (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, e);

    if (activePointers.size === 1 && isDragging) {
      // Standard single pointer pan using mouse-move deltas
      const dx = e.clientX - lastPointerX;
      const dy = e.clientY - lastPointerY;
      
      offsetX += dx;
      offsetY += dy;
      
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      applyCanvasTransform();
    } else if (activePointers.size === 2) {
      const pointers = [...activePointers.values()];
      const p1 = pointers[0];
      const p2 = pointers[1];

      const curDist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
      const curMidX = (p1.clientX + p2.clientX) / 2;
      const curMidY = (p1.clientY + p2.clientY) / 2;

      // 1. Dual-finger pan (move canvas as midpoint moves)
      if (lastMidX !== null && lastMidY !== null) {
        const dx = curMidX - lastMidX;
        const dy = curMidY - lastMidY;
        offsetX += dx;
        offsetY += dy;
      }

      // 2. Dual-finger zoom (pinch-zoom centered on fingers' midpoint)
      if (lastPinchDistance !== null && lastPinchDistance > 0) {
        const zoomFactor = curDist / lastPinchDistance;
        const oldScale = scale;
        
        // Boundaries: min 0.2, max 2.5
        scale = Math.min(Math.max(scale * zoomFactor, 0.2), 2.5);

        const rect = container.getBoundingClientRect();
        const midX = curMidX - rect.left;
        const midY = curMidY - rect.top;

        const ratio = scale / oldScale;
        offsetX = midX - (midX - offsetX) * ratio;
        offsetY = midY - (midY - offsetY) * ratio;
      }

      lastPinchDistance = curDist;
      lastMidX = curMidX;
      lastMidY = curMidY;
      
      applyCanvasTransform();
    }
  };

  // Unified cleanup handler for pointer releases
  const handlePointerUp = (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.delete(e.pointerId);
      try {
        container.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    // Restore grab cursor and reset coordinate caches
    if (activePointers.size === 0) {
      container.style.cursor = 'grab';
      isDragging = false;
      lastPointerX = null;
      lastPointerY = null;
      lastPinchDistance = null;
      lastMidX = null;
      lastMidY = null;
    } else if (activePointers.size === 1) {
      // Seamlessly transition back to 1-finger panning with the remaining pointer
      isDragging = true;
      const remainingPointer = [...activePointers.values()][0];
      lastPointerX = remainingPointer.clientX;
      lastPointerY = remainingPointer.clientY;
      lastPinchDistance = null;
      lastMidX = null;
      lastMidY = null;
    }
  };

  // Wire events to the container for robust release handling
  container.onpointerup = handlePointerUp;
  container.onpointercancel = handlePointerUp;
  container.onlostpointercapture = handlePointerUp;
  container.onpointerleave = handlePointerUp;
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
 * Helper to recursively find all ancestors of a member.
 */
function getAncestors(memberId, ancestors = new Set()) {
  const m = familyData.find(x => x.id === memberId);
  if (!m) return ancestors;

  if (m.fatherId && !ancestors.has(m.fatherId)) {
    ancestors.add(m.fatherId);
    getAncestors(m.fatherId, ancestors);
  }
  if (m.motherId && !ancestors.has(m.motherId)) {
    ancestors.add(m.motherId);
    getAncestors(m.motherId, ancestors);
  }
  return ancestors;
}

/**
 * Processes the active branch and filters members recursively based on active expand/collapse states.
 */
function computeVisibleMembers() {
  const filtered = getFilteredTreeMembers();
  if (filtered.length === 0) return [];

  // Default to collapse all if uninitialized
  if (!window.collapsedChildren || !window.collapsedSiblings || !window.collapsedParents) {
    if (!window.collapsedChildren) {
      window.collapsedChildren = new Set();
      familyData.forEach(m => {
        const hasChildren = familyData.some(x => x.fatherId === m.id || x.motherId === m.id);
        if (hasChildren) {
          window.collapsedChildren.add(m.id);
        }
      });
    }
    if (!window.collapsedSiblings) {
      window.collapsedSiblings = new Set();
    }
    if (!window.collapsedParents) {
      window.collapsedParents = new Set();
    }
  }

  // Compute hidden ancestors based on collapsedParents
  const hiddenAncestors = new Set();
  filtered.forEach(m => {
    if (window.collapsedParents.has(m.id)) {
      if (m.fatherId) {
        hiddenAncestors.add(m.fatherId);
        getAncestors(m.fatherId, hiddenAncestors);
      }
      if (m.motherId) {
        hiddenAncestors.add(m.motherId);
        getAncestors(m.motherId, hiddenAncestors);
      }
    }
  });

  // Also include spouses of hidden ancestors so they disappear together
  const extraSpouses = [];
  hiddenAncestors.forEach(id => {
    const m = familyData.find(x => x.id === id);
    if (m && m.spouseId) {
      extraSpouses.push(m.spouseId);
    }
  });
  extraSpouses.forEach(id => hiddenAncestors.add(id));

  // Filter candidate pool to exclude hidden ancestors
  const candidates = filtered.filter(m => !hiddenAncestors.has(m.id));
  if (candidates.length === 0) return [];

  // Find root members within the candidates set
  let roots = candidates.filter(m => {
    const hasFather = m.fatherId && candidates.some(p => p.id === m.fatherId);
    const hasMother = m.motherId && candidates.some(p => p.id === m.motherId);
    if (hasFather || hasMother) return false;

    if (m.spouseId) {
      const spouse = candidates.find(s => s.id === m.spouseId);
      if (spouse) {
        const spouseHasFather = spouse.fatherId && candidates.some(p => p.id === spouse.fatherId);
        const spouseHasMother = spouse.motherId && candidates.some(p => p.id === spouse.motherId);
        if (spouseHasFather || spouseHasMother) return false;
      }
    }

    // Exclude root siblings if one of their siblings is collapsed/focused in collapsedSiblings
    const siblings = candidates.filter(x => 
      x.id !== m.id && (
        (m.fatherId && x.fatherId === m.fatherId) ||
        (m.motherId && x.motherId === m.motherId)
      )
    );
    const hasCollapsedSibling = siblings.some(sib => window.collapsedSiblings && window.collapsedSiblings.has(sib.id));
    if (hasCollapsedSibling && window.collapsedSiblings && !window.collapsedSiblings.has(m.id)) {
      return false;
    }

    return true;
  });

  if (roots.length === 0 && candidates.length > 0) {
    roots = [candidates[0]];
  }

  const visible = new Set();

  function traverse(memberId) {
    if (visible.has(memberId)) return;
    visible.add(memberId);

    const m = candidates.find(x => x.id === memberId);
    if (!m) return;

    // Add spouse if any
    if (m.spouseId) {
      const spouse = candidates.find(x => x.id === m.spouseId);
      if (spouse) {
        visible.add(m.spouseId);
      }
    }

    // Check if children are collapsed
    const childrenCollapsed = window.collapsedChildren.has(m.id) || (m.spouseId && window.collapsedChildren.has(m.spouseId));
    if (childrenCollapsed) {
      return;
    }

    let children = candidates.filter(x => x.fatherId === m.id || x.motherId === m.id);
    if (typeof sortSiblings === 'function') {
      children = sortSiblings(children);
    }

    if (children.length === 0) return;

    // Check if any of these children has siblings collapsed!
    const siblingCollapser = children.find(child => window.collapsedSiblings.has(child.id));
    if (siblingCollapser) {
      traverse(siblingCollapser.id);
    } else {
      children.forEach(child => {
        traverse(child.id);
      });
    }
  }

  roots.forEach(root => {
    traverse(root.id);
  });

  // If search focus is active, restrict visible set to only the connected component of the search focus member
  if (window.searchFocusMemberId && visible.has(window.searchFocusMemberId)) {
    const connected = new Set();
    const queue = [window.searchFocusMemberId];
    connected.add(window.searchFocusMemberId);

    while (queue.length > 0) {
      const currId = queue.shift();
      const curr = candidates.find(x => x.id === currId);
      if (curr) {
        // Find all immediate relatives in the visible set:
        const relatives = [];

        // 1. Spouse
        if (curr.spouseId && visible.has(curr.spouseId)) {
          relatives.push(curr.spouseId);
        }
        // 2. Father
        if (curr.fatherId && visible.has(curr.fatherId)) {
          relatives.push(curr.fatherId);
        }
        // 3. Mother
        if (curr.motherId && visible.has(curr.motherId)) {
          relatives.push(curr.motherId);
        }
        // 4. Children (where curr is father or mother)
        candidates.forEach(x => {
          if ((x.fatherId === currId || x.motherId === currId) && visible.has(x.id)) {
            relatives.push(x.id);
          }
        });
        // 5. Reverse spouse lookup
        candidates.forEach(x => {
          if (x.spouseId === currId && visible.has(x.id)) {
            relatives.push(x.id);
          }
        });

        relatives.forEach(relId => {
          if (!connected.has(relId)) {
            connected.add(relId);
            queue.push(relId);
          }
        });
      }
    }

    // Replace visible with connected
    visible.clear();
    connected.forEach(id => visible.add(id));
  }

  return candidates.filter(m => visible.has(m.id));
}
window.computeVisibleMembers = computeVisibleMembers;

function expandAll() {
  window.collapsedChildren = new Set();
  window.collapsedSiblings = new Set();
  window.collapsedParents = new Set();
  renderFamilyTree();
  showGenericAlert('Expanded the entire family tree!', 'info');
}
window.expandAll = expandAll;

function collapseAll() {
  window.collapsedChildren = new Set();
  window.collapsedSiblings = new Set();
  window.collapsedParents = new Set();
  familyData.forEach(m => {
    const hasChildren = familyData.some(x => x.fatherId === m.id || x.motherId === m.id);
    if (hasChildren) {
      window.collapsedChildren.add(m.id);
    }
  });
  renderFamilyTree();
  showGenericAlert('Collapsed all branches down to root.', 'info');
}
window.collapseAll = collapseAll;

function toggleChildren(memberId, event) {
  if (event) event.stopPropagation();
  const m = familyData.find(x => x.id === memberId);
  if (!m) return;

  const isCollapsed = window.collapsedChildren.has(m.id) || (m.spouseId && window.collapsedChildren.has(m.spouseId));

  if (isCollapsed) {
    window.collapsedChildren.delete(m.id);
    if (m.spouseId) {
      window.collapsedChildren.delete(m.spouseId);
    }
  } else {
    window.collapsedChildren.add(m.id);
    if (m.spouseId) {
      window.collapsedChildren.add(m.spouseId);
    }
  }

  renderFamilyTree();
}
window.toggleChildren = toggleChildren;

function toggleSiblings(memberId, event) {
  if (event) event.stopPropagation();
  const m = familyData.find(x => x.id === memberId);
  if (!m) return;

  const isCollapsed = window.collapsedSiblings.has(m.id);

  if (isCollapsed) {
    window.collapsedSiblings.delete(m.id);
  } else {
    // Clear other siblings of the same parent
    const parentChildren = familyData.filter(x => 
      (m.fatherId && x.fatherId === m.fatherId) ||
      (m.motherId && x.motherId === m.motherId)
    );
    parentChildren.forEach(sib => {
      window.collapsedSiblings.delete(sib.id);
    });
    window.collapsedSiblings.add(m.id);
  }

  renderFamilyTree();
}
window.toggleSiblings = toggleSiblings;

function toggleParents(memberId, event) {
  if (event) event.stopPropagation();
  const m = familyData.find(x => x.id === memberId);
  if (!m) return;

  const isCollapsed = window.collapsedParents.has(m.id);

  if (isCollapsed) {
    window.collapsedParents.delete(m.id);
  } else {
    window.collapsedParents.add(m.id);
  }

  renderFamilyTree();
}
window.toggleParents = toggleParents;

function clearCollapsedStates() {
  window.collapsedChildren = null;
  window.collapsedSiblings = null;
  window.collapsedParents = null;
  window.searchFocusMemberId = null;
}
window.clearCollapsedStates = clearCollapsedStates;

function expandAncestors(memberId, skipRender = false) {
  const m = familyData.find(x => x.id === memberId);
  if (!m) return false;

  let needsRender = false;

  // Initialize if uninitialized
  if (!window.collapsedChildren || !window.collapsedSiblings || !window.collapsedParents) {
    computeVisibleMembers(); // This forces initialization of default collapse states
  }

  // Remove memberId from window.collapsedParents to expand their parents
  if (window.collapsedParents && window.collapsedParents.has(memberId)) {
    window.collapsedParents.delete(memberId);
    needsRender = true;
  }

  // 1. Expand parents/ancestors
  if (m.fatherId) {
    if (window.collapsedChildren && window.collapsedChildren.has(m.fatherId)) {
      window.collapsedChildren.delete(m.fatherId);
      needsRender = true;
    }
    if (expandAncestors(m.fatherId, true)) {
      needsRender = true;
    }
  }
  if (m.motherId) {
    if (window.collapsedChildren && window.collapsedChildren.has(m.motherId)) {
      window.collapsedChildren.delete(m.motherId);
      needsRender = true;
    }
    if (expandAncestors(m.motherId, true)) {
      needsRender = true;
    }
  }

  // 2. Expand siblings if this member was hidden due to sibling collapse
  const parentChildren = familyData.filter(x => 
    (m.fatherId && x.fatherId === m.fatherId) ||
    (m.motherId && x.motherId === m.motherId)
  );
  parentChildren.forEach(sib => {
    if (window.collapsedSiblings && window.collapsedSiblings.has(sib.id)) {
      window.collapsedSiblings.delete(sib.id);
      needsRender = true;
    }
  });

  if (needsRender && !skipRender) {
    renderFamilyTree();
  }

  return needsRender;
}
window.expandAncestors = expandAncestors;

/**
 * Ensures a member is visible with both parents and children open/expanded,
 * then renders the tree.
 */
function openMemberInTree(memberId) {
  const m = familyData.find(x => x.id === memberId);
  if (!m) return;

  // Set active search focus member
  window.searchFocusMemberId = memberId;

  // Initialize collapse states cleanly
  window.collapsedParents = new Set();
  window.collapsedChildren = new Set();
  window.collapsedSiblings = new Set();

  // 1. Collapse grandparents (parents of parents) and spouse's parents
  if (m.fatherId) {
    window.collapsedParents.add(m.fatherId);
  }
  if (m.motherId) {
    window.collapsedParents.add(m.motherId);
  }
  if (m.spouseId) {
    window.collapsedParents.add(m.spouseId);
  }

  // 2. Collapse grandchildren (children of the member's children)
  const children = familyData.filter(x => 
    x.fatherId === memberId || 
    x.motherId === memberId || 
    (m.spouseId && (x.fatherId === m.spouseId || x.motherId === m.spouseId))
  );
  children.forEach(child => {
    window.collapsedChildren.add(child.id);
  });

  // 3. Hide siblings of the member
  window.collapsedSiblings.add(memberId);

  // 4. Hide siblings of the parents
  if (m.fatherId) {
    window.collapsedSiblings.add(m.fatherId);
  }
  if (m.motherId) {
    window.collapsedSiblings.add(m.motherId);
  }

  // 5. Show reset button so the user can easily restore the full tree
  const resetBtn = document.getElementById('search-reset-btn');
  if (resetBtn) {
    resetBtn.classList.remove('hidden');
    safeCreateIcons();
  }

  // Render tree to apply state changes
  renderFamilyTree();
}
window.openMemberInTree = openMemberInTree;


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
  clearCollapsedStates();
  
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

  const container = document.getElementById('tree-container');
  if (container) {
    if (window.treeOrientation === 'vertical') {
      container.classList.remove('horizontal-view');
      container.classList.add('vertical-view');
    } else {
      container.classList.remove('vertical-view');
      container.classList.add('horizontal-view');
    }
  }

  const filtered = computeVisibleMembers();


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

  const isVertical = window.treeOrientation === 'vertical';

  // --- HORIZONTAL RECURSIVE HELPERS ---
  // 1. Recursive helper to measure the width of each branch (horizontal layout)
  function measureSubtree(memberId) {
    if (visited.has(memberId)) return 0;
    visited.add(memberId);

    const m = filtered.find(x => x.id === memberId);
    if (!m) return 0;

    const children = sortSiblings(filtered.filter(x => x.fatherId === m.id || x.motherId === m.id));

    if (m.spouseId && filtered.some(x => x.id === m.spouseId)) {
      visited.add(m.spouseId);
    }

    const selfWidth = m.spouseId ? (CARD_WIDTH + CARD_GAP_X) : CARD_WIDTH;

    if (children.length === 0) {
      return selfWidth;
    }

    let totalChildrenWidth = 0;
    children.forEach((child, idx) => {
      totalChildrenWidth += measureSubtree(child.id);
      if (idx < children.length - 1) {
        totalChildrenWidth += SIBLING_GAP; // Compact sibling gap (40px)
      }
    });

    return Math.max(selfWidth, totalChildrenWidth);
  }

  // 2. Recursive helper to position the subtrees (horizontal layout)
  function positionSubtree(memberId, startX, gen) {
    if (arranged.has(memberId)) return;

    const m = filtered.find(x => x.id === memberId);
    if (!m) return;

    const children = sortSiblings(filtered.filter(x => x.fatherId === m.id || x.motherId === m.id));
    const isCouple = m.spouseId && filtered.some(x => x.id === m.spouseId);

    if (isCouple) {
      arranged.add(m.spouseId);
    }
    arranged.add(m.id);

    const yCoord = gen * LAYER_HEIGHT + 100;

    visited.clear();
    const subtreeWidth = measureSubtree(memberId);

    if (children.length === 0) {
      if (isCouple) {
        const midX = startX + (subtreeWidth - (CARD_WIDTH + CARD_GAP_X)) / 2;
        coords[m.id] = { x: midX, y: yCoord, gen };
        coords[m.spouseId] = { x: midX + CARD_GAP_X, y: yCoord, gen };
      } else {
        const midX = startX + (subtreeWidth - CARD_WIDTH) / 2;
        coords[m.id] = { x: midX, y: yCoord, gen };
      }
      return;
    }

    let currentX = startX;
    const childCenters = [];

    children.forEach(child => {
      visited.clear();
      const childWidth = measureSubtree(child.id);
      positionSubtree(child.id, currentX, gen + 1);

      if (coords[child.id]) {
        let cCenter = coords[child.id].x + CARD_WIDTH / 2;
        const childIsCouple = child.spouseId && filtered.some(x => x.id === child.spouseId);
        if (childIsCouple && coords[child.spouseId]) {
          cCenter = (coords[child.id].x + coords[child.spouseId].x + CARD_WIDTH) / 2;
        }
        childCenters.push(cCenter);
      }

      currentX += childWidth + SIBLING_GAP;
    });

    if (childCenters.length > 0) {
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
      if (isCouple) {
        coords[m.id] = { x: startX, y: yCoord, gen };
        coords[m.spouseId] = { x: startX + CARD_GAP_X, y: yCoord, gen };
      } else {
        coords[m.id] = { x: startX, y: yCoord, gen };
      }
    }
  }

  // --- VERTICAL RECURSIVE HELPERS ---
  // 1. Recursive helper to measure the height of each branch (vertical sideways layout)
  function measureSubtreeVert(memberId) {
    if (visited.has(memberId)) return 0;
    visited.add(memberId);

    const m = filtered.find(x => x.id === memberId);
    if (!m) return 0;

    const children = sortSiblings(filtered.filter(x => x.fatherId === m.id || x.motherId === m.id));

    if (m.spouseId && filtered.some(x => x.id === m.spouseId)) {
      visited.add(m.spouseId);
    }

    const selfHeight = m.spouseId ? (CARD_HEIGHT * 2 + 19) : CARD_HEIGHT; // 211px vs 96px

    if (children.length === 0) {
      return selfHeight;
    }

    let totalChildrenHeight = 0;
    children.forEach((child, idx) => {
      totalChildrenHeight += measureSubtreeVert(child.id);
      if (idx < children.length - 1) {
        totalChildrenHeight += SIBLING_GAP; // Compact sibling gap (40px)
      }
    });

    return Math.max(selfHeight, totalChildrenHeight);
  }

  // 2. Recursive helper to position the subtrees (vertical sideways layout)
  function positionSubtreeVert(memberId, startY, gen) {
    if (arranged.has(memberId)) return;

    const m = filtered.find(x => x.id === memberId);
    if (!m) return;

    const children = sortSiblings(filtered.filter(x => x.fatherId === m.id || x.motherId === m.id));
    const isCouple = m.spouseId && filtered.some(x => x.id === m.spouseId);

    if (isCouple) {
      arranged.add(m.spouseId);
    }
    arranged.add(m.id);

    // Generations run along X-axis
    const xCoord = gen * 260 + 100;

    visited.clear();
    const subtreeHeight = measureSubtreeVert(memberId);

    if (children.length === 0) {
      if (isCouple) {
        const midY = startY + (subtreeHeight - (CARD_HEIGHT * 2 + 19)) / 2;
        const spouse = filtered.find(x => x.id === m.spouseId);
        let husbandId = m.id;
        let wifeId = m.spouseId;
        if (m.gender === 'Female' || (spouse && spouse.gender === 'Male')) {
          husbandId = m.spouseId;
          wifeId = m.id;
        }
        coords[husbandId] = { x: xCoord, y: midY, gen };
        coords[wifeId] = { x: xCoord, y: midY + 115, gen };
      } else {
        const midY = startY + (subtreeHeight - CARD_HEIGHT) / 2;
        coords[m.id] = { x: xCoord, y: midY, gen };
      }
      return;
    }

    let currentY = startY;
    const childCenters = [];

    children.forEach(child => {
      visited.clear();
      const childHeight = measureSubtreeVert(child.id);
      positionSubtreeVert(child.id, currentY, gen + 1);

      if (coords[child.id]) {
        let cCenter = coords[child.id].y + CARD_HEIGHT / 2;
        const childIsCouple = child.spouseId && filtered.some(x => x.id === child.spouseId);
        if (childIsCouple && coords[child.spouseId]) {
          cCenter = (coords[child.id].y + coords[child.spouseId].y + CARD_HEIGHT) / 2;
        }
        childCenters.push(cCenter);
      }

      currentY += childHeight + SIBLING_GAP;
    });

    if (childCenters.length > 0) {
      const minC = Math.min(...childCenters);
      const maxC = Math.max(...childCenters);
      const childrenMidY = (minC + maxC) / 2;

      if (isCouple) {
        const parentTopY = childrenMidY - (CARD_HEIGHT * 2 + 19) / 2;
        const spouse = filtered.find(x => x.id === m.spouseId);
        let husbandId = m.id;
        let wifeId = m.spouseId;
        if (m.gender === 'Female' || (spouse && spouse.gender === 'Male')) {
          husbandId = m.spouseId;
          wifeId = m.id;
        }
        coords[husbandId] = { x: xCoord, y: parentTopY, gen };
        coords[wifeId] = { x: xCoord, y: parentTopY + 115, gen };
      } else {
        coords[m.id] = { x: xCoord, y: childrenMidY - CARD_HEIGHT / 2, gen };
      }
    } else {
      if (isCouple) {
        const spouse = filtered.find(x => x.id === m.spouseId);
        let husbandId = m.id;
        let wifeId = m.spouseId;
        if (m.gender === 'Female' || (spouse && spouse.gender === 'Male')) {
          husbandId = m.spouseId;
          wifeId = m.id;
        }
        coords[husbandId] = { x: xCoord, y: startY, gen };
        coords[wifeId] = { x: xCoord, y: startY + 115, gen };
      } else {
        coords[m.id] = { x: xCoord, y: startY, gen };
      }
    }
  }

  // --- POSITION ROOTS ---
  if (isVertical) {
    const rootPlaced = new Set();
    let globalY = 100;

    roots.forEach(r => {
      if (rootPlaced.has(r.id)) return;

      visited.clear();
      const rootHeight = measureSubtreeVert(r.id);
      positionSubtreeVert(r.id, globalY, 0);

      rootPlaced.add(r.id);
      if (r.spouseId) rootPlaced.add(r.spouseId);

      globalY += rootHeight + 100; // Distinct space between root trees vertically
    });
  } else {
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
  }

  // Dynamically compute max coordinates to auto-resize SVG canvas and container elements
  let maxCoordX = 4000;
  let maxCoordY = 2500;
  Object.values(coords).forEach(c => {
    if (c.x + CARD_WIDTH + 1500 > maxCoordX) {
      maxCoordX = c.x + CARD_WIDTH + 1500;
    }
    if (c.y + CARD_HEIGHT + 1500 > maxCoordY) {
      maxCoordY = c.y + CARD_HEIGHT + 1500;
    }
  });

  // Resize both the SVG canvas size and the style widths/heights of the containers
  svg.setAttribute("width", maxCoordX.toString());
  svg.setAttribute("height", maxCoordY.toString());
  svg.style.width = `${maxCoordX}px`;
  svg.style.height = `${maxCoordY}px`;
  nodeContainer.style.width = `${maxCoordX}px`;
  nodeContainer.style.height = `${maxCoordY}px`;

  // Keep track of marriage midpoints to drop parent lines
  const marriageMidpoints = {};

  // 4. Draw Marriage Connectors
  filtered.forEach(m => {
    const c = coords[m.id];
    if (!c) return;

    if (m.spouseId && coords[m.spouseId] && m.id < m.spouseId && filtered.some(x => x.id === m.spouseId)) {
      const spouseC = coords[m.spouseId];
      
      let startX, startY, endX, endY, midX, midY;
      
      if (isVertical) {
        // Sideways Spouse connector: vertical line from upper card bottom-center to lower card top-center
        const upper = c.y < spouseC.y ? c : spouseC;
        const lower = c.y < spouseC.y ? spouseC : c;
        
        startX = upper.x + CARD_WIDTH / 2;
        startY = upper.y + CARD_HEIGHT;
        endX = lower.x + CARD_WIDTH / 2;
        endY = lower.y;
        
        midX = startX;
        midY = (startY + endY) / 2;
      } else {
        // Top-down Spouse connector: horizontal line from left spouse right-center to right spouse left-center
        startX = c.x + CARD_WIDTH;
        startY = c.y + CARD_HEIGHT / 2;
        endX = spouseC.x;
        endY = spouseC.y + CARD_HEIGHT / 2;
        
        midX = (startX + endX) / 2;
        midY = startY;
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M ${startX} ${startY} L ${endX} ${endY}`);
      path.setAttribute("class", "connector-line connector-spouse");
      path.setAttribute("id", `marriage-line-${m.id}-${m.spouseId}`);
      svg.appendChild(path);

      const midKey = [m.id, m.spouseId].sort().join('-');
      marriageMidpoints[midKey] = {
        x: midX,
        y: midY
      };

      if (m.marriageDate) {
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

      if (isVertical) {
        if (hasFather && hasMother) {
          const midKey = [m.fatherId, m.motherId].sort().join('-');
          if (marriageMidpoints[midKey]) {
            parentAnchorX = marriageMidpoints[midKey].x;
            parentAnchorY = marriageMidpoints[midKey].y;
          } else {
            parentAnchorX = coords[m.fatherId].x + CARD_WIDTH;
            parentAnchorY = (coords[m.fatherId].y + coords[m.motherId].y) / 2 + CARD_HEIGHT / 2;
          }
        } else if (hasFather) {
          parentAnchorX = coords[m.fatherId].x + CARD_WIDTH;
          parentAnchorY = coords[m.fatherId].y + CARD_HEIGHT / 2;
        } else if (hasMother) {
          parentAnchorX = coords[m.motherId].x + CARD_WIDTH;
          parentAnchorY = coords[m.motherId].y + CARD_HEIGHT / 2;
        }

        const childX = c.x;
        const childY = c.y + CARD_HEIGHT / 2;

        const routeX = parentAnchorX + 30;
        const pathData = `
          M ${parentAnchorX} ${parentAnchorY}
          L ${routeX} ${parentAnchorY}
          L ${routeX} ${childY}
          L ${childX} ${childY}
        `;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", pathData);
        path.setAttribute("class", "connector-line");
        path.setAttribute("id", `child-line-${m.id}`);
        svg.appendChild(path);
      } else {
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
    }

    let togglesHtml = '';
    const hasChildren = familyData.some(x => x.fatherId === m.id || x.motherId === m.id);
    if (hasChildren) {
      const isChildrenCollapsed = window.collapsedChildren.has(m.id) || (m.spouseId && window.collapsedChildren.has(m.spouseId));
      togglesHtml += `
        <div class="tree-node-toggle toggle-children" title="${isChildrenCollapsed ? 'Expand Children' : 'Collapse Children'}" onclick="toggleChildren('${m.id}', event)">
          <i data-lucide="${isChildrenCollapsed ? 'plus' : 'minus'}"></i>
        </div>
      `;
    }

    const siblings = familyData.filter(x => 
      (m.fatherId && x.fatherId === m.fatherId && x.id !== m.id) ||
      (m.motherId && x.motherId === m.motherId && x.id !== m.id)
    );
    if (siblings.length > 0) {
      const isSiblingsCollapsed = window.collapsedSiblings.has(m.id);
      togglesHtml += `
        <div class="tree-node-toggle toggle-siblings" title="${isSiblingsCollapsed ? 'Expand Siblings' : 'Collapse Siblings'}" onclick="toggleSiblings('${m.id}', event)">
          <i data-lucide="${isSiblingsCollapsed ? 'plus' : 'minus'}"></i>
        </div>
      `;
    }

    const hasParents = (m.fatherId && familyData.some(x => x.id === m.fatherId)) || (m.motherId && familyData.some(x => x.id === m.motherId));
    if (hasParents) {
      const isParentsCollapsed = window.collapsedParents.has(m.id);
      togglesHtml += `
        <div class="tree-node-toggle toggle-parents" title="${isParentsCollapsed ? 'Expand Parents' : 'Collapse Parents'}" onclick="toggleParents('${m.id}', event)">
          <i data-lucide="${isParentsCollapsed ? 'plus' : 'minus'}"></i>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-badges">${badgesHtml}</div>
      <div class="card-avatar-wrapper">
        <div class="card-avatar">${getMemberAvatarHtml(m)}</div>
        <div class="gender-dot ${m.gender.toLowerCase()}"></div>
      </div>
      <div class="card-name">${m.firstName} ${m.lastName}</div>
      ${togglesHtml}
    `;


    card.onclick = (e) => {
      e.stopPropagation();
      openInfoDrawer(m.id);
    };

    card.onmouseenter = () => highlightRelations(m.id, true);
    card.onmouseleave = () => highlightRelations(m.id, false);

    nodeContainer.appendChild(card);
  });

  if (activeHighlightedCardId) {
    focusOnTreeCard(activeHighlightedCardId, false);
  }

  // Synchronize orientation button icon
  const orientationBtn = document.getElementById('tree-orientation-btn');
  if (orientationBtn) {
    if (window.treeOrientation === 'vertical') {
      orientationBtn.innerHTML = '<i data-lucide="git-branch"></i>';
      orientationBtn.setAttribute('title', 'Switch to Top-down view');
    } else {
      orientationBtn.innerHTML = '<i data-lucide="git-commit"></i>';
      orientationBtn.setAttribute('title', 'Switch to Sideways view');
    }
  }

  safeCreateIcons();
}

// =================================================================
// DRAWER INSPECTOR & CONNECTOR HIGHLIGHTING
// =================================================================

function openInfoDrawer(memberId) {
  const member = familyData.find(m => m.id === memberId);
  if (!member) return;

  // Deactivate other tabs and highlight profile sidebar tab
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const profileBtn = document.querySelector('.nav-item[data-tab="profile"]');
  if (profileBtn) profileBtn.classList.add('active');

  activeProfileMemberId = memberId;
  currentTab = 'profile';
  renderActiveTab();
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
  if (typeof openMemberInTree === 'function') {
    openMemberInTree(memberId);
  } else if (typeof expandAncestors === 'function') {
    expandAncestors(memberId);
  }
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
  const opVal = highlight ? '1.0' : '0.75';
  const widthVal = highlight ? '5.5px' : '3.5px';
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
        marriageLine.style.opacity = highlight ? '1.0' : '0.85';
        marriageLine.style.strokeWidth = highlight ? '5px' : '3.2px';
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

function toggleTreeOrientation() {
  window.treeOrientation = window.treeOrientation === 'vertical' ? 'horizontal' : 'vertical';
  localStorage.setItem('yoyovayo_tree_orientation', window.treeOrientation);
  
  // Update button icon dynamically
  const btn = document.getElementById('tree-orientation-btn');
  if (btn) {
    if (window.treeOrientation === 'vertical') {
      btn.innerHTML = '<i data-lucide="git-branch"></i>';
      btn.setAttribute('title', 'Switch to Top-down view');
    } else {
      btn.innerHTML = '<i data-lucide="git-commit"></i>';
      btn.setAttribute('title', 'Switch to Sideways view');
    }
    safeCreateIcons();
  }
  
  renderFamilyTree();
}
window.toggleTreeOrientation = toggleTreeOrientation;
