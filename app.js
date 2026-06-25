// =================================================================
// LEGACYTREE CENTRAL ENGINE, DATA STORE & SESSION CONTROLLER
// =================================================================

// --- GLOBAL APPLICATION STATE ---
let familyData = [];
let currentSession = null; // { memberId: string, name: string, role: string }
let currentTab = 'tree';
// Simulated OTP variables removed for local-only instant logins.
window.treeFocusDropdownNeedsRebuild = true;
window.pendingImportedMembers = [];
window.singleAdminToMerge = null;

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

// --- ON APPLICATION LOAD ---
document.addEventListener('DOMContentLoaded', () => {
  // 1. Load Data & Session
  loadDataFromStorage();
  loadAlbumsFromStorage();
  loadSessionFromStorage();

  // 2. Initialize UI & Routing
  initializeTabs();
  updateAuthHeader();
  safeCreateIcons();

  // 3. Trigger initial view render
  renderActiveTab();

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
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (raw) {
    try {
      currentSession = JSON.parse(raw);
    } catch (e) {
      currentSession = null;
    }
  } else {
    currentSession = null; // Guest Mode by default
  }
}

function saveSessionToStorage() {
  if (currentSession) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(currentSession));
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
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
 * Permission Resolver: Evaluates if the current logged-in session has permissions to edit the target family member.
 * @param {string} targetMemberId 
 * @returns {boolean}
 */
function canEdit(targetMemberId) {
  if (!currentSession) return false; // Guest mode is strictly read-only
  if (currentSession.role === 'super_admin') return true; // Super admin edits everything

  const targetMember = familyData.find(m => m.id === targetMemberId);
  if (!targetMember) return false;

  if (currentSession.role === 'admin') {
    // Admins can edit anything except the Super Admin's details (or self, which is allowed)
    return targetMember.systemRole !== 'super_admin';
  }

  if (currentSession.role === 'member') {
    const myId = currentSession.memberId;
    if (targetMemberId === myId) return true; // Can edit themselves
    
    // Can edit spouse (highly convenient for completing anniversaries)
    const myProfile = familyData.find(m => m.id === myId);
    if (myProfile && myProfile.spouseId === targetMemberId) return true;

    // Can edit their own direct descendants recursively
    const myDescendants = getDescendantIds(myId);
    return myDescendants.has(targetMemberId);
  }

  return false;
}

/**
 * Returns helper context description about why a member can or cannot edit.
 */
function getPermissionMessage(targetMemberId) {
  if (!currentSession) return '🔒 Guest Mode: Please login to edit family details.';
  if (canEdit(targetMemberId)) return '✍️ You have permission to edit this member.';
  
  if (currentSession.role === 'member') {
    return '🔒 Locked: Regular members can only edit themselves and their direct descendants ("below them" in the tree).';
  }
  if (currentSession.role === 'admin') {
    return '🔒 Locked: Admins cannot modify the Super Admin profile.';
  }
  return '🔒 Locked: Permission denied.';
}

// =================================================================
// SIMULATED OTP LOGIN CONTROLLER
// =================================================================

function openLoginModal() {
  document.getElementById('login-modal').classList.remove('hidden');
  document.getElementById('login-step-member').classList.remove('hidden');
  filterLoginMembers('');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
}

function filterLoginMembers(query) {
  const container = document.getElementById('login-member-results');
  container.innerHTML = '';

  const queryLower = query.toLowerCase();
  
  // Any living family member can log in instantly
  const candidates = familyData.filter(m => 
    !m.isDeceased && 
    (m.firstName.toLowerCase().includes(queryLower) || 
     m.lastName.toLowerCase().includes(queryLower) ||
     (m.nickname && m.nickname.toLowerCase().includes(queryLower)))
  );

  if (candidates.length === 0) {
    container.innerHTML = `<div class="p-12 text-center color-dim font-size-13">No eligible members found.</div>`;
    return;
  }

  candidates.forEach(m => {
    const row = document.createElement('div');
    row.className = 'login-member-row';
    row.onclick = () => loginAsMember(m.id);

    let roleIcon = '👤';
    if (m.systemRole === 'super_admin') roleIcon = '👑';
    else if (m.systemRole === 'admin') roleIcon = '🛠️';

    row.innerHTML = `
      <div class="login-member-left">
        <div class="login-member-avatar">${getGenderAvatarEmoji(m.gender, m.isDeceased)}</div>
        <div>
          <div class="login-member-name">${m.firstName} ${m.lastName} <span class="font-size-12 color-dim">(${roleIcon})</span></div>
          <div class="font-size-11 color-dim">${m.nickname ? `Also known as: "${m.nickname}"` : 'Family Member'}</div>
        </div>
      </div>
      <span class="login-member-btn">Select</span>
    `;
    container.appendChild(row);
  });
}

function loginAsMember(memberId) {
  const member = familyData.find(m => m.id === memberId);
  if (!member) return;

  currentSession = {
    memberId: member.id,
    name: `${member.firstName} ${member.lastName}`,
    role: member.systemRole || 'member',
    gender: member.gender
  };
  saveSessionToStorage();
  closeLoginModal();
  updateAuthHeader();
  renderActiveTab();
  
  showGenericAlert(`Logged in as ${currentSession.name}!`, 'success');
}

function handleLogout() {
  currentSession = null;
  saveSessionToStorage();
  updateAuthHeader();
  renderActiveTab();
  showGenericAlert('Logged out. Reverted to Guest Mode.', 'info');
}

function updateAuthHeader() {
  const badge = document.getElementById('session-badge');
  const avatar = document.getElementById('session-avatar');
  const nameEl = document.getElementById('session-name');
  const roleEl = document.getElementById('session-role');
  const btn = document.getElementById('auth-action-btn');
  const bulkCard = document.getElementById('admin-bulk-import-card');

  // Reset classes
  badge.className = 'session-badge';

  if (currentSession) {
    // Logged In State
    badge.classList.add(currentSession.role.replace('_', '-'));
    avatar.innerText = getGenderAvatarEmoji(currentSession.gender, false);
    nameEl.innerText = currentSession.name;
    
    let roleLabel = 'Regular Member';
    if (currentSession.role === 'super_admin') roleLabel = '👑 Super Admin';
    else if (currentSession.role === 'admin') roleLabel = '🛠️ Editor Admin';
    
    roleEl.innerText = roleLabel;
    
    btn.innerHTML = `<i data-lucide="log-out"></i> Logout`;
    btn.onclick = handleLogout;
    
    // Enable "Add member" buttons if authorized
    document.querySelectorAll('.hidden-guest').forEach(el => el.classList.remove('hidden'));

    // Toggle bulk importer visibility (only for Admins and Super Admins)
    if (currentSession.role === 'super_admin' || currentSession.role === 'admin') {
      if (bulkCard) bulkCard.classList.remove('hidden');
    } else {
      if (bulkCard) bulkCard.classList.add('hidden');
    }
  } else {
    // Guest State
    badge.classList.add('guest');
    avatar.innerText = '👤';
    nameEl.innerText = 'Guest Account';
    roleEl.innerText = 'View-Only Mode';
    
    btn.innerHTML = `<i data-lucide="log-in"></i> Login`;
    btn.onclick = openLoginModal;

    // Hide edit options
    document.querySelectorAll('.hidden-guest').forEach(el => el.classList.add('hidden'));

    // Hide bulk importer
    if (bulkCard) bulkCard.classList.add('hidden');
  }
  safeCreateIcons();
}

// =================================================================
// CORE DATA MANIPULATION & RELATIONSHIP BINDING (CRUD)
// =================================================================

function openAddMemberModal(relationType = null, relationSourceId = null) {
  document.getElementById('member-modal-title').innerText = relationType ? `Add Linked Family Member` : 'Add Family Member';
  document.getElementById('member-modal-subtitle').innerText = relationType 
    ? `Adding a ${relationType.toUpperCase()} relative to your active family node.` 
    : 'Establish a new family member in the root grid.';

  document.getElementById('member-form').reset();
  document.getElementById('form-member-id').value = '';
  document.getElementById('form-relation-type').value = relationType || '';
  document.getElementById('form-relation-source-id').value = relationSourceId || '';
  
  // Set default deceased checkbox state to false
  document.getElementById('form-is-deceased').checked = false;
  toggleDeceasedFields(false);

  // Populate Relation dropdowns with list of everyone in tree
  populateRelationDropdowns();

  // Handle security settings pane - Only Super Admin can promote roles
  const securitySec = document.getElementById('form-section-security');
  if (currentSession && currentSession.role === 'super_admin') {
    securitySec.classList.remove('hidden');
    document.getElementById('form-system-role').value = 'member';
  } else {
    securitySec.classList.add('hidden');
  }

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
  document.getElementById('form-email').value = member.email || '';
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

  // Handle security settings dropdown visibility
  const securitySec = document.getElementById('form-section-security');
  if (currentSession && currentSession.role === 'super_admin') {
    securitySec.classList.remove('hidden');
    document.getElementById('form-system-role').value = member.systemRole || 'member';
  } else {
    securitySec.classList.add('hidden');
  }

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
    systemRole: (currentSession && currentSession.role === 'super_admin') 
      ? document.getElementById('form-system-role').value 
      : 'member'
  };

  // If this is the FIRST member created, automatically make them Super Admin!
  if (familyData.length === 0) {
    memberObj.systemRole = 'super_admin';
  }

  if (id) {
    // UPDATE MODE
    const idx = familyData.findIndex(m => m.id === id);
    if (idx !== -1) {
      // Validate that role changes to Super Admin are allowed
      if (familyData[idx].systemRole === 'super_admin' && memberObj.systemRole !== 'super_admin') {
        // Trying to demote Super Admin, must confirm there's another super admin or prevent it
        const supers = familyData.filter(m => m.systemRole === 'super_admin' && m.id !== id);
        if (supers.length === 0) {
          showGenericAlert('Aborted: There must be at least one 👑 Super Admin in the system.', 'danger');
          return;
        }
      }
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
  let phone = activeGreetingRecipient.phone.replace(/[^0-9+]/g, ''); // strip letters/spaces

  // Ensure country code is set, default to US/Global click logic
  if (!phone.startsWith('+')) {
    phone = '+' + phone; // fallback
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
  }
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

  heroContainer.innerHTML = `
    <div class="hero-card">
      <div class="hero-icon">${heroEvent.emoji}</div>
      <div class="hero-badge">${heroEvent.title}</div>
      <div class="hero-name">${targetName}</div>
      <div class="hero-countdown">${countdownLabel}</div>
      <div class="font-size-13 opacity-80">${heroDesc}</div>
      <div class="font-size-12 opacity-60">${formatFriendlyDate(heroEvent.originalDate)}</div>
      ${contactButtonHtml}
    </div>
  `;

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

    const waActionHtml = (ev.member.phone && !hideContactsVal) 
      ? `<button class="btn btn-secondary cursor-pointer" onclick="openGreetingPortal('${ev.member.id}', '${ev.type}')" title="Send WhatsApp greeting">
          <i data-lucide="message-circle" style="color: var(--green);"></i>
         </button>`
      : '';

    item.innerHTML = `
      <div class="timeline-info">
        <div class="timeline-avatar">${getGenderAvatarEmoji(ev.member.gender, ev.member.isDeceased)}</div>
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
      
      // Navigate to tree tab and highlight node
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      const treeBtn = document.querySelector('.nav-item[data-tab="tree"]');
      if (treeBtn) treeBtn.classList.add('active');
      
      currentTab = 'tree';
      renderActiveTab();
      
      // Set the branch focus on that person, display the branch (zoom-to-fit), and open the profile details
      if (typeof isolateTreeBranch === 'function') {
        isolateTreeBranch(m.id);
        if (typeof openInfoDrawer === 'function') {
          openInfoDrawer(m.id);
        }
      } else if (typeof focusOnTreeCard === 'function') {
        focusOnTreeCard(m.id);
      }
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
    'Birth Date', 'Death Date', 'Phone', 'Email', 'Biography Notes',
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
      String(m.birthDate || ''),
      String(m.deathDate || ''),
      m.phone ? String(m.phone) : '',
      String(m.email || ''),
      String(m.notes || ''),
      String(m.avatarUrl || ''),
      String(m.instagramId || ''),
      m.hideAge ? 'TRUE' : 'FALSE',
      m.hideContactDetails ? 'TRUE' : 'FALSE',
      String(m.fatherId || ''),
      String(m.motherId || ''),
      String(m.spouseId || ''),
      String(m.marriageDate || ''),
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
    <h2>🌳 Welcome to YoYoVaYo!</h2>
    <p>Your collaborative family tree database is currently empty.</p>
    <div class="flex flex-wrap gap-12 justify-content-center margin-top-16">
      <button class="btn btn-success btn-glow" onclick="openAddMemberModal()"><i data-lucide="plus-circle"></i> Create First Member (You)</button>
      <button class="btn btn-secondary btn-glow" onclick="document.getElementById('import-file-input').click()"><i data-lucide="upload"></i> Restore from Backup</button>
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

// Global Theme toggle
function toggleTheme() {
  const body = document.body;
  const sunIcon = document.getElementById('theme-icon-sun');
  const moonIcon = document.getElementById('theme-icon-moon');

  if (body.classList.contains('dark-theme')) {
    body.classList.replace('dark-theme', 'light-theme');
    sunIcon.classList.remove('hidden');
    moonIcon.classList.add('hidden');
  } else {
    body.classList.replace('light-theme', 'dark-theme');
    sunIcon.classList.add('hidden');
    moonIcon.classList.remove('hidden');
  }
}

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

  // Convert DD-MM-YYYY or DD/MM/YYYY
  const parts = str.split(/[-/]/);
  if (parts.length === 3) {
    let p0 = parts[0].trim();
    let p1 = parts[1].trim();
    let p2 = parts[2].trim();

    if (p2.length === 4 && !isNaN(p2)) {
      return `${p2}-${p1.padStart(2, '0')}-${p0.padStart(2, '0')}`;
    }
    if (p0.length === 4 && !isNaN(p0)) {
      return `${p0}-${p1.padStart(2, '0')}-${p2.padStart(2, '0')}`;
    }
  }
  return str;
}

// =================================================================
// BULK SPREADSHEET IMPORTER CONTROLLERS (XLSX PARSING VIA SHEETJS)
// =================================================================

function downloadXlsxTemplate() {
  const headers = [
    'ID', 'First Name', 'Last Name', 'Nickname', 'Gender', 'Is Deceased',
    'Birth Date', 'Death Date', 'Phone', 'Email', 'Biography Notes',
    'Father ID', 'Mother ID', 'Spouse ID', 'Marriage Date', 'System Role'
  ];

  const sampleRows = [
    [
      'grandpa_sam', 'Samuel', 'Smith', 'Sam', 'Male', 'FALSE',
      '1945-06-15', '', '919496123778', 'samuel@smith.com',
      'The root grandfather of our family tree. Enthusiastic gardener, loved woodcarving.',
      '', '', '', '1970-10-10', 'super_admin'
    ],
    [
      'grandma_mary', 'Mary', 'Smith', 'Nana', 'Female', 'FALSE',
      '1950-11-22', '', '+15559876543', 'mary@smith.com',
      'Beloved grandmother. Master baker of apple pies and avid reader.',
      '', '', 'grandpa_sam', '1970-10-10', 'member'
    ],
    [
      'son_john', 'John', 'Smith', 'Johnny', 'Male', 'FALSE',
      '1975-04-12', '', '+15551112222', 'johnny@smith.com',
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
  const member = familyData.find(m => m.id === memberId);
  if (!member || !member.hideAge) return false;
  
  if (!currentSession) return true; // Guest cannot see secret age
  if (currentSession.role === 'super_admin' || currentSession.role === 'admin') return false; // Admins can see
  if (currentSession.memberId === memberId) return false; // Self can see
  
  return true; // Other members cannot see
}

function shouldHideContacts(memberId) {
  const member = familyData.find(m => m.id === memberId);
  if (!member || !member.hideContactDetails) return false;
  
  if (!currentSession) return true; // Guest cannot see contact details
  if (currentSession.role === 'super_admin' || currentSession.role === 'admin') return false; // Admins can see
  if (currentSession.memberId === memberId) return false; // Self can see
  
  return true; // Other members cannot see
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
    if (currentSession && (currentSession.role === 'super_admin' || currentSession.role === 'admin')) {
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

    // Check if current user is admin/super_admin to show Edit/Delete buttons
    let actionsHtml = '';
    if (currentSession && (currentSession.role === 'super_admin' || currentSession.role === 'admin')) {
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
