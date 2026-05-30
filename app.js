/**
 * Nostr Keep - Main Application Orchestration
 * Wire up IndexedDB local storage, Nostr sync managers, PWA registration,
 * and standard interactive UI events for a perfect desktop/mobile Google Keep experience.
 */

import { db, generateUUID } from './db.js';
import { nostr } from './nostr.js';

// Application State
const state = {
  currentView: 'notes',          // 'notes', 'archive', 'trash', 'label-<name>'
  activeLabelFilter: null,       // If filtering by a specific label
  layoutMode: 'grid',            // 'grid' or 'list'
  allNotes: [],                  // Cache of all local notes from DB
  allLabels: [],                 // Cache of all local labels
  activeEditNote: null,          // Note currently being edited in the modal
  activePopoverNoteId: null,     // Note ID associated with currently open popover
  popoverTriggerType: 'creator', // 'creator', 'modal', or 'card-<id>'
  activeLabelsSelection: [],     // Temporary labels list when editing/creating
  activeColorSelection: 'default',// Temporary color selection
  isNewNote: false,              // Whether the modal is in "create new" mode
  isPreviewMode: false,          // Whether the modal content is in markdown preview mode
  themeChoice: 'dark'            // 'dark' or 'oled'
};

// Markdown Rendering Utility using marked.js with a safe HTML-escaping fallback
function renderMarkdown(text) {
  if (!text) return '';
  if (window.marked && typeof window.marked.parse === 'function') {
    try {
      return window.marked.parse(text, { gfm: true, breaks: true });
    } catch (e) {
      console.error('Marked parsing failed:', e);
    }
  }
  // Safe simple fallback
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// Toggles the Edit Note Modal between Edit and Markdown Preview modes
function toggleModalPreviewMode() {
  state.isPreviewMode = !state.isPreviewMode;
  
  if (state.isPreviewMode) {
    DOM.modalPreviewBtn.classList.add('active');
    const content = DOM.modalContent.value;
    DOM.modalContentPreview.innerHTML = renderMarkdown(content);
    DOM.modalContent.style.display = 'none';
    DOM.modalContentPreview.style.display = 'block';
  } else {
    DOM.modalPreviewBtn.classList.remove('active');
    DOM.modalContent.style.display = 'block';
    DOM.modalContentPreview.style.display = 'none';
  }
}

// Applies the selected UI theme ('dark' or 'oled') and updates settings buttons
function applyTheme(theme) {
  state.themeChoice = theme;
  
  if (theme === 'oled') {
    document.body.classList.add('theme-oled');
    if (DOM.themeDarkBtn) DOM.themeDarkBtn.classList.remove('active');
    if (DOM.themeOledBtn) DOM.themeOledBtn.classList.add('active');
  } else {
    document.body.classList.remove('theme-oled');
    if (DOM.themeDarkBtn) DOM.themeDarkBtn.classList.add('active');
    if (DOM.themeOledBtn) DOM.themeOledBtn.classList.remove('active');
  }
}

// DOM Elements
const DOM = {
  appContainer: document.getElementById('appContainer'),
  menuToggle: document.getElementById('menuToggle'),
  sidebar: document.getElementById('sidebar'),
  sidebarBackdrop: document.getElementById('sidebarBackdrop'),
  searchBar: document.getElementById('searchBar'),
  syncStatus: document.getElementById('syncNowBtnHeader'),
  syncDot: document.getElementById('syncDotHeader'),
  syncText: document.getElementById('syncText'),
  viewToggle: document.getElementById('viewToggle'),
  gridIcon: document.getElementById('gridIcon'),
  listIcon: document.getElementById('listIcon'),
  profileBtn: document.getElementById('profileBtn'),
  profileInitials: document.getElementById('profileInitials'),
  profileImg: document.getElementById('profileImg'),
  
  // Navigation Sidebar
  navNotes: document.getElementById('navNotes'),
  navEditLabels: document.getElementById('navEditLabels'),
  navInvitations: document.getElementById('navInvitations'),
  invitationsDot: document.getElementById('invitationsDot'),
  navArchive: document.getElementById('navArchive'),
  navTrash: document.getElementById('navTrash'),
  sidebarLabelsContainer: document.getElementById('sidebarLabelsContainer'),
  
  // Workspace Grids
  mainContent: document.getElementById('mainContent'),
  pinnedSection: document.getElementById('pinnedSection'),
  pinnedNotesGrid: document.getElementById('pinnedNotesGrid'),
  othersSection: document.getElementById('othersSection'),
  othersSectionTitle: document.getElementById('othersSectionTitle'),
  othersNotesGrid: document.getElementById('othersNotesGrid'),
  emptyState: document.getElementById('emptyState'),
  mobileFab: document.getElementById('mobileFab'),
  
  // Note Creator (Desktop, Collapsed/Expanded)
  noteCreatorContainer: document.getElementById('noteCreatorContainer'),
  noteCreator: document.getElementById('noteCreator'),
  creatorCollapsed: document.getElementById('creatorCollapsed'),
  creatorExpanded: document.getElementById('creatorExpanded'),
  creatorTitle: document.getElementById('creatorTitle'),
  creatorContent: document.getElementById('creatorContent'),
  creatorTagsDisplay: document.getElementById('creatorTagsDisplay'),
  creatorPinBtn: document.getElementById('creatorPinBtn'),
  creatorColorBtn: document.getElementById('creatorColorBtn'),
  creatorLabelBtn: document.getElementById('creatorLabelBtn'),
  creatorArchiveBtn: document.getElementById('creatorArchiveBtn'),
  creatorCloseBtn: document.getElementById('creatorCloseBtn'),
  
  // Modals & Dialogs
  editNoteModal: document.getElementById('editNoteModal'),
  modalCard: document.getElementById('modalCard'),
  modalTitle: document.getElementById('modalTitle'),
  modalContent: document.getElementById('modalContent'),
  modalContentPreview: document.getElementById('modalContentPreview'),
  modalTagsDisplay: document.getElementById('modalTagsDisplay'),
  modalColorBtn: document.getElementById('modalColorBtn'),
  modalLabelBtn: document.getElementById('modalLabelBtn'),
  modalArchiveBtn: document.getElementById('modalArchiveBtn'),
  modalPinBtn: document.getElementById('modalPinBtn'),
  modalPreviewBtn: document.getElementById('modalPreviewBtn'),
  modalTrashBtn: document.getElementById('modalTrashBtn'),
  modalCloseBtn: document.getElementById('modalCloseBtn'),
  
  // Edit Labels Modal
  editLabelsModal: document.getElementById('editLabelsModal'),
  newLabelInput: document.getElementById('newLabelInput'),
  createLabelBtn: document.getElementById('createLabelBtn'),
  labelsManagerList: document.getElementById('labelsManagerList'),
  labelsModalCloseBtn: document.getElementById('labelsModalCloseBtn'),
  
  // Settings Modal
  settingsModal: document.getElementById('settingsModal'),
  loggedOutSection: document.getElementById('loggedOutSection'),
  loggedInSection: document.getElementById('loggedInSection'),
  extensionLoginBtn: document.getElementById('extensionLoginBtn'),
  loggedInNpub: document.getElementById('loggedInNpub'),
  loggedInMethod: document.getElementById('loggedInMethod'),
  syncNowBtn: document.getElementById('syncNowBtn'),
  logoutBtn: document.getElementById('logoutBtn'),
  settingsCloseBtn: document.getElementById('settingsCloseBtn'),
  relaysList: document.getElementById('relaysList'),
  newRelayInput: document.getElementById('newRelayInput'),
  addRelayBtn: document.getElementById('addRelayBtn'),
  themeDarkBtn: document.getElementById('themeDarkBtn'),
  themeOledBtn: document.getElementById('themeOledBtn'),
  
  // Popovers
  colorPickerPopup: document.getElementById('colorPickerPopup'),
  labelsPickerPopup: document.getElementById('labelsPickerPopup'),
  labelsPickerList: document.getElementById('labelsPickerList'),
  creatorCollaborateBtn: document.getElementById('creatorCollaborateBtn'),
  modalCollaborateBtn: document.getElementById('modalCollaborateBtn'),
  modalTypingBanner: document.getElementById('modalTypingBanner'),
  collaboratorsPickerPopup: document.getElementById('collaboratorsPickerPopup'),
  collaboratorsList: document.getElementById('collaboratorsList'),
  newCollaboratorInput: document.getElementById('newCollaboratorInput'),
  addCollaboratorBtn: document.getElementById('addCollaboratorBtn'),
  modalMoreBtn: document.getElementById('modalMoreBtn'),
  moreOptionsPopup: document.getElementById('moreOptionsPopup'),
  moreLabelBtn: document.getElementById('moreLabelBtn'),
  morePreviewBtn: document.getElementById('morePreviewBtn'),
  moreTrashBtn: document.getElementById('moreTrashBtn')
};

// =========================================================================
// PWA & SERVICE WORKER INITIALIZATION
// =========================================================================
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => console.log('Service Worker registered successfully!', reg.scope))
        .catch((err) => console.error('Service Worker registration failed:', err));
    });
  }
}

// =========================================================================
// APPLICATION STARTUP
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  
  // 1. Init Local Database
  try {
    await db.init();
    console.log('Database initialized.');
  } catch (err) {
    alert('Failed to initialize local offline database: ' + err.message);
    return;
  }
  
  // 2. Load stored layout settings
  const storedLayout = await db.getSetting('layout_mode', 'grid');
  setLayoutMode(storedLayout);
  
  // Load stored theme settings
  const storedTheme = await db.getSetting('theme_choice', 'dark');
  applyTheme(storedTheme);
  
  // 3. Load Labels and Notes from Local Storage
  await reloadLabelsCache();
  await reloadNotesCache();
  await updateInvitationsDot();
  
  // 4. Setup Nostr status callbacks and load active session
  nostr.setStatusCallback(handleSyncStatusChange);
  nostr.setRelayConnectedCallback(() => {
    if (state.syncTimeout) clearTimeout(state.syncTimeout);
    state.syncTimeout = setTimeout(() => {
      triggerNostrSync();
    }, 800);
  });
  
  try {
    const session = await nostr.loadSession(db);
    if (session) {
      console.log('Session restored successfully:', session.type);
      
      // Dynamic Database Isolation & Cache Hot-Reload
      await db.changeUser(session.pubkey);
      await reloadLabelsCache();
      await reloadNotesCache();
      await updateInvitationsDot();
      
      updateSettingsUI(true, session.pubkey, session.type);
      // Auto-connect and sync on session restore (triggers via onRelayConnected)
      nostr.connectRelays();
      nostr.startLiveSubscription();
    } else {
      console.log('No stored session found.');
      updateSettingsUI(false);
    }
  } catch (err) {
    console.error('Session loading failed:', err);
    updateSettingsUI(false);
  }
  
  // Render layout initial state
  renderWorkspace();
  
  // 5. Initialize Events
  initializeEventListeners();
});

// =========================================================================
// EVENT LISTENERS REGISTER
// =========================================================================
function initializeEventListeners() {
  // Mobile drawer controls
  DOM.menuToggle.addEventListener('click', toggleSidebar);
  DOM.sidebarBackdrop.addEventListener('click', toggleSidebar);
  
  // Navigation Routing
  DOM.navNotes.addEventListener('click', (e) => switchView(e, 'notes'));
  DOM.navInvitations.addEventListener('click', (e) => switchView(e, 'invitations'));
  DOM.navArchive.addEventListener('click', (e) => switchView(e, 'archive'));
  DOM.navTrash.addEventListener('click', (e) => switchView(e, 'trash'));
  
  // Edit labels trigger
  DOM.navEditLabels.addEventListener('click', (e) => {
    e.preventDefault();
    openModal(DOM.editLabelsModal);
    renderLabelManagerList();
    closeSidebarOnMobile();
  });
  DOM.labelsModalCloseBtn.addEventListener('click', () => {
    closeModal(DOM.editLabelsModal);
    renderSidebarLabels();
  });
  DOM.createLabelBtn.addEventListener('click', handleCreateNewLabel);
  DOM.newLabelInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleCreateNewLabel();
  });

  // Profile button opens settings modal
  DOM.profileBtn.addEventListener('click', () => {
    openModal(DOM.settingsModal);
    applyTheme(state.themeChoice);
  });
  DOM.settingsCloseBtn.addEventListener('click', () => closeModal(DOM.settingsModal));

  DOM.themeDarkBtn.addEventListener('click', () => {
    applyTheme('dark');
    db.setSetting('theme_choice', 'dark');
  });
  DOM.themeOledBtn.addEventListener('click', () => {
    applyTheme('oled');
    db.setSetting('theme_choice', 'oled');
  });

  // Settings gear button


  // Header sync/refresh button
  const syncNowBtnHeader = document.getElementById('syncNowBtnHeader');
  if (syncNowBtnHeader) {
    syncNowBtnHeader.addEventListener('click', () => {
      triggerNostrSync();
    });
  }
  
  // View layout mode (Grid vs List)
  DOM.viewToggle.addEventListener('click', () => {
    const newMode = state.layoutMode === 'grid' ? 'list' : 'grid';
    setLayoutMode(newMode);
    db.setSetting('layout_mode', newMode);
  });
  
  // Note Creator (Closed -> Open click) - desktop only
  DOM.creatorCollapsed.addEventListener('click', (e) => {
    e.stopPropagation();
    expandNoteCreator();
  });
  
  // Click outside Note Creator to save/collapse
  document.addEventListener('click', (e) => {
    const creator = DOM.noteCreator;
    const isClickInside = creator.contains(e.target);
    const isPopover = DOM.colorPickerPopup.contains(e.target) || DOM.labelsPickerPopup.contains(e.target);
    
    if (!isClickInside && !isPopover && creator.classList.contains('expanded')) {
      handleSaveNewNote();
    }
  });

  // Creator Controls
  DOM.creatorCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSaveNewNote(false);
  });
  DOM.creatorColorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'creator';
    state.activePopoverNoteId = null;
    togglePopover(DOM.colorPickerPopup, DOM.creatorColorBtn);
  });
  DOM.creatorLabelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'creator';
    state.activePopoverNoteId = null;
    togglePopover(DOM.labelsPickerPopup, DOM.creatorLabelBtn);
    renderLabelsPickerChecklist();
  });
  DOM.creatorArchiveBtn.addEventListener('click', () => {
    state.currentView = 'archive';
    handleSaveNewNote(true);
  });
  DOM.creatorPinBtn.addEventListener('click', () => {
    DOM.creatorPinBtn.classList.toggle('active');
    DOM.creatorPinBtn.style.color = DOM.creatorPinBtn.classList.contains('active') ? 'var(--icon-active)' : 'var(--icon-default)';
  });
  
  // Mobile FAB — opens edit modal in "new note" mode
  DOM.mobileFab.addEventListener('click', () => {
    openNewNoteModal();
  });

  // Edit Note Modal Click Actions
  DOM.modalCloseBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    handleSaveNoteModalChanges();
  });
  DOM.editNoteModal.addEventListener('click', (e) => {
    if (e.target === DOM.editNoteModal) {
      handleSaveNoteModalChanges();
    }
  });
  DOM.settingsModal.addEventListener('click', (e) => {
    if (e.target === DOM.settingsModal) {
      closeModal(DOM.settingsModal);
    }
  });
  DOM.editLabelsModal.addEventListener('click', (e) => {
    if (e.target === DOM.editLabelsModal) {
      closeModal(DOM.editLabelsModal);
    }
  });
  DOM.modalColorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'modal';
    state.activePopoverNoteId = state.activeEditNote ? state.activeEditNote.id : null;
    togglePopover(DOM.colorPickerPopup, DOM.modalColorBtn);
  });
  DOM.modalLabelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'modal';
    state.activePopoverNoteId = state.activeEditNote ? state.activeEditNote.id : null;
    togglePopover(DOM.labelsPickerPopup, DOM.modalLabelBtn);
    renderLabelsPickerChecklist();
  });
  DOM.modalArchiveBtn.addEventListener('click', async () => {
    if (!state.activeEditNote) return;
    state.activeEditNote.archived = !state.activeEditNote.archived;
    state.activeEditNote.updated_at = Date.now();
    await db.saveNote(state.activeEditNote);
    closeModal(DOM.editNoteModal);
    state.isNewNote = false;
    await reloadNotesCache();
    renderWorkspace();
    triggerNotePublish(state.activeEditNote);
  });
  DOM.modalPinBtn.addEventListener('click', () => {
    if (!state.activeEditNote) return;
    state.activeEditNote.pinned = !state.activeEditNote.pinned;
    DOM.modalPinBtn.style.color = state.activeEditNote.pinned ? 'var(--icon-active)' : 'var(--icon-default)';
  });
  DOM.modalPreviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleModalPreviewMode();
  });
  DOM.modalTrashBtn.addEventListener('click', async () => {
    if (!state.activeEditNote) return;
    
    if (state.activeEditNote.trash) {
      if (confirm('Delete this note permanently? This action cannot be undone.')) {
        state.activeEditNote.deleted = true;
        state.activeEditNote.updated_at = Date.now();
        await db.saveNote(state.activeEditNote);
        closeModal(DOM.editNoteModal);
        state.isNewNote = false;
        await reloadNotesCache();
        renderWorkspace();
        triggerNotePublish(state.activeEditNote);
      }
    } else {
      state.activeEditNote.trash = true;
      state.activeEditNote.pinned = false;
      state.activeEditNote.updated_at = Date.now();
      await db.saveNote(state.activeEditNote);
      closeModal(DOM.editNoteModal);
      state.isNewNote = false;
      await reloadNotesCache();
      renderWorkspace();
      triggerNotePublish(state.activeEditNote);
    }
  });

  // More Options (Three Dots) Modal Events
  DOM.modalMoreBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'modal';
    state.activePopoverNoteId = state.activeEditNote ? state.activeEditNote.id : null;
    togglePopover(DOM.moreOptionsPopup, DOM.modalMoreBtn);
  });
  DOM.moreLabelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePopover(DOM.moreOptionsPopup);
    state.popoverTriggerType = 'modal';
    state.activePopoverNoteId = state.activeEditNote ? state.activeEditNote.id : null;
    togglePopover(DOM.labelsPickerPopup, DOM.modalMoreBtn);
    renderLabelsPickerChecklist();
  });
  DOM.morePreviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePopover(DOM.moreOptionsPopup);
    toggleModalPreviewMode();
  });
  DOM.moreTrashBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    closePopover(DOM.moreOptionsPopup);
    if (!state.activeEditNote) return;
    
    if (state.activeEditNote.trash) {
      if (confirm('Delete this note permanently? This action cannot be undone.')) {
        state.activeEditNote.deleted = true;
        state.activeEditNote.updated_at = Date.now();
        await db.saveNote(state.activeEditNote);
        closeModal(DOM.editNoteModal);
        state.isNewNote = false;
        await reloadNotesCache();
        renderWorkspace();
        triggerNotePublish(state.activeEditNote);
      }
    } else {
      state.activeEditNote.trash = true;
      state.activeEditNote.pinned = false;
      state.activeEditNote.updated_at = Date.now();
      await db.saveNote(state.activeEditNote);
      closeModal(DOM.editNoteModal);
      state.isNewNote = false;
      await reloadNotesCache();
      renderWorkspace();
      triggerNotePublish(state.activeEditNote);
    }
  });

  // Search Filter
  DOM.searchBar.addEventListener('input', () => {
    renderWorkspace();
  });

  // Settings Identity Events
  DOM.extensionLoginBtn.addEventListener('click', handleExtensionLogin);
  DOM.logoutBtn.addEventListener('click', handleLogout);
  DOM.syncNowBtn.addEventListener('click', () => {
    triggerNostrSync();
    closeModal(DOM.settingsModal);
  });
  
  // Relays configuration events
  DOM.addRelayBtn.addEventListener('click', handleAddRelay);
  DOM.newRelayInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddRelay();
  });

  // Popover close clicks
  document.addEventListener('click', () => {
    closePopover(DOM.colorPickerPopup);
    closePopover(DOM.labelsPickerPopup);
    closePopover(DOM.collaboratorsPickerPopup);
  });

  // Color picker selection handler
  DOM.colorPickerPopup.querySelectorAll('.color-option').forEach(opt => {
    opt.addEventListener('click', async (e) => {
      const selectedColor = e.target.getAttribute('data-color');
      
      DOM.colorPickerPopup.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
      e.target.classList.add('selected');

      if (state.popoverTriggerType === 'creator') {
        state.activeColorSelection = selectedColor;
        setCreatorColor(selectedColor);
      } else if (state.popoverTriggerType === 'modal') {
        if (state.activeEditNote) {
          state.activeEditNote.color = selectedColor;
          setModalColor(selectedColor);
        }
      } else if (state.popoverTriggerType.startsWith('card-')) {
        const noteId = state.activePopoverNoteId;
        const note = state.allNotes.find(n => n.id === noteId);
        if (note) {
          note.color = selectedColor;
          note.updated_at = Date.now();
          await db.saveNote(note);
          await reloadNotesCache();
          renderWorkspace();
          triggerNotePublish(note);
        }
      }
    });
  });

  // Offline/Online triggers
  window.addEventListener('online', () => {
    console.log('Network back online. Reconnecting relays & syncing...');
    nostr.connectRelays();
    triggerNostrSync();
  });
  window.addEventListener('offline', () => {
    console.log('Network went offline.');
    handleSyncStatusChange({ status: 'offline', details: 'Offline (Pending Sync)' });
  });

  // Window resize to trigger masonry recalculation
  window.addEventListener('resize', () => {
    layoutMasonry();
  });

  // Sidebar transition listeners to trigger masonry recalculation
  DOM.sidebar.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'width') {
      layoutMasonry();
    }
  });
  DOM.appContainer.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'grid-template-columns' || e.propertyName === 'width') {
      layoutMasonry();
    }
  });

  // Collaboration triggers
  DOM.creatorCollaborateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'creator';
    state.activePopoverNoteId = null;
    togglePopover(DOM.collaboratorsPickerPopup, DOM.creatorCollaborateBtn);
    renderCollaboratorsPickerList();
  });
  
  DOM.modalCollaborateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    state.popoverTriggerType = 'modal';
    state.activePopoverNoteId = state.activeEditNote ? state.activeEditNote.id : null;
    togglePopover(DOM.collaboratorsPickerPopup, DOM.modalCollaborateBtn);
    renderCollaboratorsPickerList();
  });

  DOM.addCollaboratorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleAddCollaborator();
  });

  DOM.newCollaboratorInput.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  DOM.newCollaboratorInput.addEventListener('keypress', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleAddCollaborator();
    }
  });

  // Keyboard live sync
  DOM.modalTitle.addEventListener('input', handleRealtimeTypingInput);
  DOM.modalContent.addEventListener('input', handleRealtimeTypingInput);
}

// =========================================================================
// SIDEBAR COLLAPSIBLE ROUTINES
// =========================================================================
function toggleSidebar() {
  DOM.appContainer.classList.toggle('sidebar-expanded');
  
  if (window.innerWidth <= 900) {
    DOM.sidebar.classList.toggle('active');
    DOM.sidebarBackdrop.classList.toggle('active');
  }
}

function closeSidebarOnMobile() {
  if (window.innerWidth <= 900) {
    DOM.sidebar.classList.remove('active');
    DOM.sidebarBackdrop.classList.remove('active');
  }
}

// =========================================================================
// ROUTING VIEW SWITCHING
// =========================================================================
function switchView(e, viewName) {
  if (e) e.preventDefault();
  
  state.currentView = viewName;
  state.activeLabelFilter = null;
  
  DOM.sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const targetNav = document.getElementById(`nav${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`);
  if (targetNav) targetNav.classList.add('active');
  
  DOM.searchBar.value = '';
  collapseNoteCreator();
  renderWorkspace();
  closeSidebarOnMobile();
}

function switchViewToLabel(labelName) {
  state.currentView = `label-${labelName}`;
  state.activeLabelFilter = labelName;
  
  DOM.sidebar.querySelectorAll('.sidebar-item').forEach(item => {
    item.classList.remove('active');
  });
  
  const labelItem = DOM.sidebarLabelsContainer.querySelector(`[data-label-name="${labelName}"]`);
  if (labelItem) labelItem.classList.add('active');
  
  DOM.searchBar.value = '';
  collapseNoteCreator();
  renderWorkspace();
  closeSidebarOnMobile();
}

// =========================================================================
// DISPLAY LAYOUT CONFIG & DYNAMIC MASONRY
// =========================================================================
function setLayoutMode(mode) {
  state.layoutMode = mode;
  if (mode === 'grid') {
    DOM.gridIcon.style.display = 'block';
    DOM.listIcon.style.display = 'none';
    DOM.pinnedNotesGrid.className = 'notes-grid grid-view';
    DOM.othersNotesGrid.className = 'notes-grid grid-view';
  } else {
    DOM.gridIcon.style.display = 'none';
    DOM.listIcon.style.display = 'block';
    DOM.pinnedNotesGrid.className = 'notes-grid list-view';
    DOM.othersNotesGrid.className = 'notes-grid list-view';
  }
  layoutMasonry();
}

function layoutMasonry() {
  if (state.layoutMode !== 'grid') {
    const grids = [DOM.pinnedNotesGrid, DOM.othersNotesGrid];
    grids.forEach(gridEl => {
      if (!gridEl) return;
      gridEl.style.height = '';
      const cards = gridEl.querySelectorAll('.note-card');
      cards.forEach(card => {
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
      });
    });
    return;
  }

  const grids = [DOM.pinnedNotesGrid, DOM.othersNotesGrid];
  grids.forEach(gridEl => {
    if (!gridEl || gridEl.children.length === 0) {
      if (gridEl) gridEl.style.height = '';
      return;
    }

    const containerWidth = gridEl.clientWidth;
    if (containerWidth === 0) return;

    const isMobile = window.innerWidth <= 900;
    const gap = isMobile ? 10 : 16;
    const minColWidth = isMobile ? 160 : 240;

    let cols = Math.floor((containerWidth + gap) / (minColWidth + gap));
    cols = Math.max(1, cols);

    const colWidth = (containerWidth - (cols - 1) * gap) / cols;
    const colHeights = Array(cols).fill(0);

    const cards = gridEl.querySelectorAll('.note-card');
    cards.forEach(card => {
      card.style.position = 'absolute';
      card.style.width = `${colWidth}px`;

      let minColIndex = 0;
      let minHeight = colHeights[0];
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < minHeight) {
          minHeight = colHeights[i];
          minColIndex = i;
        }
      }

      const leftPosition = minColIndex * (colWidth + gap);
      const topPosition = minHeight;

      card.style.left = `${leftPosition}px`;
      card.style.top = `${topPosition}px`;

      const cardHeight = card.offsetHeight;
      colHeights[minColIndex] = topPosition + cardHeight + gap;
    });

    const maxColHeight = Math.max(...colHeights);
    gridEl.style.height = `${maxColHeight - gap}px`;
  });
}

// =========================================================================
// CACHE RELOADS
// =========================================================================
async function reloadLabelsCache() {
  state.allLabels = await db.getLabels();
  renderSidebarLabels();
}

async function reloadNotesCache() {
  state.allNotes = await db.getAllNotesRaw();
}

// =========================================================================
// SIDEBAR LABELS RENDERING
// =========================================================================
function renderSidebarLabels() {
  DOM.sidebarLabelsContainer.innerHTML = '';
  
  state.allLabels.forEach(lbl => {
    const item = document.createElement('a');
    item.href = '#';
    item.className = 'sidebar-item';
    item.setAttribute('data-label-name', lbl.name);
    if (state.currentView === `label-${lbl.name}`) {
      item.classList.add('active');
    }
    
    item.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z"/></svg>
      <span class="sidebar-label">${lbl.name}</span>
    `;
    
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchViewToLabel(lbl.name);
    });
    
    DOM.sidebarLabelsContainer.appendChild(item);
  });
}

// =========================================================================
// DESKTOP NOTE CREATOR CONTROLS
// =========================================================================
function expandNoteCreator() {
  DOM.noteCreator.classList.add('expanded');
  
  state.activeColorSelection = 'default';
  state.activeLabelsSelection = [];
  setCreatorColor('default');
  
  DOM.creatorContent.focus();
  DOM.creatorPinBtn.classList.remove('active');
  DOM.creatorPinBtn.style.color = 'var(--icon-default)';
  renderCreatorTags();
}

function collapseNoteCreator() {
  DOM.noteCreator.classList.remove('expanded');
  DOM.creatorTitle.value = '';
  DOM.creatorContent.value = '';
  DOM.creatorTagsDisplay.innerHTML = '';
  state.activeLabelsSelection = [];
  state.activeCollaboratorsSelection = [];
  state.activeColorSelection = 'default';
  setCreatorColor('default');
}

function setCreatorColor(color) {
  const isExpanded = DOM.noteCreator.classList.contains('expanded');
  DOM.noteCreator.className = 'note-creator';
  if (isExpanded) {
    DOM.noteCreator.classList.add('expanded');
  }
  if (color && color !== 'default') {
    DOM.noteCreator.classList.add(`color-${color}`);
  }
}

function renderCreatorTags() {
  DOM.creatorTagsDisplay.innerHTML = '';
  state.activeLabelsSelection.forEach(lbl => {
    const pill = document.createElement('span');
    pill.className = 'label-pill';
    pill.textContent = lbl;
    DOM.creatorTagsDisplay.appendChild(pill);
  });
}

async function handleSaveNewNote(archiveDirect = false) {
  const title = DOM.creatorTitle.value.trim();
  const content = DOM.creatorContent.value.trim();
  
  if (title === '' && content === '') {
    collapseNoteCreator();
    return;
  }

  const isPinned = DOM.creatorPinBtn.classList.contains('active');
  
  const newNote = {
    title,
    content,
    color: state.activeColorSelection,
    pinned: isPinned,
    archived: archiveDirect || state.currentView === 'archive',
    trash: false,
    labels: [...state.activeLabelsSelection],
    collaborators: [...(state.activeCollaboratorsSelection || [])],
    owner_pubkey: nostr.pubKey,
    updated_at: Date.now()
  };

  try {
    const saved = await db.saveNote(newNote, true);
    collapseNoteCreator();
    
    await reloadNotesCache();
    renderWorkspace();
    
    triggerNotePublish(saved);
    
    // Broadcast note to collaborators
    if (saved.collaborators && saved.collaborators.length > 0) {
      triggerCollaboratorNoteSync(saved, false);
    }
  } catch (err) {
    console.error('Failed to save note locally:', err);
  }
}

// =========================================================================
// MOBILE: OPEN NEW NOTE VIA MODAL
// =========================================================================
function openNewNoteModal() {
  const newNote = {
    id: generateUUID(),
    title: '',
    content: '',
    color: 'default',
    pinned: false,
    archived: false,
    trash: false,
    labels: [],
    updated_at: Date.now()
  };
  
  state.activeEditNote = newNote;
  state.isNewNote = true;
  state.activeLabelsSelection = [];
  state.activeColorSelection = 'default';
  
  DOM.modalTitle.value = '';
  DOM.modalContent.value = '';
  setModalColor('default');
  
  // Enable all controls for new note
  if (DOM.modalTitle) DOM.modalTitle.disabled = false;
  if (DOM.modalContent) DOM.modalContent.disabled = false;
  if (DOM.modalColorBtn) DOM.modalColorBtn.style.display = 'flex';
  if (DOM.modalLabelBtn) DOM.modalLabelBtn.style.display = 'flex';
  if (DOM.modalArchiveBtn) DOM.modalArchiveBtn.style.display = 'flex';
  if (DOM.modalPinBtn) {
    DOM.modalPinBtn.style.display = 'flex';
    DOM.modalPinBtn.style.color = 'var(--icon-default)';
  }
  if (DOM.modalTrashBtn) DOM.modalTrashBtn.setAttribute('title', 'Move to Trash');
  
  DOM.modalTagsDisplay.innerHTML = '';

  // Reset Markdown Preview Mode
  state.isPreviewMode = false;
  DOM.modalPreviewBtn.classList.remove('active');
  DOM.modalContent.style.display = 'block';
  DOM.modalContentPreview.style.display = 'none';
  DOM.modalContentPreview.innerHTML = '';

  openModal(DOM.editNoteModal);
  
  // Focus content on mobile (title is optional)
  setTimeout(() => DOM.modalContent.focus(), 100);
}

// =========================================================================
// NOTE WORKSPACE RENDER (MASONRY GRID FILTERING)
// =========================================================================
function renderWorkspace() {
  let notes = [];
  
  if (state.currentView === 'notes') {
    notes = state.allNotes.filter(n => !n.archived && !n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
  } else if (state.currentView === 'invitations') {
    notes = state.allNotes.filter(n => !n.deleted && n.accepted === 0);
  } else if (state.currentView === 'archive') {
    notes = state.allNotes.filter(n => n.archived && !n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
  } else if (state.currentView === 'trash') {
    notes = state.allNotes.filter(n => n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
  } else if (state.currentView.startsWith('label-')) {
    const label = state.activeLabelFilter;
    notes = state.allNotes.filter(n => n.labels.includes(label) && !n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
  }
  
  const query = DOM.searchBar.value.toLowerCase().trim();
  if (query !== '') {
    notes = notes.filter(n => 
      n.title.toLowerCase().includes(query) || 
      n.content.toLowerCase().includes(query) ||
      n.labels.some(l => l.toLowerCase().includes(query))
    );
  }

  DOM.pinnedNotesGrid.innerHTML = '';
  DOM.othersNotesGrid.innerHTML = '';
  
  if (notes.length === 0) {
    DOM.pinnedSection.style.display = 'none';
    DOM.othersSection.style.display = 'none';
    DOM.emptyState.style.display = 'block';
    return;
  }
  
  DOM.emptyState.style.display = 'none';
  
  const pinnedNotes = notes.filter(n => n.pinned && state.currentView !== 'archive');
  const otherNotes = notes.filter(n => !n.pinned || state.currentView === 'archive');
  
  if (pinnedNotes.length > 0) {
    DOM.pinnedSection.style.display = 'block';
    pinnedNotes.sort((a, b) => b.updated_at - a.updated_at);
    pinnedNotes.forEach(note => {
      DOM.pinnedNotesGrid.appendChild(createNoteCardDOM(note));
    });
  } else {
    DOM.pinnedSection.style.display = 'none';
  }

  if (otherNotes.length > 0) {
    DOM.othersSection.style.display = 'block';
    
    if (pinnedNotes.length > 0) {
      DOM.othersSectionTitle.style.display = 'block';
    } else {
      DOM.othersSectionTitle.style.display = 'none';
    }
    
    otherNotes.sort((a, b) => b.updated_at - a.updated_at);
    otherNotes.forEach(note => {
      DOM.othersNotesGrid.appendChild(createNoteCardDOM(note));
    });
  } else {
    DOM.othersSection.style.display = 'none';
  }

  layoutMasonry();
}

// =========================================================================
// NOTE CARD DOM GENERATOR
// =========================================================================
function createNoteCardDOM(note) {
  const card = document.createElement('div');
  card.className = 'note-card';
  card.setAttribute('data-id', note.id);
  
  if (note.color && note.color !== 'default') {
    card.classList.add(`color-${note.color}`);
  }
  if (note.pinned) {
    card.classList.add('pinned');
  }

  // Pin Button
  if (state.currentView !== 'invitations') {
    const pinBtn = document.createElement('button');
    pinBtn.className = 'icon-btn note-card-pin';
    pinBtn.setAttribute('title', note.pinned ? 'Unpin note' : 'Pin note');
    pinBtn.setAttribute('aria-label', note.pinned ? 'Unpin note' : 'Pin note');
    pinBtn.innerHTML = note.pinned 
      ? `<svg viewBox="0 0 24 24" fill="currentColor" style="color:var(--icon-active);"><path d="M17 4v7l2 3v2h-6v5l-1 1-1-1v-5H5v-2l2-3V4c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2z"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 4v7l2 3v2h-6v5l-1 1-1-1v-5H5v-2l2-3V4c0-1.1.9-2 2-2h6c1.1 0 2 .9 2 2z"/></svg>`;
    
    pinBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      note.pinned = !note.pinned;
      note.updated_at = Date.now();
      await db.saveNote(note);
      await reloadNotesCache();
      renderWorkspace();
      triggerNotePublish(note);
    });
    card.appendChild(pinBtn);
  }

  // Card body (clickable to open editor)
  const body = document.createElement('div');
  body.className = 'note-card-body';

  if (note.title) {
    const titleEl = document.createElement('div');
    titleEl.className = 'note-card-title';
    titleEl.textContent = note.title;
    body.appendChild(titleEl);
  }

  if (note.content) {
    const contentEl = document.createElement('div');
    contentEl.className = 'note-card-content';
    contentEl.innerHTML = renderMarkdown(note.content);
    body.appendChild(contentEl);
  }

  card.appendChild(body);

  if (state.currentView !== 'invitations' && note.labels && note.labels.length > 0) {
    const labelsEl = document.createElement('div');
    labelsEl.className = 'note-card-labels';
    note.labels.forEach(lbl => {
      const pill = document.createElement('span');
      pill.className = 'label-pill';
      pill.textContent = lbl;
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        switchViewToLabel(lbl);
      });
      labelsEl.appendChild(pill);
    });
    card.appendChild(labelsEl);
  }

  // Collaborators Avatars / Badge
  if (state.currentView !== 'invitations' && note.collaborators && note.collaborators.length > 0) {
    const collabsEl = document.createElement('div');
    collabsEl.className = 'collaborators-container';
    collabsEl.style.padding = '0 16px 8px';
    collabsEl.style.marginTop = '0';
    
    const badge = document.createElement('span');
    badge.className = 'collaborator-card-badge';
    badge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
      Shared
    `;
    collabsEl.appendChild(badge);

    note.collaborators.forEach(pubkey => {
      const bubble = document.createElement('div');
      bubble.className = 'collaborator-avatar';
      bubble.setAttribute('id', `bubble-${note.id}-${pubkey}`);
      bubble.textContent = pubkey.substring(0, 2).toUpperCase();
      bubble.style.width = '20px';
      bubble.style.height = '20px';
      bubble.style.fontSize = '8px';
      bubble.setAttribute('title', window.NostrTools.nip19.npubEncode(pubkey));
      
      nostr.fetchMetadata(pubkey, (profile) => {
        if (profile) {
          if (profile.picture) {
            bubble.innerHTML = `<img src="${profile.picture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
          }
          if (profile.name) {
            bubble.setAttribute('title', `${profile.name} (${window.NostrTools.nip19.npubEncode(pubkey).substring(0, 12)}...)`);
          }
        }
      });
      collabsEl.appendChild(bubble);
    });
    card.appendChild(collabsEl);
  }

  // Card Toolbar Actions
  if (state.currentView === 'invitations') {
    // Render Accept and Decline buttons at the bottom instead of regular toolbar actions
    const inviteActions = document.createElement('div');
    inviteActions.className = 'invite-card-actions';

    const declineBtn = document.createElement('button');
    declineBtn.className = 'editor-close-btn decline-btn';
    declineBtn.textContent = 'Decline';
    declineBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Decline and delete this shared note?')) {
        await db.deleteNotePermanently(note.id);
        await reloadNotesCache();
        updateInvitationsDot();
        renderWorkspace();
      }
    });

    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'editor-close-btn accept-btn';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      note.accepted = 1;
      note.updated_at = Date.now();
      await db.saveNote(note);
      await reloadNotesCache();
      updateInvitationsDot();
      renderWorkspace();
      
      // Let collaborator know we accepted
      triggerCollaboratorNoteSync(note, false);
    });

    inviteActions.appendChild(declineBtn);
    inviteActions.appendChild(acceptBtn);
    card.appendChild(inviteActions);
  } else {
    const toolbar = document.createElement('div');
    toolbar.className = 'note-card-actions';
    
    if (note.trash) {
      // Trashed notes ONLY show Restore and Delete Forever
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'icon-btn';
      restoreBtn.setAttribute('title', 'Restore');
      restoreBtn.setAttribute('aria-label', 'Restore');
      restoreBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 12c0 3.86-3.14 7-7 7s-7-3.14-7-7 3.14-7 7-7c1.93 0 3.68.78 4.95 2.05L14 10h7V3l-2.64 2.64C16.89 4.15 14.56 3 12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9h-2z"/></svg>`;
      restoreBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        note.trash = false;
        note.updated_at = Date.now();
        await db.saveNote(note);
        await reloadNotesCache();
        renderWorkspace();
        triggerNotePublish(note);
      });
      toolbar.appendChild(restoreBtn);

      const trashBtn = document.createElement('button');
      trashBtn.className = 'icon-btn';
      trashBtn.setAttribute('title', 'Delete forever');
      trashBtn.setAttribute('aria-label', 'Delete forever');
      trashBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
      trashBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Delete this note permanently? This action cannot be undone.')) {
          note.deleted = true;
          note.updated_at = Date.now();
          await db.saveNote(note);
          await reloadNotesCache();
          renderWorkspace();
          triggerNotePublish(note);
        }
      });
      toolbar.appendChild(trashBtn);
    } else {
      // Normal notes show full Keep edit toolbar
      const colorBtn = document.createElement('button');
      colorBtn.className = 'icon-btn';
      colorBtn.setAttribute('title', 'Background options');
      colorBtn.setAttribute('aria-label', 'Background options');
      colorBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0112 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 00-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 012.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z"/><circle cx="6.5" cy="11.5" r="1.5"/><circle cx="9.5" cy="7.5" r="1.5"/><circle cx="14.5" cy="7.5" r="1.5"/><circle cx="17.5" cy="11.5" r="1.5"/></svg>`;
      colorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.popoverTriggerType = `card-${note.id}`;
        state.activePopoverNoteId = note.id;
        togglePopover(DOM.colorPickerPopup, colorBtn);
      });
      toolbar.appendChild(colorBtn);

      const labelBtn = document.createElement('button');
      labelBtn.className = 'icon-btn';
      labelBtn.setAttribute('title', 'Add label');
      labelBtn.setAttribute('aria-label', 'Add label');
      labelBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z"/></svg>`;
      labelBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.popoverTriggerType = `card-${note.id}`;
        state.activePopoverNoteId = note.id;
        togglePopover(DOM.labelsPickerPopup, labelBtn);
        renderLabelsPickerChecklist();
      });
      toolbar.appendChild(labelBtn);

      const archiveBtn = document.createElement('button');
      archiveBtn.className = 'icon-btn';
      archiveBtn.setAttribute('title', note.archived ? 'Unarchive' : 'Archive');
      archiveBtn.setAttribute('aria-label', note.archived ? 'Unarchive' : 'Archive');
      archiveBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z"/></svg>`;
      archiveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        note.archived = !note.archived;
        note.updated_at = Date.now();
        await db.saveNote(note);
        await reloadNotesCache();
        renderWorkspace();
        triggerNotePublish(note);
      });
      toolbar.appendChild(archiveBtn);

      const trashBtn = document.createElement('button');
      trashBtn.className = 'icon-btn';
      trashBtn.setAttribute('title', 'Delete');
      trashBtn.setAttribute('aria-label', 'Delete');
      trashBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;
      trashBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        note.trash = true;
        note.pinned = false;
        note.updated_at = Date.now();
        await db.saveNote(note);
        await reloadNotesCache();
        renderWorkspace();
        triggerNotePublish(note);
      });
      toolbar.appendChild(trashBtn);
    }
    card.appendChild(toolbar);
  }

  // Pending Share Action Banner
  if (state.currentView === 'invitations') {
    const inviteBanner = document.createElement('div');
    inviteBanner.className = 'invite-action-banner';
    inviteBanner.style.display = 'flex';
    inviteBanner.style.padding = '8px 12px';
    inviteBanner.style.background = 'rgba(138, 180, 248, 0.06)';
    inviteBanner.style.borderBottom = '1px solid var(--border-card)';
    inviteBanner.style.alignItems = 'center';
    inviteBanner.style.justifyContent = 'flex-start';
    inviteBanner.style.boxSizing = 'border-box';
    inviteBanner.style.width = '100%';
    
    inviteBanner.innerHTML = `
      <span style="font-size:11px;font-weight:600;color:var(--accent-blue);letter-spacing:0.8px;text-transform:uppercase;">Incoming Share</span>
    `;
    
    card.insertBefore(inviteBanner, card.firstChild);
  }

  // Click card body to open in editor modal
  body.addEventListener('click', () => {
    openNoteEditModal(note);
  });
  body.style.cursor = 'pointer';

  return card;
}

// =========================================================================
// NOTE EDIT MODAL
// =========================================================================
function openNoteEditModal(note) {
  state.activeEditNote = note;
  state.isNewNote = false;
  DOM.modalTitle.value = note.title || '';
  DOM.modalContent.value = note.content || '';
  
  setModalColor(note.color);
  
  // Clean up any existing dynamic modal invite buttons first
  const toolbarContainer = DOM.modalCloseBtn.parentElement;
  toolbarContainer.querySelectorAll('.modal-invite-btn').forEach(btn => btn.remove());

  // Unaccepted invitation (pending share) or trashed note UI disable
  if (note.trash || note.accepted === 0) {
    if (DOM.modalTitle) DOM.modalTitle.disabled = true;
    if (DOM.modalContent) DOM.modalContent.disabled = true;
    if (DOM.modalColorBtn) DOM.modalColorBtn.style.display = 'none';
    if (DOM.modalLabelBtn) DOM.modalLabelBtn.style.display = 'none';
    if (DOM.modalArchiveBtn) DOM.modalArchiveBtn.style.display = 'none';
    if (DOM.modalPinBtn) DOM.modalPinBtn.style.display = 'none';
    if (DOM.modalTrashBtn) DOM.modalTrashBtn.style.display = 'none';
    if (DOM.modalCollaborateBtn) DOM.modalCollaborateBtn.style.display = 'none';
    if (DOM.modalPreviewBtn) DOM.modalPreviewBtn.style.display = 'none';
    if (DOM.modalMoreBtn) DOM.modalMoreBtn.style.display = 'none';

    if (note.accepted === 0) {
      // Add Accept & Decline buttons dynamically to the modal toolbar next to Close button
      const declineBtn = document.createElement('button');
      declineBtn.className = 'editor-close-btn modal-invite-btn';
      declineBtn.textContent = 'Decline';
      declineBtn.style.color = 'var(--text-secondary)';
      declineBtn.style.fontWeight = '500';
      declineBtn.style.cursor = 'pointer';
      declineBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm('Decline and delete this shared note?')) {
          closeModal(DOM.editNoteModal);
          await db.deleteNotePermanently(note.id);
          await reloadNotesCache();
          updateInvitationsDot();
          renderWorkspace();
        }
      });

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'editor-close-btn modal-invite-btn';
      acceptBtn.textContent = 'Accept';
      acceptBtn.style.color = 'var(--accent-blue)';
      acceptBtn.style.fontWeight = '600';
      acceptBtn.style.cursor = 'pointer';
      acceptBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        note.accepted = 1;
        note.updated_at = Date.now();
        await db.saveNote(note);
        closeModal(DOM.editNoteModal);
        await reloadNotesCache();
        updateInvitationsDot();
        renderWorkspace();
        
        // Let collaborator know we accepted
        triggerCollaboratorNoteSync(note, false);
      });

      // Insert them right before the Close button
      toolbarContainer.insertBefore(declineBtn, DOM.modalCloseBtn);
      toolbarContainer.insertBefore(acceptBtn, DOM.modalCloseBtn);
      
      DOM.modalCloseBtn.style.display = ''; // Show Close button for pending invitations modal
    }
  } else {
    if (DOM.modalTitle) DOM.modalTitle.disabled = false;
    if (DOM.modalContent) DOM.modalContent.disabled = false;
    if (DOM.modalColorBtn) DOM.modalColorBtn.style.display = 'flex';
    if (DOM.modalArchiveBtn) DOM.modalArchiveBtn.style.display = 'flex';
    if (DOM.modalPinBtn) {
      DOM.modalPinBtn.style.display = 'flex';
      DOM.modalPinBtn.style.color = note.pinned ? 'var(--icon-active)' : 'var(--icon-default)';
    }
    if (DOM.modalCollaborateBtn) DOM.modalCollaborateBtn.style.display = 'flex';

    // Delegate mobile visibility of these buttons to CSS rules (empty string lets CSS take over!)
    if (DOM.modalLabelBtn) DOM.modalLabelBtn.style.display = '';
    if (DOM.modalPreviewBtn) DOM.modalPreviewBtn.style.display = '';
    if (DOM.modalTrashBtn) {
      DOM.modalTrashBtn.style.display = '';
      DOM.modalTrashBtn.setAttribute('title', 'Move to Trash');
    }
    if (DOM.modalMoreBtn) DOM.modalMoreBtn.style.display = '';
    
    DOM.modalCloseBtn.style.display = 'none'; // Completely get rid of Close button for normal notes!
  }

  renderModalTags();

  // Reset Markdown Preview Mode
  state.isPreviewMode = false;
  DOM.modalPreviewBtn.classList.remove('active');
  DOM.modalContent.style.display = 'block';
  DOM.modalContentPreview.style.display = 'none';
  DOM.modalContentPreview.innerHTML = '';

  openModal(DOM.editNoteModal);
}

function setModalColor(color) {
  DOM.modalCard.className = 'modal-card';
  if (color && color !== 'default') {
    DOM.modalCard.classList.add(`color-${color}`);
  }
}

function renderModalTags() {
  DOM.modalTagsDisplay.innerHTML = '';
  if (state.activeEditNote && state.activeEditNote.labels) {
    state.activeEditNote.labels.forEach(lbl => {
      const pill = document.createElement('span');
      pill.className = 'label-pill';
      pill.textContent = lbl;
      DOM.modalTagsDisplay.appendChild(pill);
    });
  }
}

async function handleSaveNoteModalChanges() {
  if (!state.activeEditNote) {
    closeModal(DOM.editNoteModal);
    return;
  }

  // If the note is not accepted yet (pending invitation), just close without saving
  if (state.activeEditNote.accepted === 0) {
    closeModal(DOM.editNoteModal);
    state.activeEditNote = null;
    state.isNewNote = false;
    return;
  }

  const title = DOM.modalTitle.value.trim();
  const content = DOM.modalContent.value.trim();

  // If new note and both empty, just close
  if (state.isNewNote && title === '' && content === '') {
    closeModal(DOM.editNoteModal);
    state.activeEditNote = null;
    state.isNewNote = false;
    return;
  }

  // If existing note was cleared, trash it
  if (!state.isNewNote && title === '' && content === '' && (state.activeEditNote.title !== '' || state.activeEditNote.content !== '')) {
    state.activeEditNote.trash = true;
  } else {
    state.activeEditNote.title = title;
    state.activeEditNote.content = content;
  }

  state.activeEditNote.updated_at = Date.now();

  try {
    const saved = await db.saveNote(state.activeEditNote, true);
    closeModal(DOM.editNoteModal);
    state.activeEditNote = null;
    state.isNewNote = false;
    
    await reloadNotesCache();
    renderWorkspace();
    
    triggerNotePublish(saved);

    // Broadcast persistent note update to collaborators
    if (saved.collaborators && saved.collaborators.length > 0) {
      triggerCollaboratorNoteSync(saved, false);
    }
  } catch (err) {
    console.error(err);
  }
}

// =========================================================================
// GENERAL POPUPS AND OVERLAYS ROUTINES
// =========================================================================
function openModal(modalEl) {
  modalEl.classList.add('active');
}

function closeModal(modalEl) {
  modalEl.classList.remove('active');
}

function togglePopover(popoverEl, triggerEl) {
  const isActive = popoverEl.classList.contains('active');
  
  closePopover(DOM.colorPickerPopup);
  closePopover(DOM.labelsPickerPopup);
  
  if (isActive) return;

  popoverEl.classList.add('active');
  
  const triggerRect = triggerEl.getBoundingClientRect();
  const popoverRect = popoverEl.getBoundingClientRect();
  
  let top = triggerRect.bottom + 6;
  let left = triggerRect.left;

  if (left + popoverRect.width > window.innerWidth) {
    left = window.innerWidth - popoverRect.width - 12;
  }
  if (left < 8) left = 8;

  if (top + popoverRect.height > window.innerHeight) {
    top = triggerRect.top - popoverRect.height - 6;
  }

  popoverEl.style.top = `${top}px`;
  popoverEl.style.left = `${left}px`;
}

function closePopover(popoverEl) {
  popoverEl.classList.remove('active');
}

// =========================================================================
// LABELS DROPDOWN PICKER CHECKLIST RENDER
// =========================================================================
function renderLabelsPickerChecklist() {
  DOM.labelsPickerList.innerHTML = '';
  
  let activeNoteLabels = [];
  if (state.popoverTriggerType === 'creator') {
    activeNoteLabels = state.activeLabelsSelection;
  } else if (state.popoverTriggerType === 'modal') {
    activeNoteLabels = state.activeEditNote ? state.activeEditNote.labels : [];
  } else if (state.popoverTriggerType.startsWith('card-')) {
    const note = state.allNotes.find(n => n.id === state.activePopoverNoteId);
    activeNoteLabels = note ? note.labels : [];
  }

  if (state.allLabels.length === 0) {
    DOM.labelsPickerList.innerHTML = `
      <div style="font-size: 13px; color: var(--text-hint); padding: 8px 12px;">No labels found. Go to 'Edit Labels' in the sidebar to create categories.</div>
    `;
    return;
  }

  state.allLabels.forEach(lbl => {
    const item = document.createElement('div');
    item.className = 'checkbox-list-item';
    
    const isChecked = activeNoteLabels.includes(lbl.name);
    
    item.innerHTML = `
      <input type="checkbox" id="lblcheck-${lbl.id}" ${isChecked ? 'checked' : ''} style="cursor:pointer;">
      <label for="lblcheck-${lbl.id}" style="cursor:pointer; flex:1; user-select:none;">${lbl.name}</label>
    `;

    item.addEventListener('click', async (e) => {
      e.stopPropagation();
      const checkbox = item.querySelector('input');
      
      if (e.target !== checkbox) {
        checkbox.checked = !checkbox.checked;
      }
      
      const checked = checkbox.checked;
      
      if (state.popoverTriggerType === 'creator') {
        if (checked) {
          if (!state.activeLabelsSelection.includes(lbl.name)) state.activeLabelsSelection.push(lbl.name);
        } else {
          state.activeLabelsSelection = state.activeLabelsSelection.filter(l => l !== lbl.name);
        }
        renderCreatorTags();
      } else if (state.popoverTriggerType === 'modal') {
        if (state.activeEditNote) {
          if (checked) {
            if (!state.activeEditNote.labels.includes(lbl.name)) state.activeEditNote.labels.push(lbl.name);
          } else {
            state.activeEditNote.labels = state.activeEditNote.labels.filter(l => l !== lbl.name);
          }
          renderModalTags();
        }
      } else if (state.popoverTriggerType.startsWith('card-')) {
        const note = state.allNotes.find(n => n.id === state.activePopoverNoteId);
        if (note) {
          if (checked) {
            if (!note.labels.includes(lbl.name)) note.labels.push(lbl.name);
          } else {
            note.labels = note.labels.filter(l => l !== lbl.name);
          }
          note.updated_at = Date.now();
          await db.saveNote(note);
          await reloadNotesCache();
          renderWorkspace();
          triggerNotePublish(note);
        }
      }
    });

    DOM.labelsPickerList.appendChild(item);
  });
}

// =========================================================================
// SIDEBAR LABEL MANAGER
// =========================================================================
function renderLabelManagerList() {
  DOM.labelsManagerList.innerHTML = '';
  
  state.allLabels.forEach(lbl => {
    const item = document.createElement('div');
    item.className = 'label-manager-item';
    
    item.innerHTML = `
      <input type="text" value="${lbl.name}" data-id="${lbl.id}" data-old-name="${lbl.name}">
      <button class="icon-btn delete-lbl-btn" aria-label="Delete Label" style="color:#f28b82;"><svg viewBox="0 0 24 24" fill="currentColor" width="18"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg></button>
    `;

    const input = item.querySelector('input');
    
    const saveRename = async () => {
      const oldName = input.getAttribute('data-old-name');
      const newName = input.value.trim();
      if (newName !== '' && newName !== oldName) {
        const modifiedNotes = await db.renameLabel(lbl.id, oldName, newName);
        await reloadLabelsCache();
        await reloadNotesCache();
        
        for (const n of modifiedNotes) {
          triggerNotePublish(n);
        }

        renderWorkspace();
        renderLabelManagerList();
      }
    };
    
    input.addEventListener('blur', saveRename);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') input.blur();
    });

    item.querySelector('.delete-lbl-btn').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete label "${lbl.name}"? It will be removed from all notes.`)) {
        await db.deleteLabel(lbl.id);
        
        const all = await db.getAllNotesRaw();
        for (const n of all) {
          if (n.labels.includes(lbl.name)) {
            n.labels = n.labels.filter(l => l !== lbl.name);
            await db.saveNote(n, true);
            triggerNotePublish(n);
          }
        }
        
        if (state.currentView === `label-${lbl.name}`) {
          state.currentView = 'notes';
          state.activeLabelFilter = null;
          const targetNav = document.getElementById('navNotes');
          if (targetNav) {
            DOM.sidebar.querySelectorAll('.sidebar-item').forEach(el => el.classList.remove('active'));
            targetNav.classList.add('active');
          }
        }

        await reloadLabelsCache();
        await reloadNotesCache();
        renderWorkspace();
        renderLabelManagerList();
      }
    });

    DOM.labelsManagerList.appendChild(item);
  });
}

async function handleCreateNewLabel() {
  const name = DOM.newLabelInput.value.trim();
  if (name === '') return;
  
  await db.addLabel(name);
  DOM.newLabelInput.value = '';
  await reloadLabelsCache();
  renderLabelManagerList();
}

// =========================================================================
// NOSTR SYNCHRONIZATION AND CONTEXT WRAPPERS
// =========================================================================
function handleSyncStatusChange({ status, details }) {
  console.log(`Sync status: ${status} (${details})`);
  
  DOM.syncDot.className = 'sync-dot-badge';
  
  if (status === 'synced') {
    DOM.syncDot.classList.add('synced');
    DOM.syncText.textContent = 'Synced';
  } else if (status.startsWith('connecting') || status === 'syncing') {
    DOM.syncDot.classList.add('syncing');
    DOM.syncText.textContent = 'Syncing...';
  } else if (status === 'offline') {
    DOM.syncDot.classList.add('offline');
    DOM.syncText.textContent = details || 'Offline';
  } else if (status === 'logged_in') {
    DOM.syncDot.classList.add('synced');
    DOM.syncText.textContent = 'Logged In';
  } else {
    DOM.syncDot.classList.add('offline');
    DOM.syncText.textContent = 'Logged Out';
  }
}

function updateSettingsUI(isLoggedIn, pubkey = '', type = '') {
  if (isLoggedIn) {
    DOM.loggedOutSection.style.display = 'none';
    DOM.loggedInSection.style.display = 'block';
    
    let npub = pubkey;
    try {
      npub = window.NostrTools.nip19.npubEncode(pubkey);
    } catch (e) {
      console.error(e);
    }
    
    DOM.loggedInNpub.textContent = npub;
    DOM.loggedInMethod.textContent = type === 'extension' ? 'NIP-07 Browser Extension' : 'Nostr Session';
    
    // Profile: show deterministic colored circle with initials from pubkey
    updateProfileAvatar(pubkey);
  } else {
    DOM.loggedOutSection.style.display = 'block';
    DOM.loggedInSection.style.display = 'none';
    DOM.loggedInNpub.textContent = '';
    DOM.loggedInMethod.textContent = '';
    
    // Reset profile to default
    DOM.profileImg.style.display = 'none';
    DOM.profileInitials.style.display = 'flex';
    DOM.profileInitials.textContent = '?';
    DOM.profileBtn.style.background = '#5f6368';
  }
  
  renderRelaysList();
}

/**
 * Generate a profile avatar from pubkey (using kind 0 metadata if available)
 */
function updateProfileAvatar(pubkey) {
  if (!pubkey) return;
  
  // Try loading cached profile first
  const cacheKey = `nostr_keep_profile_${pubkey}`;
  const cached = localStorage.getItem(cacheKey);
  let hasImageOrName = false;
  if (cached) {
    try {
      const profile = JSON.parse(cached);
      hasImageOrName = displayUserProfile(profile);
    } catch(e) {}
  }
  
  if (!hasImageOrName) {
    // Fallback to deterministic initials/color from pubkey
    displayDeterministicAvatar(pubkey);
  }
  
  // Fetch fresh metadata from relays
  setTimeout(() => {
    nostr.fetchMetadata(pubkey, (profile) => {
      if (profile) {
        localStorage.setItem(cacheKey, JSON.stringify(profile));
        displayUserProfile(profile);
      }
    });
  }, 1200);
}

function displayUserProfile(profile) {
  if (!profile) return false;
  
  const name = profile.display_name || profile.name || profile.username || '';
  const picture = profile.picture || '';
  
  if (picture) {
    DOM.profileImg.src = picture;
    DOM.profileImg.style.display = 'block';
    DOM.profileInitials.style.display = 'none';
    DOM.profileBtn.style.background = 'transparent';
    return true;
  } else if (name) {
    const parts = name.trim().split(/\s+/);
    let initials = '';
    if (parts.length >= 2) {
      initials = (parts[0][0] + parts[1][0]).toUpperCase();
    } else if (parts[0]) {
      initials = parts[0].substring(0, 2).toUpperCase();
    }
    
    if (initials) {
      DOM.profileImg.style.display = 'none';
      DOM.profileInitials.style.display = 'flex';
      DOM.profileInitials.textContent = initials;
      
      // Deterministic background color from name
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
      }
      const hue = Math.abs(hash) % 360;
      DOM.profileBtn.style.background = `hsl(${hue}, 45%, 35%)`;
      return true;
    }
  }
  return false;
}

function displayDeterministicAvatar(pubkey) {
  // Generate a color from the first 4 hex chars
  const hue = parseInt(pubkey.substring(0, 4), 16) % 360;
  const bgColor = `hsl(${hue}, 45%, 35%)`;
  
  // Use first 2 chars of npub for initials
  let initials = pubkey.substring(0, 2).toUpperCase();
  try {
    const npub = window.NostrTools.nip19.npubEncode(pubkey);
    // Use chars 5-6 of npub (skip "npub1")
    initials = npub.substring(5, 7).toUpperCase();
  } catch(e) {}
  
  DOM.profileImg.style.display = 'none';
  DOM.profileInitials.style.display = 'flex';
  DOM.profileInitials.textContent = initials;
  DOM.profileBtn.style.background = bgColor;
}

/**
 * Triggers a full synchronization with Nostr Relays
 */
async function triggerNostrSync() {
  if (!nostr.pubKey) return;
  
  // 1. Push local dirty notes
  try {
    const dirtyNotes = await db.getDirtyNotes();
    if (dirtyNotes.length > 0) {
      console.log(`Sync: Publishing ${dirtyNotes.length} local modifications to relays...`);
      for (const note of dirtyNotes) {
        await nostr.publishNote(note);
        note.dirty = 0;
        await db.saveNote(note, false);
      }
    }
  } catch (err) {
    console.error('Failed to sync local modifications to Nostr relays:', err);
  }

  // 2. Fetch and merge all notes from relays
  try {
    await nostr.fetchNotes(
      async (remoteNote) => {
        try {
          const localNote = state.allNotes.find(n => n.id === remoteNote.id);
          
          if (!localNote) {
            // New note from relay
            await db.saveNote(remoteNote, false);
            // Ensure remote note's labels exist in local labels DB
            if (remoteNote.labels && Array.isArray(remoteNote.labels)) {
              for (const label of remoteNote.labels) {
                await db.addLabel(label);
              }
            }
          } else if (remoteNote.updated_at > localNote.updated_at) {
            // Remote is newer
            remoteNote.dirty = 0;
            await db.saveNote(remoteNote, false);
            // Ensure remote note's labels exist in local labels DB
            if (remoteNote.labels && Array.isArray(remoteNote.labels)) {
              for (const label of remoteNote.labels) {
                await db.addLabel(label);
              }
            }
          }
        } catch (e) {
          console.error('Merge error for remote note:', e);
        }
      },
      async () => {
        // On complete
        await reloadLabelsCache();
        await reloadNotesCache();
        renderWorkspace();
        console.log('Sync from relays complete.');
      }
    );
  } catch (err) {
    console.error('Failed to fetch notes from relays:', err);
  }
}

/**
 * Publishes a single note to Nostr relays in the background
 */
function triggerNotePublish(note) {
  if (!nostr.pubKey) return;
  
  nostr.publishNote(note).catch(err => {
    console.error('Background publish failed:', err);
  });
}

// =========================================================================
// NOSTR IDENTITY HANDLERS
// =========================================================================
async function handleExtensionLogin() {
  try {
    const login = await nostr.loginWithExtension();
    
    // Dynamic Database Isolation & Cache Hot-Reload
    await db.changeUser(login.pubkey);
    await reloadLabelsCache();
    await reloadNotesCache();
    await updateInvitationsDot();
    
    await db.setSetting('login_type', 'extension');
    
    updateSettingsUI(true, login.pubkey, 'extension');
    
    // Auto-connect (will trigger sync on connect via listener)
    nostr.connectRelays();
    nostr.startLiveSubscription();
    
    closeModal(DOM.settingsModal);
    
    // Rerender workspace to show new isolated user's notes immediately
    renderWorkspace();
  } catch (e) {
    alert('Extension login failed: ' + e.message);
  }
}

async function handleLogout() {
  if (confirm('Are you sure you want to log out? Your local offline notes will remain, but relay sync will stop.')) {
    nostr.logout();
    
    // Dynamic Database Isolation & Cache Hot-Reload (Switch back to default local DB)
    await db.changeUser(null);
    await reloadLabelsCache();
    await reloadNotesCache();
    await updateInvitationsDot();
    
    await db.setSetting('login_type', 'none');
    await db.setSetting('encrypted_privkey', null);
    
    updateSettingsUI(false);
    handleSyncStatusChange({ status: 'logged_out' });
    
    // Rerender workspace to show local notes immediately
    renderWorkspace();
  }
}

// =========================================================================
// RELAYS CONFIG MANAGER
// =========================================================================
function renderRelaysList() {
  DOM.relaysList.innerHTML = '';
  
  nostr.relays.forEach(url => {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    row.style.background = '#303134';
    row.style.padding = '8px 12px';
    row.style.borderRadius = '4px';
    row.style.border = '1px solid var(--border-card)';
    
    const socket = nostr.sockets.get(url);
    const isConnected = socket && socket.readyState === WebSocket.OPEN;
    
    row.innerHTML = `
      <div style="display:flex; align-items:center; gap: 8px; min-width:0; flex:1;">
        <span style="width: 8px; height: 8px; border-radius:50%; background-color:${isConnected ? '#34a853' : '#5f6368'}; flex-shrink:0;"></span>
        <span style="font-size:12px; font-family:monospace; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${url}</span>
      </div>
      <button class="icon-btn remove-relay-btn" data-url="${url}" style="color:#f28b82;width:28px;height:28px;" aria-label="Remove Relay">
        <svg viewBox="0 0 24 24" fill="currentColor" width="14"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
      </button>
    `;
    
    row.querySelector('.remove-relay-btn').addEventListener('click', async () => {
      const urlToRemove = row.querySelector('.remove-relay-btn').getAttribute('data-url');
      if (confirm(`Remove relay ${urlToRemove}?`)) {
        nostr.relays = nostr.relays.filter(u => u !== urlToRemove);
        await db.setSetting('custom_relays', nostr.relays);
        nostr.connectRelays();
        renderRelaysList();
      }
    });
    
    DOM.relaysList.appendChild(row);
  });
}

async function handleAddRelay() {
  const url = DOM.newRelayInput.value.trim();
  if (url === '' || !url.startsWith('wss://')) {
    alert('Please enter a valid secure relay URL starting with wss://');
    return;
  }
  
  if (nostr.relays.includes(url)) {
    alert('Relay already configured');
    return;
  }
  
  nostr.relays.push(url);
  await db.setSetting('custom_relays', nostr.relays);
  DOM.newRelayInput.value = '';
  nostr.connectRelays();
  renderRelaysList();
}

// =========================================================================
// COLLABORATION AND REAL-TIME SYNC ENGINE (NIP-59)
// =========================================================================

// Initialize active collaboration state
state.activeCollaboratorsSelection = [];
state.onlineCollaborators = new Set();

function renderCollaboratorsPickerList() {
  DOM.collaboratorsList.innerHTML = '';
  
  let collaborators = [];
  if (state.popoverTriggerType === 'creator') {
    collaborators = state.activeCollaboratorsSelection || [];
  } else {
    collaborators = state.activeEditNote ? (state.activeEditNote.collaborators || []) : [];
  }
  
  if (collaborators.length === 0) {
    DOM.collaboratorsList.innerHTML = `<div style="font-size:12px;color:var(--text-hint);text-align:center;padding:12px 0;">No collaborators added yet</div>`;
    return;
  }
  
  collaborators.forEach(pubkey => {
    const item = document.createElement('div');
    item.className = 'collaborator-item';
    item.style.marginBottom = '6px';
    
    const npub = window.NostrTools.nip19.npubEncode(pubkey);
    const shortPub = npub.substring(0, 10) + '...' + npub.substring(npub.length - 6);
    
    const isOnline = state.onlineCollaborators.has(pubkey);
    
    item.innerHTML = `
      <div class="collaborator-info">
        <div class="collaborator-avatar" id="avatar-${pubkey}">${pubkey.substring(0, 2).toUpperCase()}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="name-${pubkey}">Collaborator</div>
          <div class="collaborator-pubkey" title="${npub}">${shortPub}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span class="collaborator-presence ${isOnline ? 'online' : ''}" id="presence-${pubkey}"></span>
        <button class="remove-collaborator-btn" data-pubkey="${pubkey}" title="Remove collaborator">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
        </button>
      </div>
    `;
    
    nostr.fetchMetadata(pubkey, (profile) => {
      const avatarEl = item.querySelector(`#avatar-${pubkey}`);
      const nameEl = item.querySelector(`#name-${pubkey}`);
      if (profile) {
        if (profile.picture && avatarEl) {
          avatarEl.innerHTML = `<img src="${profile.picture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;" alt="">`;
        } else if (profile.name && avatarEl) {
          avatarEl.textContent = profile.name.substring(0, 2).toUpperCase();
        }
        if (profile.name && nameEl) {
          nameEl.textContent = profile.name;
        }
      }
    });
    
    item.querySelector('.remove-collaborator-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const pkToRemove = e.currentTarget.getAttribute('data-pubkey');
      if (state.popoverTriggerType === 'creator') {
        state.activeCollaboratorsSelection = (state.activeCollaboratorsSelection || []).filter(k => k !== pkToRemove);
        renderCollaboratorsPickerList();
      } else {
        if (state.activeEditNote) {
          state.activeEditNote.collaborators = (state.activeEditNote.collaborators || []).filter(k => k !== pkToRemove);
          state.activeEditNote.updated_at = Date.now();
          await db.saveNote(state.activeEditNote);
          await reloadNotesCache();
          renderWorkspace();
          renderCollaboratorsPickerList();
          
          triggerCollaboratorNoteSync(state.activeEditNote, false);
        }
      }
    });
    
    DOM.collaboratorsList.appendChild(item);
  });
}

async function handleAddCollaborator() {
  let input = DOM.newCollaboratorInput.value.trim();
  if (!input) return;
  
  let hexPub = input.toLowerCase();
  if (input.startsWith('npub')) {
    try {
      const decoded = window.NostrTools.nip19.decode(input);
      if (decoded.type === 'npub') {
        hexPub = decoded.data.toLowerCase();
      } else {
        alert('Invalid npub string');
        return;
      }
    } catch (err) {
      alert('Failed to decode npub: ' + err.message);
      return;
    }
  }
  
  if (!/^[0-9a-fA-F]{64}$/.test(hexPub)) {
    alert('Invalid Nostr public key format. Must be a 64-character hex string or npub.');
    return;
  }
  
  if (hexPub === nostr.pubKey) {
    alert("You cannot add yourself as a collaborator.");
    return;
  }
  
  if (state.popoverTriggerType === 'creator') {
    if (!state.activeCollaboratorsSelection) {
      state.activeCollaboratorsSelection = [];
    }
    if (state.activeCollaboratorsSelection.includes(hexPub)) {
      alert('Collaborator already added.');
      return;
    }
    state.activeCollaboratorsSelection.push(hexPub);
    DOM.newCollaboratorInput.value = '';
    renderCollaboratorsPickerList();
  } else {
    if (!state.activeEditNote) return;
    if (!state.activeEditNote.collaborators) {
      state.activeEditNote.collaborators = [];
    }
    if (state.activeEditNote.collaborators.includes(hexPub)) {
      alert('Collaborator already added.');
      return;
    }
    
    state.activeEditNote.collaborators.push(hexPub);
    state.activeEditNote.updated_at = Date.now();
    await db.saveNote(state.activeEditNote);
    await reloadNotesCache();
    renderWorkspace();
    DOM.newCollaboratorInput.value = '';
    renderCollaboratorsPickerList();
    
    triggerCollaboratorNoteSync(state.activeEditNote, false);
  }
}

async function triggerCollaboratorNoteSync(note, isPatch = false) {
  if (!nostr.pubKey) return;

  // Compute recipients: owner + all collaborators, excluding ourselves
  const ownerPubkey = note.owner_pubkey || nostr.pubKey;
  const collaborators = note.collaborators || [];
  const allParties = [...new Set([ownerPubkey, ...collaborators])];
  const recipients = allParties.filter(pk => pk !== nostr.pubKey);

  if (recipients.length === 0) return;

  const rumor = {
    pubkey: nostr.pubKey,
    kind: 30078,
    created_at: Math.floor((note.updated_at || Date.now()) / 1000),
    tags: [
      ['d', `nostr-keep-note-${note.id}`],
      ['owner', ownerPubkey],
      ['type', isPatch ? 'patch' : 'full']
    ],
    content: JSON.stringify({
      title: note.title || '',
      content: note.content || '',
      color: note.color || '#202124',
      pinned: note.pinned === 1 || note.pinned === true,
      archived: note.archived === 1 || note.archived === true,
      trash: note.trash === 1 || note.trash === true,
      labels: note.labels || [],
      updated_at: note.updated_at || Date.now(),
      collaborators: collaborators,
      owner_pubkey: ownerPubkey
    })
  };

  console.log(`[COLLAB] ${isPatch ? 'PATCH' : 'FULL'} sync for note ${note.id} → recipients:`, recipients);

  for (const recipient of recipients) {
    try {
      // Always use kind:1059 (non-ephemeral) — ephemeral events are unreliable on most relays
      const wrapped = await nostr.wrapEvent(rumor, recipient, false);
      nostr._broadcast(wrapped);
    } catch (err) {
      console.error(`[COLLAB] Failed to wrap/send to ${recipient}:`, err);
    }
  }
}

// Debounced real-time typing sync (500ms after last keystroke)
let typingSyncTimeout = null;
function handleRealtimeTypingInput() {
  const editNote = state.activeEditNote;
  if (!editNote) return;

  // Only sync if there are remote parties involved
  const ownerPubkey = editNote.owner_pubkey || nostr.pubKey;
  const collaborators = editNote.collaborators || [];
  const allParties = [...new Set([ownerPubkey, ...collaborators])];
  if (!allParties.some(pk => pk !== nostr.pubKey)) return;

  if (typingSyncTimeout) clearTimeout(typingSyncTimeout);

  typingSyncTimeout = setTimeout(() => {
    // Snapshot current modal values into the note
    editNote.title = DOM.modalTitle.value;
    editNote.content = DOM.modalContent.value;
    editNote.updated_at = Date.now();
    if (!editNote.owner_pubkey) editNote.owner_pubkey = nostr.pubKey;

    // Send as a patch (live typing update)
    triggerCollaboratorNoteSync(editNote, true);
  }, 500);
}

let typingBannerTimeout = null;
function showTypingBanner(pubkey) {
  if (typingBannerTimeout) clearTimeout(typingBannerTimeout);
  
  // Set online presence
  state.onlineCollaborators.add(pubkey);
  
  DOM.modalTypingBanner.style.display = 'flex';
  DOM.modalTypingBanner.textContent = 'Collaborator is typing...';
  
  nostr.fetchMetadata(pubkey, (profile) => {
    if (profile && profile.name) {
      DOM.modalTypingBanner.textContent = `${profile.name} is typing...`;
    }
  });
  
  typingBannerTimeout = setTimeout(() => {
    DOM.modalTypingBanner.style.display = 'none';
  }, 2000);
}

// Hook incoming live updates callback
nostr.onLiveUpdate = async (update) => {
  if (update.type === 'note') {
    // Our own kind:30078 note event received back from relay
    const existing = state.allNotes.find(n => n.id === update.note.id);
    if (!existing || update.note.updated_at > existing.updated_at) {
      await db.saveNote(update.note, false);
      await reloadNotesCache();
      renderWorkspace();
    }
    return;
  }

  if (update.type !== 'rumor') return;

  const rumor = update.rumor;
  const typeTag = rumor.tags ? rumor.tags.find(t => t[0] === 'type') : null;
  const isPatch = typeTag && typeTag[1] === 'patch';

  const dTag = rumor.tags ? rumor.tags.find(t => t[0] === 'd') : null;
  if (!dTag || !dTag[1].startsWith('nostr-keep-note-')) return;

  const noteId = dTag[1].replace('nostr-keep-note-', '');

  try {
    const incomingNote = JSON.parse(rumor.content);
    incomingNote.id = noteId;

    const existingNote = state.allNotes.find(n => n.id === noteId);
    const ownerPubkey = incomingNote.owner_pubkey || rumor.sender_pubkey;

    // Determine invitation/acceptance state
    if (!existingNote && ownerPubkey !== nostr.pubKey) {
      incomingNote.accepted = 0; // New pending invitation
    } else if (existingNote) {
      incomingNote.accepted = existingNote.accepted;
    } else {
      incomingNote.accepted = 1; // We are the owner
    }

    // Track online collaborator presence
    if (rumor.sender_pubkey) {
      state.onlineCollaborators.add(rumor.sender_pubkey);
      if (DOM.collaboratorsPickerPopup.classList.contains('active')) {
        renderCollaboratorsPickerList();
      }
    }

    // Owner fan-out: relay collab changes to all other collaborators
    if (ownerPubkey === nostr.pubKey && rumor.sender_pubkey && rumor.sender_pubkey !== nostr.pubKey) {
      const otherCollabs = (incomingNote.collaborators || []).filter(
        pk => pk !== nostr.pubKey && pk !== rumor.sender_pubkey
      );
      if (otherCollabs.length > 0) {
        triggerCollaboratorNoteSync(
          { ...incomingNote, owner_pubkey: nostr.pubKey },
          isPatch
        );
      }
    }

    // ── Live modal update ──────────────────────────────────────────────────
    // If this note is currently open in the editor, apply changes immediately
    const modalIsOpen = state.activeEditNote && state.activeEditNote.id === noteId;
    if (modalIsOpen) {
      // Preserve cursor positions while updating content
      if (DOM.modalTitle.value !== incomingNote.title) {
        const s = DOM.modalTitle.selectionStart, e = DOM.modalTitle.selectionEnd;
        DOM.modalTitle.value = incomingNote.title;
        try { DOM.modalTitle.setSelectionRange(s, e); } catch(_) {}
      }
      if (DOM.modalContent.value !== incomingNote.content) {
        const s = DOM.modalContent.selectionStart, e = DOM.modalContent.selectionEnd;
        DOM.modalContent.value = incomingNote.content;
        try { DOM.modalContent.setSelectionRange(s, e); } catch(_) {}
      }
      // Always show the typing banner for any incoming collab update
      if (rumor.sender_pubkey) showTypingBanner(rumor.sender_pubkey);
      state.activeEditNote = { ...state.activeEditNote, ...incomingNote };
    }
    // ──────────────────────────────────────────────────────────────────────

    // For patches, skip full workspace re-render to avoid UI flicker
    // For full saves, always re-render cards
    if (isPatch) {
      // Save quietly but don't re-render the card grid
      incomingNote.dirty = 0;
      await db.saveNote(incomingNote, false);
      // Update in-memory note list without re-render
      const idx = state.allNotes.findIndex(n => n.id === noteId);
      if (idx >= 0) state.allNotes[idx] = { ...state.allNotes[idx], ...incomingNote };
      else state.allNotes.unshift(incomingNote);
    } else {
      // Full save — always persist and re-render
      if (!existingNote || incomingNote.updated_at >= existingNote.updated_at) {
        incomingNote.dirty = 0;
        await db.saveNote(incomingNote, false);
        await reloadNotesCache();
        updateInvitationsDot();
        renderWorkspace();
      }
    }
  } catch (err) {
    console.error('[COLLAB] Failed to process incoming rumor for note', noteId, err);
  }
};

async function updateInvitationsDot() {
  const pending = await db.getPendingInvitations();
  if (pending && pending.length > 0) {
    DOM.invitationsDot.style.display = 'block';
  } else {
    DOM.invitationsDot.style.display = 'none';
  }
}
