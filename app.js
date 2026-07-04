// =================================================================
// LEGACYTREE CENTRAL ENGINE, DATA STORE & SESSION CONTROLLER
// =================================================================

// --- GLOBAL APPLICATION STATE ---
let familyData = [];
let currentSession = null; // { memberId: string, name: string, role: string }
let currentTab = 'tree';
let activeProfileMemberId = null;
// Simulated OTP variables removed for local-only instant logins.
window.treeFocusDropdownNeedsRebuild = true;
window.pendingImportedMembers = [];
window.singleAdminToMerge = null;
window.isPhoneManuallyEdited = false;

// --- CONFIGURATION ---
const STORAGE_KEY = 'yoyovayo_family_data';
const SESSION_KEY = 'yoyovayo_user_session';

// --- ICON RESILIENCY WRAPPER ---
function safeCreateIcons() {
  try {
    if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  } catch (err) {
    console.warn('Lucide icons could not be initialized:', err);
  }
}
window.safeCreateIcons = safeCreateIcons;

function formatInternationalPhone(val) {
  if (!val) return '';
  val = val.trim();
  if (val.startsWith('+') || val.startsWith('00')) {
    return val;
  }
  return '+' + val;
}
window.formatInternationalPhone = formatInternationalPhone;


// --- ON APPLICATION LOAD ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. Load Data & Session
  loadDataFromStorage();
  loadAlbumsFromStorage();
  loadSessionFromStorage();
  initTheme();

  // Load and apply display preferences
  if (typeof initMobileSidebarGestures === 'function') {
    initMobileSidebarGestures();
  }

  const savedThemePreference = localStorage.getItem('yoyovayo_theme_preference') || 'auto';
  const settingsThemeSelect = document.getElementById('settings-theme-select');
  if (settingsThemeSelect) {
    settingsThemeSelect.value = savedThemePreference;
  }

  const savedFontScale = localStorage.getItem('yoyovayo_font_scale') || '1.0';
  const settingsFontSizeSlider = document.getElementById('settings-font-size-slider');
  if (settingsFontSizeSlider) {
    settingsFontSizeSlider.value = savedFontScale;
  }
  if (typeof applyFontSizeScale === 'function') {
    applyFontSizeScale(parseFloat(savedFontScale));
  }
  if (typeof updateFontSizeLabel === 'function') {
    updateFontSizeLabel(parseFloat(savedFontScale));
  }

  // 2. Initialize UI & Routing
  initializeTabs();
  updateAuthHeader();
  safeCreateIcons();

  // Programmatic event binding for modal close buttons as a robust fallback
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const parentModal = btn.closest('.modal');
      if (parentModal) {
        parentModal.classList.add('hidden');
      }
    });
  });

  // 2.5. Set up dynamic Phone auto-population from WhatsApp input
  const formPhone = document.getElementById('form-phone');
  const formCallPhone = document.getElementById('form-call-phone');
  if (formPhone && formCallPhone) {
    formPhone.addEventListener('input', () => {
      if (!window.isPhoneManuallyEdited) {
        formCallPhone.value = formatInternationalPhone(formPhone.value);
      }
    });

    formCallPhone.addEventListener('input', () => {
      if (formCallPhone.value.trim() === '') {
        window.isPhoneManuallyEdited = false;
      } else {
        window.isPhoneManuallyEdited = true;
      }
    });
  }

  // 3. Trigger initial view render
  renderActiveTab();

  // 3.5. Initialize PWA Install Button Click Handler
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) {
    if (isStandalone) {
      installBtn.style.display = 'none';
    } else if (isIOS) {
      // On iOS, display the install button immediately since beforeinstallprompt is not supported
      installBtn.style.display = 'flex';
    }

    installBtn.addEventListener('click', async () => {
      if (isIOS) {
        showIosInstallModal();
        return;
      }

      if (!window.deferredPrompt) return;
      window.deferredPrompt.prompt();
      const { outcome } = await window.deferredPrompt.userChoice;
      console.log(`User response to the PWA install prompt: ${outcome}`);
      window.deferredPrompt = null;
      installBtn.style.display = 'none';
    });
  }

  // 4. Onboarding check - If database is empty, prompt or automatically log in as Creator (Super Admin)
  if (familyData.length === 0) {
    showEmptyDatabaseWelcome();
  } else {
    // Always trigger the Celebrations Flash Page first on startup when database is populated!
    openCelebrationPortalForce(0);
  }
});

// =================================================================
// DATA PERSISTENCE & SCHEMAS
// =================================================================

function loadDataFromStorage() {
  // Migrate old legacytree data if present
  if (localStorage.getItem('legacytree_family_data') && !localStorage.getItem(STORAGE_KEY)) {
    localStorage.setItem(STORAGE_KEY, localStorage.getItem('legacytree_family_data'));
  }
  if (sessionStorage.getItem('legacytree_user_session') && !sessionStorage.getItem(SESSION_KEY)) {
    sessionStorage.setItem(SESSION_KEY, sessionStorage.getItem('legacytree_user_session'));
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      familyData = JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing family data from storage', e);
      familyData = [];
    }
  } else {
    familyData = [];
  }
}

function saveDataToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(familyData));
}

function loadSessionFromStorage() {
  // Legacy session loader neutralized.
}

function saveSessionToStorage() {
  // Legacy session saver neutralized.
}

// =================================================================
// SECURITY, ROLES, & TRAVERSALS (RBAC + DESCENDANTS)
// =================================================================

/**
 * Traverses downward recursively from a family member to collect all direct descendants (children, grandchildren, etc.).
 * @param {string} memberId 
 * @returns {Set<string>} Set of direct descendant member IDs
 */
function getDescendantIds(memberId) {
  const descendants = new Set();
  const queue = [memberId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    // Find children where this member is father or mother
    const children = familyData.filter(m => m.fatherId === currentId || m.motherId === currentId);
    children.forEach(child => {
      if (!descendants.has(child.id)) {
        descendants.add(child.id);
        queue.push(child.id); // Add child to queue to find grandchildren
      }
    });
  }
  return descendants;
}

/**
 * Permission Resolver: Evaluates if the current application mode is Edit Mode.
 * @param {string} targetMemberId 
 * @returns {boolean}
 */
function canEdit(targetMemberId) {
  if (window.isEditMode === undefined) {
    window.isEditMode = localStorage.getItem('yoyovayo_edit_mode') !== 'false';
  }
  return !!window.isEditMode;
}

/**
 * Returns helper context description about why a member can or cannot edit.
 */
function getPermissionMessage(targetMemberId) {
  if (!window.isEditMode) {
    return '🔒 Application Locked';
  }
  return '✍️ Edit Mode Unlocked';
}

// =================================================================
// APPLICATION MODE & VIEW LOCKING CONTROL
// =================================================================

window.isEditMode = localStorage.getItem('yoyovayo_edit_mode') !== 'false';

function updateEditModeUI() {
  const badge = document.getElementById('edit-mode-badge');
  const avatar = document.getElementById('edit-mode-avatar');
  const nameEl = document.getElementById('edit-mode-status-text');
  const roleEl = document.getElementById('edit-mode-sub-text');
  const bulkCard = document.getElementById('admin-bulk-import-card');
  const addMemberBtn = document.getElementById('add-member-btn');
  
  // Toggles for the Settings Application Security Card
  const modeIcon = document.getElementById('settings-mode-icon');
  const modeTitle = document.getElementById('settings-mode-title');
  const modeDesc = document.getElementById('settings-mode-desc');
  const toggleBtn = document.getElementById('toggle-mode-btn');

  // Header circular glassmorphic toggle button
  const lockBtn = document.getElementById('edit-mode-lock-btn');
  const lockIcon = document.getElementById('lock-icon');

  if (window.isEditMode === undefined) {
    window.isEditMode = localStorage.getItem('yoyovayo_edit_mode') !== 'false';
  }

  if (window.isEditMode) {
    // Edit mode state
    if (badge) {
      badge.className = 'session-badge edit-mode';
    }
    if (avatar) avatar.innerText = '✍️';
    if (nameEl) nameEl.innerText = 'Edit Mode';
    if (roleEl) roleEl.innerText = 'Unlocked';

    if (modeIcon) modeIcon.innerText = '✍️';
    if (modeTitle) modeTitle.innerText = 'Edit Mode (Unlocked)';
    if (modeDesc) modeDesc.innerText = 'You have full administrator privileges to modify the family tree.';
    if (toggleBtn) {
      toggleBtn.innerText = 'Switch to View Mode';
      toggleBtn.className = 'btn btn-primary btn-glow';
    }

    if (lockBtn) {
      lockBtn.className = 'lock-toggle-btn unlocked';
      lockBtn.setAttribute('title', 'Switch to View Mode');
    }
    if (lockIcon) {
      lockIcon.setAttribute('data-lucide', 'lock-open');
    }

    // Show edit options
    document.querySelectorAll('.hidden-guest').forEach(el => el.classList.remove('hidden'));
    if (bulkCard) bulkCard.classList.remove('hidden');
    if (addMemberBtn) addMemberBtn.classList.remove('hidden');
  } else {
    // View mode state
    if (badge) {
      badge.className = 'session-badge view-mode';
    }
    if (avatar) avatar.innerText = '🔒';
    if (nameEl) nameEl.innerText = 'View Mode';
    if (roleEl) roleEl.innerText = 'Locked';

    if (modeIcon) modeIcon.innerText = '🔒';
    if (modeTitle) modeTitle.innerText = 'View Mode (Locked)';
    if (modeDesc) modeDesc.innerText = 'The application is currently locked. All modifications are hidden to prevent accidental edits.';
    if (toggleBtn) {
      toggleBtn.innerText = 'Switch to Edit Mode';
      toggleBtn.className = 'btn btn-success btn-glow';
    }

    if (lockBtn) {
      lockBtn.className = 'lock-toggle-btn locked';
      lockBtn.setAttribute('title', 'Switch to Edit Mode');
    }
    if (lockIcon) {
      lockIcon.setAttribute('data-lucide', 'lock');
    }

    // Hide edit options
    document.querySelectorAll('.hidden-guest').forEach(el => el.classList.add('hidden'));
    if (bulkCard) bulkCard.classList.add('hidden');
    if (addMemberBtn) addMemberBtn.classList.add('hidden');
  }
  
  syncSessionBadgeVisibility();
  safeCreateIcons();
}

function toggleEditModeGlobal() {
  window.isEditMode = !window.isEditMode;
  localStorage.setItem('yoyovayo_edit_mode', window.isEditMode ? 'true' : 'false');
  updateEditModeUI();
  
  if (window.isEditMode) {
    showGenericAlert('Application switched to Edit Mode. Modifications are unlocked.', 'success');
  } else {
    showGenericAlert('Application locked in View Mode. Modifications are hidden.', 'info');
  }
}

function updateAuthHeader() {
  updateEditModeUI();
}

function syncSessionBadgeVisibility() {
  const sessionBadge = document.getElementById('edit-mode-badge');
  if (sessionBadge) {
    if (currentTab === 'settings' || currentTab === 'tree') {
      sessionBadge.classList.remove('hidden');
    } else {
      sessionBadge.classList.add('hidden');
    }
  }
}

window.toggleEditModeGlobal = toggleEditModeGlobal;
window.updateEditModeUI = updateEditModeUI;

// =================================================================
// CORE DATA MANIPULATION & RELATIONSHIP BINDING (CRUD)
// =================================================================

function openAddMemberModal(relationType = null, relationSourceId = null) {
  document.getElementById('member-modal-title').innerText = relationType ? `Add Linked Family Member` : 'Add Family Member';
  document.getElementById('member-modal-subtitle').innerText = relationType 
    ? `Adding a ${relationType.toUpperCase()} relative to your active family node.` 
    : 'Establish a new family member in the root grid.';

  document.getElementById('member-form').reset();
  window.isPhoneManuallyEdited = false;
  document.getElementById('form-member-id').value = '';
  document.getElementById('form-relation-type').value = relationType || '';
  document.getElementById('form-relation-source-id').value = relationSourceId || '';
  
  // Set default deceased checkbox state to false
  document.getElementById('form-is-deceased').checked = false;
  toggleDeceasedFields(false);

  // Populate Relation dropdowns with list of everyone in tree
  populateRelationDropdowns();

  // Security settings section removed.

  // If adding linked member, prepopulate parents or spouses to avoid errors
  if (relationType && relationSourceId) {
    const sourceMember = familyData.find(m => m.id === relationSourceId);
    if (sourceMember) {
      if (relationType === 'child') {
        // Child means source member is a parent
        if (sourceMember.gender === 'Female') {
          document.getElementById('form-mother-id').value = sourceMember.id;
          if (sourceMember.spouseId) document.getElementById('form-father-id').value = sourceMember.spouseId;
        } else {
          document.getElementById('form-father-id').value = sourceMember.id;
          if (sourceMember.spouseId) document.getElementById('form-mother-id').value = sourceMember.spouseId;
        }
      } else if (relationType === 'spouse') {
        document.getElementById('form-spouse-id').value = sourceMember.id;
      } else if (relationType === 'father') {
        document.getElementById('form-gender').value = 'Male';
        if (sourceMember.motherId) {
          document.getElementById('form-spouse-id').value = sourceMember.motherId;
        }
      } else if (relationType === 'mother') {
        document.getElementById('form-gender').value = 'Female';
        if (sourceMember.fatherId) {
          document.getElementById('form-spouse-id').value = sourceMember.fatherId;
        }
      } else if (relationType === 'parent') {
        // Adding a parent to sourceMember
        // Handled by adding parent first then linking in code
      }
    }
  }

  document.getElementById('member-modal').classList.remove('hidden');
}

function openEditMemberModal(memberId) {
  const member = familyData.find(m => m.id === memberId);
  if (!member) return;

  // Enforce role edit authorization
  if (!canEdit(memberId)) {
    showGenericAlert(getPermissionMessage(memberId), 'danger');
    return;
  }

  document.getElementById('member-modal-title').innerText = `Edit Profile: ${member.firstName}`;
  document.getElementById('member-modal-subtitle').innerText = getPermissionMessage(memberId);
  
  document.getElementById('form-member-id').value = member.id;
  document.getElementById('form-relation-type').value = '';
  document.getElementById('form-relation-source-id').value = '';

  document.getElementById('form-first-name').value = member.firstName;
  document.getElementById('form-last-name').value = member.lastName;
  document.getElementById('form-nickname').value = member.nickname || '';
  document.getElementById('form-gender').value = member.gender || 'Male';
  
  document.getElementById('form-is-deceased').checked = member.isDeceased;
  toggleDeceasedFields(member.isDeceased);
  
  document.getElementById('form-birth-date').value = member.birthDate || '';
  document.getElementById('form-death-date').value = member.deathDate || '';
  document.getElementById('form-phone').value = member.phone || '';
  document.getElementById('form-call-phone').value = member.callPhone || '';
  document.getElementById('form-email').value = member.email || '';
  
  if (member.callPhone && member.callPhone !== formatInternationalPhone(member.phone || '')) {
    window.isPhoneManuallyEdited = true;
  } else {
    window.isPhoneManuallyEdited = false;
  }
  document.getElementById('form-notes').value = member.notes || '';
  document.getElementById('form-avatar-url').value = member.avatarUrl || '';
  document.getElementById('form-instagram-id').value = member.instagramId || '';
  document.getElementById('form-hide-age').checked = !!member.hideAge;
  document.getElementById('form-hide-contacts').checked = !!member.hideContactDetails;

  populateRelationDropdowns(member.id);

  document.getElementById('form-father-id').value = member.fatherId || '';
  document.getElementById('form-mother-id').value = member.motherId || '';
  document.getElementById('form-spouse-id').value = member.spouseId || '';
  document.getElementById('form-marriage-date').value = member.marriageDate || '';

  // Security settings section removed.

  // Close info drawer and show edit modal
  closeInfoDrawer();
  document.getElementById('member-modal').classList.remove('hidden');
}

function closeMemberModal() {
  document.getElementById('member-modal').classList.add('hidden');
}

function toggleDeceasedFields(isDeceased) {
  const deathGroup = document.getElementById('death-date-group');
  const contactSec = document.getElementById('form-section-contact');
  
  if (isDeceased) {
    deathGroup.classList.remove('hidden');
    contactSec.classList.add('hidden'); // Deceased members don't have phone/emails
  } else {
    deathGroup.classList.add('hidden');
    contactSec.classList.remove('hidden');
    document.getElementById('form-death-date').value = '';
  }
}

function populateRelationDropdowns(excludeId = null) {
  const fatherSelect = document.getElementById('form-father-id');
  const motherSelect = document.getElementById('form-mother-id');
  const spouseSelect = document.getElementById('form-spouse-id');

  // Clear original except first
  fatherSelect.innerHTML = '<option value="">None (Root Branch)</option>';
  motherSelect.innerHTML = '<option value="">None (Root Branch)</option>';
  spouseSelect.innerHTML = '<option value="">None</option>';

  familyData.forEach(m => {
    if (excludeId && m.id === excludeId) return; // Cannot link to themselves!

    const optionText = `${m.firstName} ${m.lastName} (${m.nickname ? m.nickname : getYear(m.birthDate)})`;
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.innerText = optionText;

    if (m.gender === 'Female') {
      motherSelect.appendChild(opt.cloneNode(true));
    } else {
      fatherSelect.appendChild(opt.cloneNode(true));
    }

    spouseSelect.appendChild(opt.cloneNode(true));
  });
}

function handleMemberFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('form-member-id').value;
  const relationType = document.getElementById('form-relation-type').value;
  const relationSourceId = document.getElementById('form-relation-source-id').value;

  const isDeceased = document.getElementById('form-is-deceased').checked;

  const callPhoneValForCheck = isDeceased ? '' : document.getElementById('form-call-phone').value.trim();
  if (callPhoneValForCheck && !callPhoneValForCheck.startsWith('+') && !callPhoneValForCheck.startsWith('00')) {
    showGenericAlert('Aborted: Calling Phone Number must strictly start with "+" or "00".', 'danger');
    document.getElementById('form-call-phone').focus();
    return;
  }

  const memberObj = {
    id: id || 'member_' + Date.now() + Math.random().toString(36).substr(2, 5),
    firstName: document.getElementById('form-first-name').value.trim(),
    lastName: document.getElementById('form-last-name').value.trim(),
    nickname: document.getElementById('form-nickname').value.trim(),
    gender: document.getElementById('form-gender').value,
    isDeceased: isDeceased,
    birthDate: document.getElementById('form-birth-date').value,
    deathDate: isDeceased ? document.getElementById('form-death-date').value : '',
    phone: isDeceased ? '' : document.getElementById('form-phone').value.trim(),
    callPhone: isDeceased ? '' : document.getElementById('form-call-phone').value.trim(),
    email: isDeceased ? '' : document.getElementById('form-email').value.trim(),
    notes: document.getElementById('form-notes').value.trim(),
    avatarUrl: document.getElementById('form-avatar-url').value.trim(),
    instagramId: document.getElementById('form-instagram-id').value.trim(),
    hideAge: document.getElementById('form-hide-age').checked,
    hideContactDetails: document.getElementById('form-hide-contacts').checked,
    fatherId: document.getElementById('form-father-id').value || null,
    motherId: document.getElementById('form-mother-id').value || null,
    spouseId: document.getElementById('form-spouse-id').value || null,
    marriageDate: document.getElementById('form-marriage-date').value || null,
    systemRole: 'super_admin'
  };

  if (id) {
    // UPDATE MODE
    const idx = familyData.findIndex(m => m.id === id);
    if (idx !== -1) {
      familyData[idx] = memberObj;
    }
  } else {
    // ADD NEW MEMBER MODE
    familyData.push(memberObj);

    // If added via a relative-builder relationType link, reciprocate relations
    if (relationType && relationSourceId) {
      const source = familyData.find(m => m.id === relationSourceId);
      if (source) {
        if (relationType === 'spouse') {
          source.spouseId = memberObj.id;
          if (memberObj.marriageDate) source.marriageDate = memberObj.marriageDate;
        } else if (relationType === 'father') {
          source.fatherId = memberObj.id;
        } else if (relationType === 'mother') {
          source.motherId = memberObj.id;
        } else if (relationType === 'child') {
          // Relates automatically because child records hold fatherId/motherId
        }
      }
    }
  }

  // Reciprocate marriages for consistency
  reciprocateSpouseLinks();

  // If first user, automatically log them in as Super Admin!
  if (!currentSession && familyData.length === 1) {
    currentSession = {
      memberId: memberObj.id,
      name: `${memberObj.firstName} ${memberObj.lastName}`,
      role: 'super_admin',
      gender: memberObj.gender
    };
    saveSessionToStorage();
    updateAuthHeader();
  }

  saveDataToStorage();
  window.treeFocusDropdownNeedsRebuild = true;
  closeMemberModal();

  if (typeof expandAncestors === 'function') {
    expandAncestors(memberObj.id);
  }

  renderActiveTab();
  showGenericAlert(`Successfully saved ${memberObj.firstName}!`, 'success');
}

function reciprocateSpouseLinks() {
  familyData.forEach(m => {
    if (m.spouseId) {
      const spouse = familyData.find(s => s.id === m.spouseId);
      if (spouse) {
        spouse.spouseId = m.id;
        if (m.marriageDate) spouse.marriageDate = m.marriageDate;
        else if (spouse.marriageDate) m.marriageDate = spouse.marriageDate;
      }
    }
  });
}

function deleteFamilyMember(memberId) {
  if (!canEdit(memberId)) {
    showGenericAlert(getPermissionMessage(memberId), 'danger');
    return;
  }

  const member = familyData.find(m => m.id === memberId);
  if (!member) return;

  if (confirm(`Are you absolutely sure you want to delete ${member.firstName} ${member.lastName}? This will break relationships referencing them.`)) {
    
    // Remove session if they deleted themselves
    if (currentSession && currentSession.memberId === memberId) {
      currentSession = null;
      saveSessionToStorage();
      updateAuthHeader();
    }

    // Clean up links from others referencing this member
    familyData.forEach(m => {
      if (m.spouseId === memberId) m.spouseId = null;
      if (m.fatherId === memberId) m.fatherId = null;
      if (m.motherId === memberId) m.motherId = null;
    });

    familyData = familyData.filter(m => m.id !== memberId);
    saveDataToStorage();
    window.treeFocusDropdownNeedsRebuild = true;
    closeInfoDrawer();
    renderActiveTab();
    showGenericAlert('Member removed from family tree.', 'success');
  }
}

// =================================================================
// EVENT MATRIX & CALENDAR CALCULATORS
// =================================================================

/**
 * Calculates countdown details for birthdays/anniversaries.
 * Returns { daysRemaining: number, targetAgeOrAnniv: number, eventDateThisYear: Date }
 */
function getEventCountdown(dateString, isAnniversary = false, baseBirthDateString = null) {
  if (!dateString) return null;

  const eventDate = new Date(dateString);
  if (isNaN(eventDate.getTime())) return null;

  const today = new Date();
  today.setHours(0,0,0,0);
  
  const birthYear = eventDate.getFullYear();

  const currentYear = today.getFullYear();
  const eventThisYear = new Date(currentYear, eventDate.getMonth(), eventDate.getDate());

  if (eventThisYear < today) {
    // Event passed this year, wrap to next year
    eventThisYear.setFullYear(currentYear + 1);
  }

  const diffTime = Math.abs(eventThisYear - today);
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) % 365;

  let targetAgeOrAnniv = 0;
  if (birthYear && birthYear > 1000) {
    targetAgeOrAnniv = eventThisYear.getFullYear() - birthYear;
  }

  return {
    daysRemaining: daysRemaining,
    targetAgeOrAnniv: targetAgeOrAnniv,
    eventDateThisYear: eventThisYear
  };
}

/**
 * Sorts all birthdays and anniversaries chronologically starting from today.
 */
function calculateUpcomingEvents() {
  const events = [];

  familyData.forEach(m => {
    // 1. Birthdays (Only for living members)
    if (m.birthDate && !m.isDeceased) {
      const info = getEventCountdown(m.birthDate);
      if (info) {
        events.push({
          memberId: m.id,
          member: m,
          type: 'birthday',
          emoji: '🎂',
          title: 'Birthday',
          daysRemaining: info.daysRemaining,
          milestone: info.targetAgeOrAnniv,
          originalDate: m.birthDate,
          sortDate: info.eventDateThisYear
        });
      }
    }

    // 2. Memorial Remembrance (For deceased members)
    if (m.birthDate && m.isDeceased) {
      const info = getEventCountdown(m.birthDate);
      if (info) {
        events.push({
          memberId: m.id,
          member: m,
          type: 'death',
          emoji: '🕊️',
          title: 'Remembrance Birthday',
          daysRemaining: info.daysRemaining,
          milestone: info.targetAgeOrAnniv,
          originalDate: m.birthDate,
          sortDate: info.eventDateThisYear
        });
      }
    }

    // 3. Wedding Anniversaries (Only process once per married couple - check spouseId)
    if (m.marriageDate && m.spouseId && m.id < m.spouseId) {
      const spouse = familyData.find(s => s.id === m.spouseId);
      const info = getEventCountdown(m.marriageDate);
      if (info && spouse) {
        events.push({
          memberId: m.id,
          spouseId: m.spouseId,
          member: m,
          spouse: spouse,
          type: 'marriage',
          emoji: '💑',
          title: 'Wedding Anniversary',
          daysRemaining: info.daysRemaining,
          milestone: info.targetAgeOrAnniv,
          originalDate: m.marriageDate,
          sortDate: info.eventDateThisYear
        });
      }
    }
  });

  // Sort: closest events first
  events.sort((a, b) => a.daysRemaining - b.daysRemaining);
  return events;
}

// =================================================================
// WHATSAPP GREETINGS ORCHESTRATOR
// =================================================================

let activeGreetingRecipient = null;
let activeGreetingContext = null; // { type: 'birthday'|'anniversary'|'general' }

function openGreetingPortal(memberId, eventType = 'general') {
  const member = familyData.find(m => m.id === memberId);
  if (!member || !member.phone) {
    showGenericAlert('Cannot compose: No valid WhatsApp phone number found for this member.', 'warning');
    return;
  }

  activeGreetingRecipient = member;
  activeGreetingContext = { type: eventType };

  document.getElementById('greeting-modal').classList.remove('hidden');
  document.getElementById('greet-avatar').innerText = getGenderAvatarEmoji(member.gender, member.isDeceased);
  document.getElementById('greet-name').innerText = `${member.firstName} ${member.lastName}`;
  
  let detailsText = 'Catching up with family';
  if (eventType === 'birthday') detailsText = '🎂 Celebrating Birthday!';
  else if (eventType === 'marriage') detailsText = '💑 Celebrating Wedding Anniversary!';
  document.getElementById('greet-details').innerText = detailsText;

  renderGreetingTemplates();
}

function closeGreetingModal() {
  document.getElementById('greeting-modal').classList.add('hidden');
}

function renderGreetingTemplates() {
  const container = document.getElementById('greeting-templates-list');
  container.innerHTML = '';

  const m = activeGreetingRecipient;
  const spouse = m.spouseId ? familyData.find(s => s.id === m.spouseId) : null;
  const sName = spouse ? spouse.firstName : 'Spouse';

  let templates = [];

  if (activeGreetingContext.type === 'birthday') {
    templates = [
      {
        name: '🎉 Classic Birthday',
        text: `Happy Birthday ${m.firstName}! Wishing you a fantastic day filled with joy, laughter, and great memories. Have a blast! 🎉🎂`
      },
      {
        name: '❤️ Heartfelt',
        text: `Dearest ${m.firstName}, on your special day, I want to let you know how much you mean to our family. Wishing you a year of good health, happiness, and endless success. Happy Birthday! ❤️`
      },
      {
        name: '🎈 Short & Sweet',
        text: `Wishing you a very Happy Birthday, ${m.firstName}! Hope you have a wonderful day! 🎈✨`
      }
    ];
  } else if (activeGreetingContext.type === 'marriage') {
    templates = [
      {
        name: '🥂 Anniversary Cheers',
        text: `Happy Wedding Anniversary, ${m.firstName} & ${sName}! Wishing you both a lifetime of love, laughter, and happiness together. Cheers to many more beautiful years! 🥂💖`
      },
      {
        name: '💕 Warm Hearts',
        text: `Happy Anniversary! Sending you both lots of love and best wishes on your special day. Have a beautiful, blessed celebration! 💕`
      }
    ];
  } else {
    templates = [
      {
        name: '🤗 General Greeting',
        text: `Hey ${m.firstName}, just checking in and sending you some love from the family tree app! Hope everything is going great with you. Let's catch up soon! 🥰`
      },
      {
        name: '🌳 Family Love',
        text: `Hey ${m.firstName}, was just looking at our family tree and thinking of you! Sending you warmest wishes! Hope to see you soon. Remote hug! 🤗`
      }
    ];
  }

  templates.forEach((t, i) => {
    const pill = document.createElement('div');
    pill.className = `template-pill ${i === 0 ? 'active' : ''}`;
    pill.innerText = t.name;
    pill.onclick = () => {
      document.querySelectorAll('.template-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      document.getElementById('greeting-message-body').value = t.text;
    };
    container.appendChild(pill);
  });

  // Prepopulate with first template
  document.getElementById('greeting-message-body').value = templates[0].text;
}

function copyGreetingToClipboard() {
  const text = document.getElementById('greeting-message-body').value;
  navigator.clipboard.writeText(text).then(() => {
    showGenericAlert('Message copied to clipboard!', 'success');
  }).catch(() => {
    showGenericAlert('Failed to copy to clipboard.', 'danger');
  });
}

function launchWhatsAppGreeting() {
  const text = document.getElementById('greeting-message-body').value;
  // strip all non-numeric characters (including '+')
  let phone = activeGreetingRecipient.phone.replace(/[^0-9]/g, '');
  if (phone.startsWith('00')) {
    phone = phone.substring(2);
  }

  const encoded = encodeURIComponent(text);
  const waUrl = `https://wa.me/${phone}?text=${encoded}`;
  
  window.open(waUrl, '_blank');
  closeGreetingModal();
}

// =================================================================
// TAB MANAGEMENT & VIEW ROUTER
// =================================================================

function initializeTabs() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    // Hide mobile menu sidebar on tab clicks if on mobile
    btn.addEventListener('click', () => {
      if (window.innerWidth <= 768 && typeof hideMobileSidebar === 'function') {
        hideMobileSidebar();
      }
    });

    if (!btn.hasAttribute('data-tab')) return;
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTab = btn.getAttribute('data-tab');
      renderActiveTab();
    };
  });
}

function renderActiveTab() {
  // Hide all panes
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  // Show active pane
  document.getElementById(`tab-${currentTab}`).classList.add('active');

  // Trigger internal tab render hooks
  if (currentTab === 'tree') {
    renderFamilyTree();
  } else if (currentTab === 'events') {
    renderEventsTimeline();
  } else if (currentTab === 'gallery') {
    renderSharedAlbums();
  } else if (currentTab === 'profile') {
    renderFullUserProfilePage();
  }
  syncSessionBadgeVisibility();
}

// --- RENDERING EVENT CALENDAR TAB ---
function renderEventsTimeline() {
  const upcoming = calculateUpcomingEvents();
  const timelineContainer = document.getElementById('events-timeline-list');
  const heroContainer = document.getElementById('next-milestone-hero');

  timelineContainer.innerHTML = '';
  heroContainer.innerHTML = '';

  if (upcoming.length === 0) {
    timelineContainer.innerHTML = `<div class="p-24 text-center glass border-radius-16">
      <h3>No events found</h3>
      <p class="color-dim">Add dates of birth and marriage to your family members to populate your calendar!</p>
    </div>`;
    return;
  }

  // 1. Render HERO card for the VERY next event
  const heroEvent = upcoming[0];
  const targetName = heroEvent.type === 'marriage' 
    ? `${heroEvent.member.firstName} & ${heroEvent.spouse.firstName}` 
    : `${heroEvent.member.firstName} ${heroEvent.member.lastName}`;
  
  let countdownLabel = `${heroEvent.daysRemaining} days remaining`;
  if (heroEvent.daysRemaining === 0) countdownLabel = `🎉 CELEBRATING TODAY! 🎉`;
  else if (heroEvent.daysRemaining === 1) countdownLabel = `⏰ TOMORROW!`;

  const hideAgeVal = shouldHideAge(heroEvent.memberId);
  const hideContactsVal = shouldHideContacts(heroEvent.memberId);

  let heroDesc = '';
  if (heroEvent.type === 'birthday') {
    heroDesc = hideAgeVal ? `Celebrating Birthday!` : `Turning ${heroEvent.milestone} years old`;
  } else if (heroEvent.type === 'marriage') {
    const spouseId = heroEvent.spouseId || heroEvent.member.spouseId;
    const hideSpouseAge = spouseId ? shouldHideAge(spouseId) : false;
    heroDesc = (hideAgeVal || hideSpouseAge) ? `Celebrating Wedding Anniversary!` : `Celebrating ${heroEvent.milestone} years of marriage`;
  } else {
    heroDesc = hideAgeVal ? `Remembrance Birth Anniversary` : `Remembrance Birth Anniversary (${heroEvent.milestone}th Year)`;
  }

  const contactButtonHtml = (heroEvent.member.phone && !hideContactsVal) 
    ? `<button class="btn btn-success margin-top-8 btn-glow width-full" onclick="openGreetingPortal('${heroEvent.member.id}', '${heroEvent.type}')">
        <i data-lucide="message-square"></i> Wish on WhatsApp
       </button>`
    : '';

  const heroMediaHtml = heroEvent.type === 'marriage'
    ? `<div class="overlapping-avatars-wrapper hero-overlap">
        <div class="overlap-avatar primary">${getMemberAvatarHtml(heroEvent.member)}</div>
        <div class="overlap-avatar secondary">${getMemberAvatarHtml(heroEvent.spouse)}</div>
       </div>`
    : `<div class="hero-icon">${heroEvent.emoji}</div>`;

  heroContainer.innerHTML = `
    <div class="hero-card" id="hero-card-el" title="Click to view profile">
      ${heroMediaHtml}
      <div class="hero-badge">${heroEvent.title}</div>
      <div class="hero-name">${targetName}</div>
      <div class="hero-countdown">${countdownLabel}</div>
      <div class="font-size-13 opacity-80">${heroDesc}</div>
      <div class="font-size-12 opacity-60">${formatFriendlyDate(heroEvent.originalDate)}</div>
      ${contactButtonHtml}
    </div>
  `;

  const heroCardEl = document.getElementById('hero-card-el');
  if (heroCardEl) {
    heroCardEl.onclick = (e) => {
      if (e.target.closest('button')) return;
      openInfoDrawer(heroEvent.member.id);
    };
  }

  // 2. Render Timeline Cards
  upcoming.forEach(ev => {
    const cardName = ev.type === 'marriage' 
      ? `${ev.member.firstName} & ${ev.spouse.firstName}` 
      : `${ev.member.firstName} ${ev.member.lastName}`;

    const hideAgeVal = shouldHideAge(ev.memberId);
    const spouseId = ev.spouseId || ev.member.spouseId;
    const hideSpouseAge = spouseId ? shouldHideAge(spouseId) : false;
    const hideContactsVal = shouldHideContacts(ev.memberId);

    let subText = '';
    if (ev.type === 'birthday') {
      subText = hideAgeVal ? `🎂 Celebrating Birthday on ${formatMonthDay(ev.originalDate)}` : `🎂 Turning <strong>${ev.milestone}</strong> on ${formatMonthDay(ev.originalDate)}`;
    } else if (ev.type === 'marriage') {
      subText = (hideAgeVal || hideSpouseAge) ? `💖 Celebrating Wedding Anniversary on ${formatMonthDay(ev.originalDate)}` : `💖 Celebrating <strong>${ev.milestone}</strong> years of marriage on ${formatMonthDay(ev.originalDate)}`;
    } else {
      subText = hideAgeVal ? `🕊️ Remembrance: Birth anniversary on ${formatMonthDay(ev.originalDate)}` : `🕊️ Remembrance: <strong>${ev.milestone}th</strong> birth anniversary on ${formatMonthDay(ev.originalDate)}`;
    }

    let daysBadgeClass = 'later';
    let daysBadgeText = `In ${ev.daysRemaining} days`;
    if (ev.daysRemaining === 0) {
      daysBadgeClass = 'today';
      daysBadgeText = 'TODAY 🎉';
    } else if (ev.daysRemaining <= 10) {
      daysBadgeClass = 'soon';
      daysBadgeText = `In ${ev.daysRemaining} days`;
    }

    const item = document.createElement('div');
    item.className = 'timeline-card';
    item.setAttribute('data-event-type', ev.type);
    item.onclick = (e) => {
      if (e.target.closest('button')) return;
      openInfoDrawer(ev.member.id);
    };

    const waActionHtml = (ev.member.phone && !hideContactsVal) 
      ? `<button class="btn btn-secondary cursor-pointer" onclick="openGreetingPortal('${ev.member.id}', '${ev.type}')" title="Send WhatsApp greeting">
          <i data-lucide="message-circle" style="color: var(--green);"></i>
         </button>`
      : '';

    const avatarHtml = ev.type === 'marriage'
      ? `<div class="overlapping-avatars-wrapper timeline-overlap">
          <div class="overlap-avatar primary">${getMemberAvatarHtml(ev.member)}</div>
          <div class="overlap-avatar secondary">${getMemberAvatarHtml(ev.spouse)}</div>
         </div>`
      : `<div class="timeline-avatar">${getMemberAvatarHtml(ev.member)}</div>`;

    item.innerHTML = `
      <div class="timeline-info">
        ${avatarHtml}
        <div>
          <div class="timeline-event-name">${cardName}</div>
          <div class="timeline-desc">${subText}</div>
        </div>
      </div>
      <div class="flex gap-12 align-items-center">
        ${waActionHtml}
        <div class="timeline-date-display">
          <span class="timeline-days-badge ${daysBadgeClass}">${daysBadgeText}</span>
          <span class="timeline-date-text">${formatFriendlyDate(ev.originalDate)}</span>
        </div>
      </div>
    `;
    timelineContainer.appendChild(item);
  });

  // Attach calendar filter action listeners
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const filter = btn.getAttribute('data-filter');
      
      document.querySelectorAll('.timeline-card').forEach(card => {
        if (filter === 'all' || card.getAttribute('data-event-type') === filter) {
          card.classList.remove('hidden');
        } else {
          card.classList.add('hidden');
        }
      });
    };
  });

  safeCreateIcons();
}

// Analytics tab section removed.

// =================================================================
// GLOBAL SEARCH ENGINE
// =================================================================

function handleGlobalSearch(val) {
  const resultsContainer = document.getElementById('search-results');
  resultsContainer.innerHTML = '';

  if (!val.trim()) {
    resultsContainer.classList.add('hidden');
    return;
  }

  const query = val.toLowerCase();
  const matches = familyData.filter(m => 
    m.firstName.toLowerCase().includes(query) || 
    m.lastName.toLowerCase().includes(query) ||
    (m.nickname && m.nickname.toLowerCase().includes(query))
  );

  if (matches.length === 0) {
    resultsContainer.innerHTML = `<div class="p-12 text-center color-dim font-size-12">No members found.</div>`;
    resultsContainer.classList.remove('hidden');
    return;
  }

  resultsContainer.classList.remove('hidden');
  matches.forEach(m => {
    const div = document.createElement('div');
    div.className = 'search-item';
    div.onclick = () => {
      resultsContainer.classList.add('hidden');
      document.getElementById('global-search').value = '';
      
      // Navigate to profile tab directly
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      const profileBtn = document.querySelector('.nav-item[data-tab="profile"]');
      if (profileBtn) profileBtn.classList.add('active');
      
      activeProfileMemberId = m.id;
      currentTab = 'profile';
      renderActiveTab();
    };

    div.innerHTML = `
      <div class="search-avatar">${getGenderAvatarEmoji(m.gender, m.isDeceased)}</div>
      <div>
        <div class="font-weight-600 font-size-13">${m.firstName} ${m.lastName}</div>
        <div class="font-size-11 color-dim">${m.nickname ? `"${m.nickname}" | ` : ''}${getYearRange(m)}</div>
      </div>
    `;
    resultsContainer.appendChild(div);
  });
}

// Dismiss search results dropdown when clicking outside
document.addEventListener('click', (e) => {
  const searchBox = document.querySelector('.header-search');
  const resultsContainer = document.getElementById('search-results');
  if (searchBox && !searchBox.contains(e.target) && resultsContainer) {
    resultsContainer.classList.add('hidden');
  }
});

// =================================================================
// DATA EXPORT, IMPORT, & DEMO DATA DATASETS
// =================================================================

function exportFamilyData() {
  if (familyData.length === 0) {
    showGenericAlert('Aborted: Cannot export an empty database.', 'warning');
    return;
  }
  
  const payload = {
    familyData: familyData,
    sharedAlbums: sharedAlbums
  };
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(payload, null, 2));
  const dlAnchorElem = document.createElement('a');
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", "yoyovayo_backup_" + getFormattedDate() + ".json");
  dlAnchorElem.click();
  showGenericAlert('Backup file exported successfully!', 'success');
}

function exportXlsxFamilyData() {
  if (familyData.length === 0) {
    showGenericAlert('Aborted: Cannot export an empty database.', 'warning');
    return;
  }

  const headers = [
    'ID', 'First Name', 'Last Name', 'Nickname', 'Gender', 'Is Deceased',
    'Birth Date', 'Death Date', 'Phone', 'Calling Phone', 'Email', 'Biography Notes',
    'Avatar URL', 'Instagram ID', 'Hide Age', 'Hide Contact Details',
    'Father ID', 'Mother ID', 'Spouse ID', 'Marriage Date', 'System Role'
  ];

  const rows = [headers];

  familyData.forEach(m => {
    rows.push([
      String(m.id || ''),
      String(m.firstName || ''),
      String(m.lastName || ''),
      String(m.nickname || ''),
      String(m.gender || 'Male'),
      m.isDeceased ? 'TRUE' : 'FALSE',
      formatDateToDdMmmYyyy(m.birthDate),
      formatDateToDdMmmYyyy(m.deathDate),
      m.phone ? String(m.phone) : '',
      m.callPhone ? String(m.callPhone) : '',
      String(m.email || ''),
      String(m.notes || ''),
      String(m.avatarUrl || ''),
      String(m.instagramId || ''),
      m.hideAge ? 'TRUE' : 'FALSE',
      m.hideContactDetails ? 'TRUE' : 'FALSE',
      String(m.fatherId || ''),
      String(m.motherId || ''),
      String(m.spouseId || ''),
      formatDateToDdMmmYyyy(m.marriageDate),
      String(m.systemRole || 'member')
    ]);
  });

  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // Force all non-header cells to explicit text string format ('s') to preserve digit precision in Excel
  for (let key in worksheet) {
    if (key[0] === '!') continue;
    const rowNum = parseInt(key.replace(/[^0-9]/g, ''), 10);
    if (rowNum === 1) continue; // skip header row
    const cell = worksheet[key];
    if (cell && cell.v !== undefined) {
      cell.t = 's';
      cell.v = String(cell.v);
      cell.z = '@';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Family Data");

  XLSX.writeFile(workbook, "yoyovayo_family_export_" + getFormattedDate() + ".xlsx");
  showGenericAlert('Family XLSX file exported successfully!', 'success');
}

function importFamilyData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed)) {
        familyData = parsed;
        sharedAlbums = [];
      } else if (parsed && Array.isArray(parsed.familyData)) {
        familyData = parsed.familyData;
        sharedAlbums = parsed.sharedAlbums || [];
      } else {
        showGenericAlert('Error: Invalid JSON structure.', 'danger');
        return;
      }
      
      saveDataToStorage();
      if (typeof clearCollapsedStates === 'function') {
        clearCollapsedStates();
      }
      window.treeFocusDropdownNeedsRebuild = true;
      saveAlbumsToStorage();
      
      // Log out of active session during fresh import to prevent role issues
      currentSession = null;
      saveSessionToStorage();
      updateAuthHeader();

      renderActiveTab();
      showGenericAlert('Backup imported successfully! Database refreshed.', 'success');
    } catch (err) {
      showGenericAlert('Error: Failed to parse backup file.', 'danger');
    }
  };
  reader.readAsText(file);
}

function clearFamilyData() {
  if (confirm('⚠️ WARNING: This will completely wipe your family database and shared photo albums! Are you absolutely sure?')) {
    familyData = [];
    saveDataToStorage();
    if (typeof clearCollapsedStates === 'function') {
      clearCollapsedStates();
    }
    sharedAlbums = [];
    saveAlbumsToStorage();
    window.treeFocusDropdownNeedsRebuild = true;
    currentSession = null;
    saveSessionToStorage();
    updateAuthHeader();
    
    closeInfoDrawer();
    renderActiveTab();
    showEmptyDatabaseWelcome();
    showGenericAlert('Database and shared photo albums cleared.', 'info');
  }
}

// Demo dataset loader removed.

function showEmptyDatabaseWelcome() {
  const treeContainer = document.getElementById('tree-container');
  if (!treeContainer) return;

  // Remove any existing empty welcome card to prevent duplicates
  const existing = treeContainer.querySelector('.empty-welcome-card');
  if (existing) {
    existing.remove();
  }

  // Create a brand new empty welcome card element
  const welcome = document.createElement('div');
  welcome.className = 'empty-welcome-card glass text-center';
  welcome.innerHTML = `
    <h2>🌳 Welcome to YoyoVayo!</h2>
    <p>Your collaborative family tree database is currently empty.</p>
    <div class="flex flex-wrap gap-12 justify-content-center margin-top-16" style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
      <button class="btn btn-success btn-glow" onclick="openAddMemberModal()" style="width: 250px; justify-content: center;"><i data-lucide="plus-circle"></i> Create First Member (You)</button>
      <button class="btn btn-secondary btn-glow" onclick="document.getElementById('import-file-input').click()" style="width: 250px; justify-content: center;"><i data-lucide="upload"></i> Restore from Backup</button>
      <button class="btn btn-secondary btn-glow" onclick="revealWelcomeWebRestore()" style="width: 250px; justify-content: center;"><i data-lucide="globe"></i> Restore from Web</button>
    </div>
    <div id="welcome-web-restore-container" style="display: none; margin-top: 16px; width: 100%;">
      <div style="display: flex; gap: 8px; width: 100%; justify-content: center;">
        <input type="text" id="welcome-web-restore-url" placeholder="https://example.com/family.json" class="form-control" style="flex: 1; padding: 10px; border-radius: 8px; background: rgba(0,0,0,0.3); border: 1px solid var(--border-color); color: var(--text-primary); font-size: 13px; max-width: 240px;">
        <button class="btn btn-primary" onclick="submitWelcomeWebRestore()" style="padding: 10px 16px;">Restore</button>
      </div>
    </div>
  `;

  // Apply absolute styles to center perfectly in the visible tree viewport
  welcome.style.position = 'absolute';
  welcome.style.left = '50%';
  welcome.style.top = '50%';
  welcome.style.transform = 'translate(-50%, -50%)';
  welcome.style.width = '450px';
  welcome.style.padding = '32px';
  welcome.style.borderRadius = '24px';
  welcome.style.border = '1px dashed var(--accent-color)';
  welcome.style.zIndex = '10';

  treeContainer.appendChild(welcome);

  safeCreateIcons();
}

function revealWelcomeWebRestore() {
  const container = document.getElementById('welcome-web-restore-container');
  if (container) {
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
  }
}

function submitWelcomeWebRestore() {
  const input = document.getElementById('welcome-web-restore-url');
  if (input && input.value) {
    restoreFromWeb(input.value);
  } else {
    showGenericAlert('Please enter a URL.', 'danger');
  }
}

function revealWebRestoreSettings() {
  const container = document.getElementById('web-restore-settings-container');
  if (container) {
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
  }
}

function submitWebRestoreSettings() {
  const input = document.getElementById('web-restore-settings-url');
  if (input && input.value) {
    restoreFromWeb(input.value);
  } else {
    showGenericAlert('Please enter a URL.', 'danger');
  }
}

function restoreFromWeb(url) {
  if (!url) return;
  url = url.trim();
  
  // Extract path to validate extension (strictly accept only .json)
  let pathname = '';
  try {
    pathname = new URL(url).pathname.toLowerCase();
  } catch (e) {
    pathname = url.split('?')[0].split('#')[0].toLowerCase();
  }
  
  if (!pathname.endsWith('.json')) {
    alert("unknown file type");
    return;
  }

  fetch(url)
    .then(response => {
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      return response.json();
    })
    .then(parsed => {
      if (Array.isArray(parsed)) {
        familyData = parsed;
        sharedAlbums = [];
      } else if (parsed && Array.isArray(parsed.familyData)) {
        familyData = parsed.familyData;
        sharedAlbums = parsed.sharedAlbums || [];
      } else {
        showGenericAlert('Error: Invalid JSON structure.', 'danger');
        return;
      }
      
      saveDataToStorage();
      if (typeof clearCollapsedStates === 'function') {
        clearCollapsedStates();
      }
      window.treeFocusDropdownNeedsRebuild = true;
      saveAlbumsToStorage();
      
      // Unlocks edit mode for the fresh restore
      window.isEditMode = true;
      localStorage.setItem('yoyovayo_edit_mode', 'true');
      updateEditModeUI();

      renderActiveTab();
      showGenericAlert('Web backup restored successfully! Database refreshed.', 'success');
    })
    .catch(err => {
      console.error('Failed to fetch from web:', err);
      showGenericAlert('Error: Failed to fetch or parse JSON file from URL.', 'danger');
    });
}

// Export functions to window so inline HTML onclick calls can access them
window.revealWelcomeWebRestore = revealWelcomeWebRestore;
window.submitWelcomeWebRestore = submitWelcomeWebRestore;
window.revealWebRestoreSettings = revealWebRestoreSettings;
window.submitWebRestoreSettings = submitWebRestoreSettings;
window.restoreFromWeb = restoreFromWeb;

// =================================================================
// HELPER METHODS (DATES, STRINGS, GRAPHICS)
// =================================================================

function calculateAge(birthDateString) {
  if (!birthDateString) return null;
  const today = new Date();
  const birth = new Date(birthDateString);
  if (isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function getZodiacSign(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) return 'Aries';
  if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) return 'Taurus';
  if ((month === 5 && day >= 21) || (month === 6 && day <= 21)) return 'Gemini';
  if ((month === 6 && day >= 22) || (month === 7 && day <= 22)) return 'Cancer';
  if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) return 'Leo';
  if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) return 'Virgo';
  if ((month === 9 && day >= 23) || (month === 10 && day <= 23)) return 'Libra';
  if ((month === 10 && day >= 24) || (month === 11 && day <= 21)) return 'Scorpio';
  if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) return 'Sagittarius';
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) return 'Capricorn';
  if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) return 'Aquarius';
  return 'Pisces';
}

function getGenderAvatarEmoji(gender, isDeceased) {
  if (isDeceased) return '🕊️';
  if (gender === 'Female') return '👩';
  if (gender === 'Male') return '👨';
  return '👤';
}

function getMemberAvatarHtml(member, sizeClass = '') {
  const fallbackEmoji = getGenderAvatarEmoji(member.gender, member.isDeceased);
  
  if (member.avatarUrl) {
    return `<img src="${member.avatarUrl}" class="profile-img-el ${sizeClass}" alt="${member.firstName}" onerror="this.outerHTML='<span class=&quot;avatar-emoji-fallback&quot;>${fallbackEmoji}</span>'">`;
  } else if (member.instagramId) {
    return `<img src="https://unavatar.io/instagram/${member.instagramId}" class="profile-img-el ${sizeClass}" alt="${member.firstName}" onerror="this.outerHTML='<span class=&quot;avatar-emoji-fallback&quot;>${fallbackEmoji}</span>'">`;
  } else {
    return `<span class="avatar-emoji-fallback">${fallbackEmoji}</span>`;
  }
}


function getYear(dateString) {
  if (!dateString) return 'Born Unknown';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 'Born Unknown';
  return d.getFullYear();
}

function getYearRange(m) {
  const birth = getYear(m.birthDate);
  if (m.isDeceased) {
    const death = m.deathDate ? new Date(m.deathDate).getFullYear() : 'Deceased';
    const cleanDeath = isNaN(death) ? 'Deceased' : death;
    return `${birth} - ${cleanDeath}`;
  }
  return `${birth} - Present`;
}

function formatFriendlyDate(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return d.toLocaleDateString('en-US', options);
}

function formatMonthDay(dateString) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';
  const options = { month: 'long', day: 'numeric' };
  return d.toLocaleDateString('en-US', options);
}

function getFormattedDate() {
  const d = new Date();
  return d.getFullYear() + "_" + (d.getMonth() + 1).toString().padStart(2, '0') + "_" + d.getDate().toString().padStart(2, '0');
}

// Automatic theme initialization based on local time and preferences
function initTheme() {
  const savedTheme = localStorage.getItem('yoyovayo_theme_preference') || 'auto';
  let themeToApply = 'dark-theme';

  if (savedTheme === 'light') {
    themeToApply = 'light-theme';
  } else if (savedTheme === 'dark') {
    themeToApply = 'dark-theme';
  } else {
    // 'auto' - auto adjust with time of day (Default)
    const hour = new Date().getHours();
    // Night is 18:00 (6 PM) to 06:00 (6 AM)
    if (hour >= 18 || hour < 6) {
      themeToApply = 'dark-theme';
    } else {
      themeToApply = 'light-theme';
    }
  }

  const body = document.body;
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  if (themeToApply === 'light-theme') {
    body.classList.remove('dark-theme');
    body.classList.add('light-theme');
    if (sunIcon) sunIcon.classList.remove('hidden');
    if (moonIcon) moonIcon.classList.add('hidden');
  } else {
    body.classList.remove('light-theme');
    body.classList.add('dark-theme');
    if (sunIcon) sunIcon.classList.add('hidden');
    if (moonIcon) moonIcon.classList.remove('hidden');
  }

  // Update settings theme dropdown if it exists in DOM
  const select = document.getElementById('settings-theme-select');
  if (select) {
    select.value = savedTheme;
  }
}
window.initTheme = initTheme;

function changeThemePreference(val) {
  localStorage.setItem('yoyovayo_theme_preference', val);
  initTheme();
}
window.changeThemePreference = changeThemePreference;

// Global Theme toggle with persistent storage of preference
function toggleTheme() {
  const body = document.body;
  let newTheme = 'dark';

  if (body.classList.contains('dark-theme')) {
    newTheme = 'light';
  } else {
    newTheme = 'dark';
  }

  localStorage.setItem('yoyovayo_theme_preference', newTheme);
  initTheme();
}
window.toggleTheme = toggleTheme;


// Universal Slide Banner Alert trigger
function showGenericAlert(text, type = 'success') {
  // Simple clean fallback banner at bottom
  let alertDiv = document.createElement('div');
  alertDiv.style.position = 'fixed';
  alertDiv.style.bottom = '24px';
  alertDiv.style.right = '24px';
  alertDiv.style.zIndex = '300';
  alertDiv.style.padding = '12px 24px';
  alertDiv.style.borderRadius = '12px';
  alertDiv.style.color = '#ffffff';
  alertDiv.style.fontFamily = 'var(--font-sans)';
  alertDiv.style.fontSize = '13px';
  alertDiv.style.fontWeight = '600';
  alertDiv.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
  alertDiv.style.transform = 'translateY(100px)';
  alertDiv.style.opacity = '0';
  alertDiv.style.transition = 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';

  if (type === 'success') {
    alertDiv.style.backgroundColor = 'var(--green)';
    alertDiv.style.border = '1px solid rgba(255,255,255,0.1)';
  } else if (type === 'danger') {
    alertDiv.style.backgroundColor = '#ef4444';
  } else if (type === 'warning') {
    alertDiv.style.backgroundColor = 'var(--gold)';
    alertDiv.style.color = '#000000';
  } else {
    alertDiv.style.backgroundColor = 'var(--accent-color)';
  }

  alertDiv.innerText = text;
  document.body.appendChild(alertDiv);

  setTimeout(() => {
    alertDiv.style.transform = 'translateY(0)';
    alertDiv.style.opacity = '1';
  }, 100);

  setTimeout(() => {
    alertDiv.style.transform = 'translateY(100px)';
    alertDiv.style.opacity = '0';
    setTimeout(() => alertDiv.remove(), 400);
  }, 4000);
}

function normalizeDateString(str) {
  if (!str) return '';
  str = str.trim();
  if (!str) return '';

  // If already in YYYY-MM-DD format
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(str)) {
    return str.replace(/\//g, '-');
  }

  // Handle dd-mmm-yyyy (e.g. 15-May-1906, 02-dec-1985, etc.)
  const monthsAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const parts = str.split(/[-/ ]/);
  if (parts.length === 3) {
    let p0 = parts[0].trim(); // Day
    let p1 = parts[1].trim().toLowerCase(); // Month index or name
    let p2 = parts[2].trim(); // Year

    let monthNum = -1;
    const monthIdx = monthsAbbr.indexOf(p1.slice(0, 3));
    if (monthIdx !== -1) {
      monthNum = monthIdx + 1;
    } else if (!isNaN(p1)) {
      monthNum = parseInt(p1, 10);
    }

    if (monthNum >= 1 && monthNum <= 12) {
      if (p2.length === 4 && !isNaN(p2)) {
        return `${p2}-${String(monthNum).padStart(2, '0')}-${p0.padStart(2, '0')}`;
      }
      if (p0.length === 4 && !isNaN(p0)) {
        return `${p0}-${String(monthNum).padStart(2, '0')}-${p2.padStart(2, '0')}`;
      }
    } else {
      let p1Num = parseInt(p1, 10);
      if (!isNaN(p1Num)) {
        if (p2.length === 4 && !isNaN(p2)) {
          return `${p2}-${p1.padStart(2, '0')}-${p0.padStart(2, '0')}`;
        }
        if (p0.length === 4 && !isNaN(p0)) {
          return `${p0}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;
        }
      }
    }
  }
  return str;
}

function formatDateToDdMmmYyyy(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    const year = parts[0];
    const monthIndex = parseInt(parts[1], 10) - 1;
    const day = parts[2];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (monthIndex >= 0 && monthIndex < 12 && !isNaN(parseInt(day, 10)) && !isNaN(parseInt(year, 10))) {
      return `${day.padStart(2, '0')}-${months[monthIndex]}-${year}`;
    }
  }
  return dateStr;
}

// =================================================================
// BULK SPREADSHEET IMPORT/EXPORT CONTROLLERS (XLSX PARSING VIA SHEETJS)
// =================================================================

function downloadXlsxTemplate() {
  const headers = [
    'ID', 'First Name', 'Last Name', 'Nickname', 'Gender', 'Is Deceased',
    'Birth Date', 'Death Date', 'Phone', 'Calling Phone', 'Email', 'Biography Notes',
    'Father ID', 'Mother ID', 'Spouse ID', 'Marriage Date', 'System Role'
  ];

  const sampleRows = [
    [
      'grandpa_sam', 'Samuel', 'Smith', 'Sam', 'Male', 'FALSE',
      '15-Jun-1945', '', '919496123778', '+919496123778', 'samuel@smith.com',
      'The root grandfather of our family tree. Enthusiastic gardener, loved woodcarving.',
      '', '', '', '10-Oct-1970', 'super_admin'
    ],
    [
      'grandma_mary', 'Mary', 'Smith', 'Nana', 'Female', 'FALSE',
      '22-Nov-1950', '', '+15559876543', '+15559876543', 'mary@smith.com',
      'Beloved grandmother. Master baker of apple pies and avid reader.',
      '', '', 'grandpa_sam', '10-Oct-1970', 'member'
    ],
    [
      'son_john', 'John', 'Smith', 'Johnny', 'Male', 'FALSE',
      '12-Apr-1975', '', '+15551112222', '+15551112222', 'johnny@smith.com',
      'Enjoys fly fishing and mentoring junior developers.',
      'grandpa_sam', 'grandma_mary', '', '', 'member'
    ]
  ];

  const rows = [headers, ...sampleRows];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // Force all non-header cells to explicit text string format ('s') to preserve digit precision in Excel
  for (let key in worksheet) {
    if (key[0] === '!') continue;
    const rowNum = parseInt(key.replace(/[^0-9]/g, ''), 10);
    if (rowNum === 1) continue; // skip header row
    const cell = worksheet[key];
    if (cell && cell.v !== undefined) {
      cell.t = 's';
      cell.v = String(cell.v);
      cell.z = '@';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Template");

  XLSX.writeFile(workbook, "yoyovayo_bulk_template.xlsx");
  showGenericAlert('XLSX Spreadsheet template downloaded!', 'success');
}

function resolveMemberId(linkValue, allMembers) {
  if (!linkValue) return null;
  const cleanLink = linkValue.trim().toLowerCase();
  if (!cleanLink) return null;

  // If link specifies none or null, clear the field
  if (['none', 'none (root branch)', 'none (root)', 'null', 'undefined', 'blank', 'n/a', 'na'].includes(cleanLink)) {
    return null;
  }

  // 1. Exact ID match (case-sensitive)
  let found = allMembers.find(m => m.id === linkValue.trim());
  if (found) return found.id;

  // 2. Case-insensitive ID match
  found = allMembers.find(m => m.id.toLowerCase() === cleanLink);
  if (found) return found.id;

  // 3. Case-insensitive Full Name match (e.g. "samuel smith")
  found = allMembers.find(m => `${m.firstName} ${m.lastName}`.toLowerCase().trim() === cleanLink);
  if (found) return found.id;

  // 4. Case-insensitive First Name match (e.g. "samuel")
  found = allMembers.find(m => m.firstName.toLowerCase().trim() === cleanLink);
  if (found) return found.id;

  // 5. Case-insensitive Nickname match (e.g. "sam" or "nana")
  found = allMembers.find(m => m.nickname && m.nickname.toLowerCase().trim() === cleanLink);
  if (found) return found.id;

  // If no match found, return the original trimmed link
  return linkValue.trim();
}

function importBulkXlsx(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Convert worksheet to JSON array of objects
      // defval: "" ensures empty columns are kept as empty strings
      // raw: false retrieves pre-formatted text values, keeping phone numbers/IDs as text strings
      const parsedRecords = XLSX.utils.sheet_to_json(worksheet, { defval: "", raw: false });

      if (parsedRecords.length === 0) {
        showGenericAlert('Error: XLSX file contains no data rows or is malformed.', 'danger');
        return;
      }

      // Convert spreadsheet records to familyData schema
      const importedMembers = [];
      let errs = [];

      parsedRecords.forEach((rec, idx) => {
        const rowNum = idx + 2; // Row number in Excel is 1-indexed plus header row
        
        // Clean keys to lowercase with alphanumeric character stripping to support aliases
        const cleanRec = {};
        for (let key in rec) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
          cleanRec[cleanKey] = rec[key];
        }

        // 1. Validation with resilient aliases
        const fName = cleanRec['firstname'] || cleanRec['first'] || cleanRec['fname'] || '';
        const lName = cleanRec['lastname'] || cleanRec['last'] || cleanRec['lname'] || '';
        
        if (!fName || !lName) {
          errs.push(`Row ${rowNum}: First Name and Last Name are required.`);
          return;
        }

        // Resolve clean boolean for isDeceased
        const isDeceasedStr = String(cleanRec['isdeceased'] || cleanRec['deceased'] || cleanRec['passed'] || '').toLowerCase().trim();
        const isDeceased = isDeceasedStr === 'true' || isDeceasedStr === 'yes' || isDeceasedStr === '1';

        // Role resolver
        let role = String(cleanRec['systemrole'] || cleanRec['role'] || 'member').toLowerCase().trim();
        if (!['super_admin', 'admin', 'member'].includes(role)) {
          role = 'member';
        }

        // Gender resolver
        let gender = String(cleanRec['gender'] || cleanRec['sex'] || 'Male').trim();
        gender = gender.charAt(0).toUpperCase() + gender.slice(1).toLowerCase(); // capitalize
        if (!['Male', 'Female', 'Other'].includes(gender)) {
          gender = 'Other';
        }

        // Generate ID if missing
        const id = cleanRec['id'] ? String(cleanRec['id']).trim() : 'member_' + Date.now() + Math.random().toString(36).substr(2, 5);

        const memberObj = {
          id: id,
          firstName: fName.trim(),
          lastName: lName.trim(),
          nickname: String(cleanRec['nickname'] || cleanRec['nick'] || '').trim(),
          gender: gender,
          isDeceased: isDeceased,
          birthDate: normalizeDateString(String(cleanRec['birthdate'] || cleanRec['birth'] || cleanRec['dob'] || '')),
          deathDate: isDeceased ? normalizeDateString(String(cleanRec['deathdate'] || cleanRec['death'] || cleanRec['dod'] || '')) : '',
          phone: isDeceased ? '' : String(cleanRec['phone'] || cleanRec['whatsapp'] || cleanRec['contact'] || '').trim(),
          callPhone: isDeceased ? '' : (() => {
            const rawCall = String(cleanRec['callingphone'] || cleanRec['callphone'] || cleanRec['phonecalling'] || cleanRec['voicecall'] || cleanRec['voicecalling'] || cleanRec['phonecall'] || '').trim();
            if (rawCall) return rawCall;
            const rawPhone = String(cleanRec['phone'] || cleanRec['whatsapp'] || cleanRec['contact'] || '').trim();
            return formatInternationalPhone(rawPhone);
          })(),
          email: isDeceased ? '' : String(cleanRec['email'] || cleanRec['mail'] || '').trim(),
          notes: String(cleanRec['biographynotes'] || cleanRec['notes'] || cleanRec['bio'] || cleanRec['biography'] || cleanRec['story'] || '').trim(),
          avatarUrl: String(cleanRec['avatarurl'] || '').trim(),
          instagramId: String(cleanRec['instagramid'] || '').trim(),
          hideAge: String(cleanRec['hideage'] || '').toLowerCase().trim() === 'true',
          hideContactDetails: String(cleanRec['hidecontactdetails'] || '').toLowerCase().trim() === 'true',
          fatherId: String(cleanRec['fatherid'] || cleanRec['father'] || cleanRec['dad'] || '').trim() || null,
          motherId: String(cleanRec['motherid'] || cleanRec['mother'] || cleanRec['mom'] || '').trim() || null,
          spouseId: String(cleanRec['spouseid'] || cleanRec['spouse'] || cleanRec['partner'] || '').trim() || null,
          marriageDate: normalizeDateString(String(cleanRec['marriagedate'] || cleanRec['marriage'] || cleanRec['anniversary'] || '')) || null,
          systemRole: role
        };

        importedMembers.push(memberObj);
      });

      if (errs.length > 0) {
        alert("Spreadsheet Validation Errors:\n\n" + errs.join("\n") + "\n\nImport cancelled. Please fix your spreadsheet.");
        return;
      }

      // Intercept bulk XLSX import if there is exactly 1 Super Admin in the database
      if (familyData.length === 1 && familyData[0].systemRole === 'super_admin') {
        window.pendingImportedMembers = importedMembers;
        window.singleAdminToMerge = familyData[0];
        openMergeModal();
        return;
      }

      // Merge imported records into familyData (Case-Insensitive ID matching to prevent duplicate cards)
      let addedCount = 0;
      let updatedCount = 0;

      importedMembers.forEach(newMember => {
        const existingIdx = familyData.findIndex(m => m.id.toLowerCase() === newMember.id.toLowerCase());
        if (existingIdx !== -1) {
          // Retain original ID casing for consistency across relations
          newMember.id = familyData[existingIdx].id;
          familyData[existingIdx] = newMember;
          updatedCount++;
        } else {
          familyData.push(newMember);
          addedCount++;
        }
      });

      // Reconcile and heal relationships across the ENTIRE updated database!
      // This matches names, nicknames, and case-insensitive IDs to valid alphanumeric ID keys.
      familyData.forEach(m => {
        if (m.fatherId) m.fatherId = resolveMemberId(m.fatherId, familyData);
        if (m.motherId) m.motherId = resolveMemberId(m.motherId, familyData);
        if (m.spouseId) m.spouseId = resolveMemberId(m.spouseId, familyData);
      });

      // Reciprocate marriages for consistency
      reciprocateSpouseLinks();

      saveDataToStorage();
      if (typeof clearCollapsedStates === 'function') {
        clearCollapsedStates();
      }
      renderActiveTab();
      showGenericAlert(`Bulk Import Successful! Added ${addedCount}, updated ${updatedCount} members. All relationships reconciled!`, 'success');
      
      // Reset file input
      document.getElementById('bulk-import-file-input').value = '';

    } catch (err) {
      console.error(err);
      showGenericAlert('Error: Failed to parse spreadsheet XLSX. Ensure format is correct.', 'danger');
    }
  };
  reader.readAsArrayBuffer(file);
}

// =================================================================
// MERGE STARTING SUPER ADMIN ACTIONS
// =================================================================

function openMergeModal() {
  document.getElementById('merge-modal').classList.remove('hidden');
  
  let currentAvatarEmoji = '👤';
  if (window.singleAdminToMerge.gender === 'Male') currentAvatarEmoji = '👨';
  else if (window.singleAdminToMerge.gender === 'Female') currentAvatarEmoji = '👩';
  
  document.getElementById('merge-current-avatar').textContent = currentAvatarEmoji;
  document.getElementById('merge-current-name').textContent = `${window.singleAdminToMerge.firstName} ${window.singleAdminToMerge.lastName}`;
  document.getElementById('merge-current-details').textContent = `System Role: Super Admin | ID: ${window.singleAdminToMerge.id}`;
  
  const select = document.getElementById('merge-target-select');
  select.innerHTML = '';
  
  const queryFirst = window.singleAdminToMerge.firstName.toLowerCase().trim();
  const queryLast = window.singleAdminToMerge.lastName.toLowerCase().trim();
  
  const suggested = [];
  const others = [];
  
  window.pendingImportedMembers.forEach(m => {
    const f = m.firstName.toLowerCase().trim();
    const l = m.lastName.toLowerCase().trim();
    const nick = (m.nickname || '').toLowerCase().trim();
    
    // Suggest matches based on name similarities
    const isMatch = (f === queryFirst && l === queryLast) || 
                    (f === queryFirst) || 
                    (l === queryLast) || 
                    (nick === queryFirst) ||
                    (f === nick);
    
    if (isMatch) {
      suggested.push(m);
    } else {
      others.push(m);
    }
  });
  
  if (suggested.length > 0) {
    const group = document.createElement('optgroup');
    group.label = 'Suggested Matches';
    suggested.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = `${m.firstName} ${m.lastName} (${m.id})`;
      group.appendChild(opt);
    });
    select.appendChild(group);
  }
  
  const groupOthers = document.createElement('optgroup');
  groupOthers.label = 'All Imported Members';
  others.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `${m.firstName} ${m.lastName} (${m.id})`;
    groupOthers.appendChild(opt);
  });
  select.appendChild(groupOthers);
}

function closeMergeModal() {
  document.getElementById('merge-modal').classList.add('hidden');
  document.getElementById('bulk-import-file-input').value = '';
}

function executeMerge() {
  const select = document.getElementById('merge-target-select');
  const targetId = select.value;
  if (!targetId) return;

  // Clear existing familyData (which only had 1 element)
  familyData = [];

  // Pushing all imported members into familyData
  window.pendingImportedMembers.forEach(m => {
    familyData.push(m);
  });

  // Promote the merged member to super_admin
  const mergedMember = familyData.find(m => m.id === targetId);
  if (mergedMember) {
    mergedMember.systemRole = 'super_admin';
    
    // Update active session
    if (currentSession) {
      currentSession.memberId = mergedMember.id;
      currentSession.name = `${mergedMember.firstName} ${mergedMember.lastName}`;
      currentSession.role = 'super_admin';
      localStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
    }
  }

  // Reconcile and heal relationships across the ENTIRE updated database!
  familyData.forEach(m => {
    if (m.fatherId) m.fatherId = resolveMemberId(m.fatherId, familyData);
    if (m.motherId) m.motherId = resolveMemberId(m.motherId, familyData);
    if (m.spouseId) m.spouseId = resolveMemberId(m.spouseId, familyData);
  });

  // Reciprocate marriages for consistency
  reciprocateSpouseLinks();

  window.treeFocusDropdownNeedsRebuild = true;
  saveDataToStorage();
  if (typeof clearCollapsedStates === 'function') {
    clearCollapsedStates();
  }
  updateAuthHeader(); // Update visual header
  renderActiveTab();

  showGenericAlert(`Profiles merged successfully! Integrated you as ${mergedMember ? mergedMember.firstName + ' ' + mergedMember.lastName : 'Super Admin'} in the tree.`, 'success');

  closeMergeModal();
  
  // Clear globals
  window.pendingImportedMembers = [];
  window.singleAdminToMerge = null;
}

function handleSkipMerge() {
  let addedCount = 0;
  let updatedCount = 0;

  window.pendingImportedMembers.forEach(newMember => {
    const existingIdx = familyData.findIndex(m => m.id.toLowerCase() === newMember.id.toLowerCase());
    if (existingIdx !== -1) {
      newMember.id = familyData[existingIdx].id;
      familyData[existingIdx] = newMember;
      updatedCount++;
    } else {
      familyData.push(newMember);
      addedCount++;
    }
  });

  // Reconcile and heal relationships
  familyData.forEach(m => {
    if (m.fatherId) m.fatherId = resolveMemberId(m.fatherId, familyData);
    if (m.motherId) m.motherId = resolveMemberId(m.motherId, familyData);
    if (m.spouseId) m.spouseId = resolveMemberId(m.spouseId, familyData);
  });

  // Reciprocate marriages for consistency
  reciprocateSpouseLinks();

  window.treeFocusDropdownNeedsRebuild = true;
  saveDataToStorage();
  if (typeof clearCollapsedStates === 'function') {
    clearCollapsedStates();
  }
  renderActiveTab();

  showGenericAlert(`Bulk Import Successful (No Merge)! Added ${addedCount}, updated ${updatedCount} members. All relationships reconciled.`, 'success');

  closeMergeModal();
  
  // Clear globals
  window.pendingImportedMembers = [];
  window.singleAdminToMerge = null;
}

window.openMergeModal = openMergeModal;
window.closeMergeModal = closeMergeModal;
window.executeMerge = executeMerge;
window.handleSkipMerge = handleSkipMerge;

// =================================================================
// PRIVACY FILTER RESOLVERS
// =================================================================

function shouldHideAge(memberId) {
  return false; // App owner sees all, no multi-user privacy constraints
}

function shouldHideContacts(memberId) {
  return false; // App owner sees all, no multi-user privacy constraints
}

// =================================================================
// SHARED ALBUMS GALLERY ENGINE & STORAGE
// =================================================================

let sharedAlbums = [];
const STORAGE_ALBUMS_KEY = 'yoyovayo_shared_albums';

function loadAlbumsFromStorage() {
  // Migrate old legacytree shared albums if present
  if (localStorage.getItem('legacytree_shared_albums') && !localStorage.getItem(STORAGE_ALBUMS_KEY)) {
    localStorage.setItem(STORAGE_ALBUMS_KEY, localStorage.getItem('legacytree_shared_albums'));
  }
  const raw = localStorage.getItem(STORAGE_ALBUMS_KEY);
  if (raw) {
    try {
      sharedAlbums = JSON.parse(raw);
    } catch (e) {
      console.error('Error parsing shared albums from storage', e);
      sharedAlbums = [];
    }
  } else {
    sharedAlbums = [];
  }
}

function saveAlbumsToStorage() {
  localStorage.setItem(STORAGE_ALBUMS_KEY, JSON.stringify(sharedAlbums));
}

function renderSharedAlbums() {
  const grid = document.getElementById('gallery-albums-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const addBtn = document.getElementById('add-album-btn');
  if (addBtn) {
    if (canEdit()) {
      addBtn.classList.remove('hidden');
    } else {
      addBtn.classList.add('hidden');
    }
  }

  if (sharedAlbums.length === 0) {
    grid.innerHTML = `
      <div class="width-full text-center glass padding-32" style="grid-column: 1 / -1; padding: 48px 24px; border-radius: 16px;">
        <span style="font-size: 48px; display: block; margin-bottom: 16px;">🖼️</span>
        <h3>No Shared Albums Yet</h3>
        <p class="color-dim" style="margin-top: 8px; max-width: 450px; margin-left: auto; margin-right: auto;">
          Submit shared Google Photos, SmugMug, or other photo sharing links to develop a beautiful collaborative digital gallery for the family!
        </p>
      </div>
    `;
    return;
  }

  sharedAlbums.forEach(album => {
    const card = document.createElement('div');
    card.className = 'album-card';
    card.onclick = (e) => {
      // Prevent redirect if clicking on actions
      if (e.target.closest('.album-card-actions')) return;
      window.open(album.url, '_blank');
    };

    // Use placeholder photo decoration based on album title
    let decorEmoji = '📸';
    if (album.title.toLowerCase().includes('wedding') || album.title.toLowerCase().includes('marriage')) decorEmoji = '💍';
    else if (album.title.toLowerCase().includes('baby') || album.title.toLowerCase().includes('child')) decorEmoji = '🍼';
    else if (album.title.toLowerCase().includes('reunion') || album.title.toLowerCase().includes('family')) decorEmoji = '🌳';
    else if (album.title.toLowerCase().includes('summer') || album.title.toLowerCase().includes('beach')) decorEmoji = '🏖️';
    else if (album.title.toLowerCase().includes('christmas') || album.title.toLowerCase().includes('holiday')) decorEmoji = '🎄';
    else if (album.title.toLowerCase().includes('birthday') || album.title.toLowerCase().includes('cake')) decorEmoji = '🎂';

    // Check if current user can edit to show Edit/Delete buttons
    let actionsHtml = '';
    if (canEdit()) {
      actionsHtml = `
        <div class="album-card-actions">
          <button class="btn-icon-sm" onclick="openEditAlbumModal('${album.id}')" title="Edit Album"><i data-lucide="edit-3"></i></button>
          <button class="btn-icon-sm btn-danger-hover" onclick="deleteSharedAlbum('${album.id}')" title="Delete Album"><i data-lucide="trash-2"></i></button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="album-card-decor">${decorEmoji}</div>
      ${actionsHtml}
      <div class="album-card-content">
        <h3>${album.title}</h3>
        <p>${album.description}</p>
      </div>
    `;
    grid.appendChild(card);
  });

  safeCreateIcons();
}

function openAddAlbumModal() {
  document.getElementById('album-modal-title').innerText = 'Add Shared Album';
  document.getElementById('album-form').reset();
  document.getElementById('form-album-id').value = '';
  document.getElementById('album-modal').classList.remove('hidden');
}

function openEditAlbumModal(id) {
  const album = sharedAlbums.find(a => a.id === id);
  if (!album) return;

  document.getElementById('album-modal-title').innerText = 'Edit Shared Album';
  document.getElementById('form-album-id').value = album.id;
  document.getElementById('form-album-title').value = album.title;
  document.getElementById('form-album-url').value = album.url;
  document.getElementById('form-album-desc').value = album.description;

  document.getElementById('album-modal').classList.remove('hidden');
}

function closeAlbumModal() {
  document.getElementById('album-modal').classList.add('hidden');
}

function handleAlbumFormSubmit(e) {
  e.preventDefault();

  const id = document.getElementById('form-album-id').value;
  const title = document.getElementById('form-album-title').value.trim();
  const url = document.getElementById('form-album-url').value.trim();
  const desc = document.getElementById('form-album-desc').value.trim();

  if (id) {
    // Edit mode
    const idx = sharedAlbums.findIndex(a => a.id === id);
    if (idx !== -1) {
      sharedAlbums[idx] = { id, title, url, description: desc };
    }
  } else {
    // Add mode
    const albumObj = {
      id: 'album_' + Date.now() + Math.random().toString(36).substr(2, 5),
      title: title,
      url: url,
      description: desc
    };
    sharedAlbums.push(albumObj);
  }

  saveAlbumsToStorage();
  closeAlbumModal();
  renderSharedAlbums();
  showGenericAlert('Album saved successfully!', 'success');
}

function deleteSharedAlbum(id) {
  if (confirm('Are you sure you want to delete this shared album link?')) {
    sharedAlbums = sharedAlbums.filter(a => a.id !== id);
    saveAlbumsToStorage();
    renderSharedAlbums();
    showGenericAlert('Album link deleted.', 'success');
  }
}

// =================================================================
// MEMBER PROFILE TAB CONTROLLER & ROUTING
// =================================================================

function parseDateToYYYYMMDD(dateStr) {
  if (!dateStr) return '';
  const normalized = normalizeDateString(dateStr);
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return '';
}

function getSiblings(member) {
  if (!member) return [];
  const siblingsMap = new Map();
  familyData.forEach(m => {
    if (m.id === member.id) return;
    const shareFather = member.fatherId && m.fatherId && member.fatherId === m.fatherId;
    const shareMother = member.motherId && m.motherId && member.motherId === m.motherId;
    if (shareFather || shareMother) {
      siblingsMap.set(m.id, m);
    }
  });
  return Array.from(siblingsMap.values());
}

function sortSiblings(siblings) {
  return siblings.sort((a, b) => {
    const getTimestamp = (dateStr) => {
      if (!dateStr) return null;
      const normalized = normalizeDateString(dateStr);
      const birth = new Date(normalized);
      return isNaN(birth.getTime()) ? null : birth.getTime();
    };
    
    const timeA = getTimestamp(a.birthDate);
    const timeB = getTimestamp(b.birthDate);
    
    if (timeA !== null && timeB !== null) {
      return timeA - timeB; // Earliest birth timestamp first (oldest first)
    }
    if (timeA !== null) return -1;
    if (timeB !== null) return 1;
    
    const nameA = `${a.firstName} ${a.lastName}`.toLowerCase();
    const nameB = `${b.firstName} ${b.lastName}`.toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

function renderFullUserProfilePage() {
  const container = document.getElementById('profile-container-wrapper');
  if (!container) return;

  let member = familyData.find(m => m.id === activeProfileMemberId);
  if (!member) {
    if (currentSession && currentSession.memberId) {
      member = familyData.find(m => m.id === currentSession.memberId);
    }
    if (!member && familyData.length > 0) {
      member = familyData[0];
    }
  }

  if (!member) {
    container.innerHTML = `
      <div class="empty-profile-state text-center p-48" style="margin-top: 64px;">
        <div style="font-size: 48px; margin-bottom: 16px;">👤</div>
        <h3 class="cinzel-title">No Profiles in Tree</h3>
        <p class="color-dim">Add members to the family tree to view profiles.</p>
        <button class="btn btn-primary btn-glow margin-top-16" onclick="openAddMemberModal()">
          <i data-lucide="plus"></i> Add First Member
        </button>
      </div>
    `;
    safeCreateIcons();
    return;
  }

  // Update active tracking ID
  activeProfileMemberId = member.id;

  // 1. Resolve Siblings
  const siblings = sortSiblings(getSiblings(member));
  const allChildren = sortSiblings([...siblings, member]);
  const myIndex = allChildren.findIndex(m => m.id === member.id);

  const elders = allChildren.slice(0, myIndex); // Eldest first (farthest left)
  const youngers = allChildren.slice(myIndex + 1); // Youngest last (farthest right)

  // 2. Resolve Primary Relations
  const father = member.fatherId ? familyData.find(m => m.id === member.fatherId) : null;
  const mother = member.motherId ? familyData.find(m => m.id === member.motherId) : null;
  const spouse = member.spouseId ? familyData.find(m => m.id === member.spouseId) : null;
  const children = sortSiblings(familyData.filter(m => m.fatherId === member.id || m.motherId === member.id));

  // 3. Render Navigation Arrows
  let leftNavHtml = '';
  if (myIndex > 0) {
    const sib = allChildren[myIndex - 1];
    leftNavHtml = `
      <button class="profile-nav-arrow-subtle" onclick="navigateToSibling('${sib.id}', 'left')" title="Slide to elder sibling: ${sib.firstName}">
        <i data-lucide="chevron-left"></i>
      </button>
    `;
  }

  let rightNavHtml = '';
  if (myIndex < allChildren.length - 1) {
    const sib = allChildren[myIndex + 1];
    rightNavHtml = `
      <button class="profile-nav-arrow-subtle" onclick="navigateToSibling('${sib.id}', 'right')" title="Slide to younger sibling: ${sib.firstName}">
        <i data-lucide="chevron-right"></i>
      </button>
    `;
  }

  // 4. Calculate Age & Zodiac
  const age = shouldHideAge(member.id) ? null : calculateAge(member.birthDate);
  const zodiac = member.birthDate ? getZodiacSign(member.birthDate) : null;

  // 5. Gather Contact Info
  let contactHtml = '';
  const isContactsHidden = shouldHideContacts(member.id);
  const showContacts = !member.isDeceased && !isContactsHidden && (member.phone || member.email || member.instagramId);

  if (member.isDeceased) {
    contactHtml = `<div class="p-16 text-center color-dim font-style-italic font-size-13">This individual is deceased. No active contact information is listed.</div>`;
  } else if (isContactsHidden) {
    contactHtml = `
      <div class="p-16 text-center color-dim font-style-italic font-size-13" style="display: flex; align-items: center; justify-content: center; gap: 6px;">
        <i data-lucide="eye-off" style="width: 14px; height: 14px;"></i>
        Contact details are kept private by this member.
      </div>
    `;
  } else if (!member.phone && !member.email && !member.instagramId) {
    contactHtml = `<div class="p-16 text-center color-dim font-style-italic font-size-13">No contact details are recorded for this family member.</div>`;
  } else {
    contactHtml = '<div class="profile-contact-list">';
    
    if (member.phone || member.callPhone) {
      contactHtml += '<div class="profile-contact-row">';
      if (member.phone) {
        contactHtml += `
          <div class="profile-contact-item" onclick="openGreetingPortal('${member.id}', 'general')">
            <div class="contact-icon-bg bg-whatsapp"><i data-lucide="message-circle"></i></div>
            <div class="contact-data">
              <span class="contact-label">WhatsApp Number</span>
              <span class="contact-val">${member.phone}</span>
            </div>
            <div class="contact-action-btn" title="Send WhatsApp Message"><i data-lucide="chevron-right"></i></div>
          </div>
        `;
      }
      if (member.callPhone) {
        contactHtml += `
          <div class="profile-contact-item" onclick="window.open('tel:${member.callPhone}', '_self')">
            <div class="contact-icon-bg bg-call"><i data-lucide="phone"></i></div>
            <div class="contact-data">
              <span class="contact-label">Voice Call</span>
              <span class="contact-val">${member.callPhone}</span>
            </div>
            <div class="contact-action-btn" title="Place Voice Call"><i data-lucide="chevron-right"></i></div>
          </div>
        `;
      }
      contactHtml += '</div>';
    }

    if (member.email) {
      contactHtml += `
        <div class="profile-contact-item" onclick="window.open('mailto:${member.email}', '_blank')">
          <div class="contact-icon-bg bg-email"><i data-lucide="mail"></i></div>
          <div class="contact-data">
            <span class="contact-label">Email Address</span>
            <span class="contact-val">${member.email}</span>
          </div>
          <div class="contact-action-btn" title="Send Email"><i data-lucide="chevron-right"></i></div>
        </div>
      `;
    }
    if (member.instagramId) {
      contactHtml += '<div class="profile-contact-row">';
      contactHtml += `
        <div class="profile-contact-item" onclick="window.open('https://instagram.com/${member.instagramId}', '_blank')">
          <div class="contact-icon-bg bg-instagram"><i data-lucide="instagram"></i></div>
          <div class="contact-data">
            <span class="contact-label">Instagram Username</span>
            <span class="contact-val">@${member.instagramId}</span>
          </div>
          <div class="contact-action-btn" title="View Instagram Profile"><i data-lucide="chevron-right"></i></div>
        </div>
      `;
      contactHtml += `
        <button class="btn btn-instagram-dm" onclick="window.open('https://instagram.com/direct/t/${member.instagramId}/', '_blank')">
          <i data-lucide="instagram"></i> <span>Send DM</span>
        </button>
      `;
      contactHtml += '</div>';
    }
    contactHtml += '</div>';
  }

  // 6. Gather Relations List
  let relationHtml = '';
  
  // Section 1: Parents & Spouse
  let parentsSpouseHtml = '';
  if (father) {
    parentsSpouseHtml += `
      <div class="profile-relation-pill glass" onclick="viewProfileFromRelationship('${father.id}')" title="View Father's profile">
        <div class="relation-avatar">${getMemberAvatarHtml(father)}</div>
        <div class="relation-text">
          <span class="relation-role">Father</span>
          <span class="relation-name">${father.firstName} ${father.lastName}</span>
        </div>
      </div>
    `;
  }
  if (mother) {
    parentsSpouseHtml += `
      <div class="profile-relation-pill glass" onclick="viewProfileFromRelationship('${mother.id}')" title="View Mother's profile">
        <div class="relation-avatar">${getMemberAvatarHtml(mother)}</div>
        <div class="relation-text">
          <span class="relation-role">Mother</span>
          <span class="relation-name">${mother.firstName} ${mother.lastName}</span>
        </div>
      </div>
    `;
  }
  if (spouse) {
    parentsSpouseHtml += `
      <div class="profile-relation-pill glass" onclick="viewProfileFromRelationship('${spouse.id}')" title="View Spouse's profile">
        <div class="relation-avatar">${getMemberAvatarHtml(spouse)}</div>
        <div class="relation-text">
          <span class="relation-role">Spouse</span>
          <span class="relation-name">${spouse.firstName} ${spouse.lastName}</span>
        </div>
      </div>
    `;
  }

  // Section 2: Siblings
  let siblingsHtml = '';
  siblings.forEach(sib => {
    siblingsHtml += `
      <div class="profile-relation-pill glass" onclick="viewProfileFromRelationship('${sib.id}')" title="View Sibling's profile">
        <div class="relation-avatar">${getMemberAvatarHtml(sib)}</div>
        <div class="relation-text">
          <span class="relation-role">Sibling</span>
          <span class="relation-name">${sib.firstName} ${sib.lastName}</span>
        </div>
      </div>
    `;
  });

  // Section 3: Children
  let childrenHtml = '';
  children.forEach(child => {
    childrenHtml += `
      <div class="profile-relation-pill glass" onclick="viewProfileFromRelationship('${child.id}')" title="View Child's profile">
        <div class="relation-avatar">${getMemberAvatarHtml(child)}</div>
        <div class="relation-text">
          <span class="relation-role">Child</span>
          <span class="relation-name">${child.firstName} ${child.lastName}</span>
        </div>
      </div>
    `;
  });

  // Assemble the 3 sections
  let relationSections = [];
  if (parentsSpouseHtml) {
    relationSections.push(`
      <div class="relationship-subsection">
        <h4 class="relationship-subsection-title"><i data-lucide="heart"></i> Parents & Spouse</h4>
        <div class="profile-relation-grid">${parentsSpouseHtml}</div>
      </div>
    `);
  }
  if (siblingsHtml) {
    relationSections.push(`
      <div class="relationship-subsection">
        <h4 class="relationship-subsection-title"><i data-lucide="users"></i> Siblings</h4>
        <div class="profile-relation-grid">${siblingsHtml}</div>
      </div>
    `);
  }
  if (childrenHtml) {
    relationSections.push(`
      <div class="relationship-subsection">
        <h4 class="relationship-subsection-title"><i data-lucide="baby"></i> Children</h4>
        <div class="profile-relation-grid">${childrenHtml}</div>
      </div>
    `);
  }

  if (relationSections.length === 0) {
    relationHtml = `<p class="color-dim font-style-italic font-size-13 p-12 text-center" style="margin: 0; width: 100%;">No parent, spouse, sibling, or children relationships have been entered yet.</p>`;
  } else {
    relationHtml = `<div class="profile-relationships-container">${relationSections.join('')}</div>`;
  }


  const canModify = canEdit(member.id);
  let editActionsHtml = '';
  if (canModify) {
    editActionsHtml = `
      <div class="actions-divider"></div>
      <div class="profile-edit-actions">
        <button class="btn btn-primary" onclick="openEditMemberModal('${member.id}')">
          <i data-lucide="edit-3"></i> Edit Profile / Contact
        </button>
        <div class="form-row-2">
          <button class="btn btn-secondary" onclick="openAddMemberModal('child', '${member.id}')">
            <i data-lucide="user-plus"></i> Add Child
          </button>
          <button class="btn btn-secondary" onclick="openAddMemberModal('spouse', '${member.id}')">
            <i data-lucide="heart-handshake"></i> Add Spouse
          </button>
        </div>
        <button class="btn btn-danger" onclick="deleteFamilyMember('${member.id}')">
          <i data-lucide="trash-2"></i> Delete This Member
        </button>
      </div>
    `;
  } else {
    // Completely omit any warning banner in View Mode to keep UI clean
    editActionsHtml = '';
  }

  // 8. Assemble Page Markup
  container.innerHTML = `
    <div class="profile-layout-wrapper">
      
      <!-- CENTER PROFILE CARD -->
      <div class="profile-center-container">
        <div class="profile-slide-inner profile-fade-in" id="profile-slide-inner">
          
          <!-- Header Profile Card -->
          <div class="profile-header-card">
            <div class="profile-avatar-wrapper">
              <div class="avatar-lg">${getMemberAvatarHtml(member)}</div>
              ${member.isDeceased ? `<span class="profile-deceased-badge">🕊️</span>` : ''}
            </div>
            <div class="profile-header-info">
              <h2 class="cinzel-title profile-full-name">${member.firstName} ${member.lastName}</h2>
              ${member.nickname ? `<p class="profile-nickname">"${member.nickname}"</p>` : ''}
              
              <div class="profile-meta-tags">
                ${member.isDeceased ? `<span class="profile-deceased-tag">In Remembrance</span>` : ''}
              </div>

              <div class="profile-life-stats">
                <span>📅 ${getYearRange(member)}</span>
                ${age !== null ? `<span>• 🎂 ${age} Years Old</span>` : ''}
                ${zodiac ? `<span>• ✨ ${zodiac}</span>` : ''}
              </div>
            </div>
          </div>

          <!-- Bottom Grid Details -->
          <div class="profile-details-grid">
            
            <!-- Contact Details Card -->
            <div class="profile-card card-contacts" style="grid-column: span 2;">
              <h3><i data-lucide="phone"></i> Contact Details</h3>
              <div class="card-content">
                ${contactHtml}
              </div>
            </div>

            <!-- Relationships Card -->
            <div class="profile-card card-relationships" style="grid-column: span 2;">
              <h3><i data-lucide="users"></i> Family Relationships</h3>
              <div class="card-content">
                ${relationHtml}
              </div>
            </div>

            <!-- Administrative & Actions Card -->
            <div class="profile-card card-actions" style="grid-column: span 2;">
              <h3><i data-lucide="shield-check"></i> Actions & Controls</h3>
              <div class="card-content">
                <button class="btn btn-focus-action btn-glow" onclick="profileSetAsFocus('${member.id}')">
                  <i data-lucide="git-branch"></i> Set as Branch Focus (Navigate to Family Tree)
                </button>
                ${editActionsHtml}
              </div>
            </div>

          </div>

        </div>
      </div>

    </div>
  `;

  // Instantiate Lucide icons inside the rendered container
  safeCreateIcons();

  // Add swipe gesture listener for side-to-side sibling transitions
  const layoutWrapper = container.querySelector('.profile-layout-wrapper');
  if (layoutWrapper) {
    let startX = 0;
    let startY = 0;
    const thresholdX = 50; // minimum horizontal swipe distance
    const restraintY = 100; // maximum vertical movement allowed to prevent swipe on scroll

    layoutWrapper.addEventListener('touchstart', (e) => {
      // Ignore if touch starts near the left screen edge (conflict-free swipe-in sidebar)
      if (e.touches && e.touches[0] && e.touches[0].clientX <= 45) {
        startX = 0;
        return;
      }
      if (e.touches && e.changedTouches && e.changedTouches[0]) {
        startX = e.changedTouches[0].screenX;
        startY = e.changedTouches[0].screenY;
      }
    }, { passive: true });

    layoutWrapper.addEventListener('touchend', (e) => {
      if (startX === 0) return; // Ignore edge swipe-in touches
      if (e.touches && e.changedTouches && e.changedTouches[0]) {
        const endX = e.changedTouches[0].screenX;
        const endY = e.changedTouches[0].screenY;

        const diffX = endX - startX;
        const diffY = endY - startY;

        if (Math.abs(diffX) >= thresholdX && Math.abs(diffY) <= restraintY) {
          if (diffX < 0) {
            // Swipe Left -> Mimic Right navigation (slide younger sibling in from the right)
            if (myIndex < allChildren.length - 1) {
              const sib = allChildren[myIndex + 1];
              navigateToSibling(sib.id, 'right');
            }
          } else {
            // Swipe Right -> Mimic Left navigation (slide elder sibling in from the left)
            if (myIndex > 0) {
              const sib = allChildren[myIndex - 1];
              navigateToSibling(sib.id, 'left');
            }
          }
        }
      }
    }, { passive: true });
  }
}

function navigateToSibling(siblingId, direction) {
  const innerWrapper = document.getElementById('profile-slide-inner');
  if (!innerWrapper) {
    activeProfileMemberId = siblingId;
    renderFullUserProfilePage();
    return;
  }

  const exitClass = direction === 'left' ? 'profile-slide-exit-right' : 'profile-slide-exit-left';
  const enterClass = direction === 'left' ? 'profile-slide-enter-left' : 'profile-slide-enter-right';

  innerWrapper.classList.add(exitClass);

  setTimeout(() => {
    activeProfileMemberId = siblingId;
    renderFullUserProfilePage();

    const newInnerWrapper = document.getElementById('profile-slide-inner');
    if (newInnerWrapper) {
      newInnerWrapper.classList.add(enterClass);
      setTimeout(() => {
        newInnerWrapper.classList.remove(enterClass);
      }, 350);
    }
  }, 350);
}

function viewProfileFromRelationship(memberId) {
  const innerWrapper = document.getElementById('profile-slide-inner');
  if (!innerWrapper) {
    activeProfileMemberId = memberId;
    renderFullUserProfilePage();
    return;
  }

  // Beautiful quick scale-fade transition for relationship navigations
  innerWrapper.style.transition = 'opacity 0.2s, transform 0.2s';
  innerWrapper.style.opacity = '0';
  innerWrapper.style.transform = 'scale(0.98)';

  setTimeout(() => {
    activeProfileMemberId = memberId;
    renderFullUserProfilePage();
  }, 200);
}

function profileSetAsFocus(memberId) {
  // 1. Navigate back to Family Tree
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const treeBtn = document.querySelector('.nav-item[data-tab="tree"]');
  if (treeBtn) treeBtn.classList.add('active');

  currentTab = 'tree';
  renderActiveTab();

  // 2. Trigger branch focus and isolate the tree branch
  if (typeof isolateTreeBranch === 'function') {
    isolateTreeBranch(memberId);
  }
}

// =================================================================
// MOBILE SIDEBAR GESTURES & APPEARANCE CONTROLLERS
// =================================================================

function showMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.add('open');
  if (backdrop) backdrop.classList.add('active');
  if (sidebar) sidebar.style.transform = '';
  if (backdrop) {
    backdrop.style.opacity = '';
    backdrop.style.pointerEvents = '';
  }
}
window.showMobileSidebar = showMobileSidebar;

function hideMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('open');
  if (backdrop) backdrop.classList.remove('active');
  if (sidebar) sidebar.style.transform = '';
  if (backdrop) {
    backdrop.style.opacity = '';
    backdrop.style.pointerEvents = '';
  }
}
window.hideMobileSidebar = hideMobileSidebar;

function toggleMobileSidebar() {
  const sidebar = document.querySelector('.sidebar');
  if (sidebar && sidebar.classList.contains('open')) {
    hideMobileSidebar();
  } else {
    showMobileSidebar();
  }
}
window.toggleMobileSidebar = toggleMobileSidebar;

function initMobileSidebarGestures() {
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;
  let isDragging = false;
  let isOpening = false;
  let isClosing = false;
  const SIDEBAR_WIDTH = 220; // Matches CSS width

  document.addEventListener('touchstart', (e) => {
    if (window.innerWidth > 768) return;
    const touch = e.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    currentX = startX;
    currentY = startY;
    isDragging = false;
    isOpening = false;
    isClosing = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (window.innerWidth > 768) return;
    const touch = e.touches[0];
    currentX = touch.clientX;
    currentY = touch.clientY;

    const diffX = currentX - startX;
    const diffY = currentY - startY;

    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;
    const isSidebarOpen = sidebar.classList.contains('open');

    if (!isDragging) {
      // Ignore scroll gestures, check for clear horizontal movement
      if (Math.abs(diffX) > 10 && Math.abs(diffX) > Math.abs(diffY)) {
        if (!isSidebarOpen && startX <= 45 && diffX > 0) {
          isOpening = true;
          isDragging = true;
          sidebar.style.transition = 'none';
          const backdrop = document.getElementById('sidebar-backdrop');
          if (backdrop) backdrop.style.transition = 'none';
        } else if (isSidebarOpen && diffX < 0) {
          isClosing = true;
          isDragging = true;
          sidebar.style.transition = 'none';
          const backdrop = document.getElementById('sidebar-backdrop');
          if (backdrop) backdrop.style.transition = 'none';
        }
      }
    }

    if (isDragging) {
      const backdrop = document.getElementById('sidebar-backdrop');
      if (isOpening) {
        const translateX = Math.min(0, -SIDEBAR_WIDTH + diffX);
        sidebar.style.transform = `translateX(${translateX}px)`;
        if (backdrop) {
          const progress = Math.min(1, diffX / SIDEBAR_WIDTH);
          backdrop.style.opacity = progress;
          backdrop.style.pointerEvents = 'auto';
        }
      } else if (isClosing) {
        const translateX = Math.max(-SIDEBAR_WIDTH, diffX);
        sidebar.style.transform = `translateX(${translateX}px)`;
        if (backdrop) {
          const progress = Math.min(1, (SIDEBAR_WIDTH + diffX) / SIDEBAR_WIDTH);
          backdrop.style.opacity = progress;
        }
      }

      if (e.cancelable) {
        e.preventDefault();
      }
    }
  }, { passive: false });

  document.addEventListener('touchend', (e) => {
    if (window.innerWidth > 768) return;
    const sidebar = document.querySelector('.sidebar');
    const backdrop = document.getElementById('sidebar-backdrop');

    if (isDragging) {
      isDragging = false;
      if (sidebar) sidebar.style.transition = '';
      if (backdrop) backdrop.style.transition = '';

      const diffX = currentX - startX;
      const swipeThreshold = 60;

      if (isOpening) {
        if (diffX > swipeThreshold) {
          showMobileSidebar();
        } else {
          hideMobileSidebar();
        }
      } else if (isClosing) {
        if (diffX < -swipeThreshold) {
          hideMobileSidebar();
        } else {
          showMobileSidebar();
        }
      }
    }

    isOpening = false;
    isClosing = false;
  }, { passive: true });
}
window.initMobileSidebarGestures = initMobileSidebarGestures;

function applyFontSizeScale(scale) {
  let styleEl = document.getElementById('dynamic-font-size-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'dynamic-font-size-style';
    document.head.appendChild(styleEl);
  }

  // Inject beautiful, relative font scaling override rules for key containers
  styleEl.innerHTML = `
    body { font-size: ${16 * scale}px !important; }
    h1, .cinzel-title { font-size: calc(20px * ${scale}) !important; }
    h2 { font-size: calc(18px * ${scale}) !important; }
    h3 { font-size: calc(16px * ${scale}) !important; }
    h4 { font-size: calc(14px * ${scale}) !important; }
    p, span, label, input, select, textarea, button { font-size: calc(13px * ${scale}) !important; }
    .nav-item { font-size: calc(14px * ${scale}) !important; }
    .nav-item i, .nav-item svg { width: calc(18px * ${scale}) !important; height: calc(18px * ${scale}) !important; }
    .member-name { font-size: calc(15px * ${scale}) !important; }
    .card-title { font-size: calc(16px * ${scale}) !important; }
  `;
}
window.applyFontSizeScale = applyFontSizeScale;

function updateFontSizeLabel(scale) {
  const label = document.getElementById('font-size-label-val');
  if (!label) return;

  if (scale <= 0.85) {
    label.innerText = 'Small';
  } else if (scale <= 0.95) {
    label.innerText = 'Compact';
  } else if (scale <= 1.05) {
    label.innerText = 'Medium (Default)';
  } else if (scale <= 1.15) {
    label.innerText = 'Large';
  } else {
    label.innerText = 'Extra Large';
  }
}
window.updateFontSizeLabel = updateFontSizeLabel;

function handleFontSizeSliderInput(val) {
  const scale = parseFloat(val);
  localStorage.setItem('yoyovayo_font_scale', val);
  applyFontSizeScale(scale);
  updateFontSizeLabel(scale);
}
window.handleFontSizeSliderInput = handleFontSizeSliderInput;

// =================================================================
// PWA COMPANION INSTALLER ("Add to Home")
// =================================================================
window.deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  window.deferredPrompt = e;
  // Update UI to notify the user they can install the PWA
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) {
    installBtn.style.display = 'flex';
  }
});

window.addEventListener('appinstalled', (evt) => {
  console.log('YoyoVayo! PWA companion was installed successfully.');
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) {
    installBtn.style.display = 'none';
  }
  window.deferredPrompt = null;
});

// iOS PWA Guidance Modal Toggle Handlers
function showIosInstallModal() {
  const modal = document.getElementById('ios-install-modal');
  if (modal) {
    modal.classList.remove('hidden');
    if (window.lucide) {
      window.lucide.createIcons();
    }
  }
}

function closeIosInstallModal() {
  const modal = document.getElementById('ios-install-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
}

window.showIosInstallModal = showIosInstallModal;
window.closeIosInstallModal = closeIosInstallModal;
