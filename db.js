/**
 * Nostr Keep - IndexedDB Database Layer
 * Provides robust offline storage for notes, labels, and settings.
 */

export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

class NostrKeepDB {
  constructor() {
    this.dbName = 'nostr_keep_db';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * Initializes the IndexedDB instance
   */
  async init() {
    if (this.db) return this.db;

    // Isolate database per user pubkey if logged in to allow separate browser sandbox
    const loginType = localStorage.getItem('nostr_keep_login_type');
    const pubkey = localStorage.getItem('nostr_keep_pubkey');
    if (loginType && loginType !== 'none' && pubkey) {
      this.dbName = `nostr_keep_db_${pubkey.toLowerCase()}`;
    } else {
      this.dbName = 'nostr_keep_db';
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (e) => {
        console.error('Database failed to open:', e.target.error);
        reject(e.target.error);
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Notes Store
        if (!db.objectStoreNames.contains('notes')) {
          const notesStore = db.createObjectStore('notes', { keyPath: 'id' });
          notesStore.createIndex('updated_at', 'updated_at', { unique: false });
          notesStore.createIndex('dirty', 'dirty', { unique: false });
          notesStore.createIndex('trash', 'trash', { unique: false });
          notesStore.createIndex('archived', 'archived', { unique: false });
          notesStore.createIndex('pinned', 'pinned', { unique: false });
        }

        // Labels Store
        if (!db.objectStoreNames.contains('labels')) {
          const labelsStore = db.createObjectStore('labels', { keyPath: 'id', autoIncrement: true });
          labelsStore.createIndex('name', 'name', { unique: true });
        }

        // Settings Store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };
    });
  }

  /**
   * Closes the active database connection, shifts the database target name, and opens it
   */
  async changeUser(pubkey) {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    if (pubkey) {
      this.dbName = `nostr_keep_db_${pubkey.toLowerCase()}`;
    } else {
      this.dbName = 'nostr_keep_db';
    }
    console.log(`[DB] Context swapper: Switching database target to ${this.dbName}`);
    return await this.init();
  }

  /**
   * Helper to perform database transaction
   */
  _transaction(storeName, mode = 'readonly') {
    if (!this.db) throw new Error('Database is not initialized. Call init() first.');
    const transaction = this.db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    return { store, transaction };
  }

  // =========================================================================
  // NOTES OPERATIONS
  // =========================================================================

  /**
   * Get a note by ID
   */
  async getNote(id) {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Save (Insert/Update) a note
   * @param {Object} note - The note object
   * @param {boolean} setDirty - Whether to mark this change as needing sync (offline queue)
   */
  async saveNote(note, setDirty = true) {
    if (!note.id) {
      note.id = generateUUID();
    }
    
    // Normalize fields
    const updatedNote = {
      id: note.id,
      title: note.title || '',
      content: note.content || '',
      color: note.color || '#202124',
      pinned: note.pinned ? 1 : 0,
      archived: note.archived ? 1 : 0,
      trash: note.trash ? 1 : 0,
      labels: Array.isArray(note.labels) ? note.labels : [],
      updated_at: note.updated_at || Date.now(),
      dirty: setDirty ? 1 : 0,
      deleted: note.deleted ? 1 : 0,
      collaborators: Array.isArray(note.collaborators) ? note.collaborators : [],
      owner_pubkey: note.owner_pubkey || null,
      parent_note_id: note.parent_note_id || null,
      accepted: note.accepted !== undefined ? (note.accepted ? 1 : 0) : 1
    };

    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readwrite');
      const request = store.put(updatedNote);
      request.onsuccess = () => resolve(updatedNote);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Permanently delete a note from local database
   */
  async deleteNotePermanently(id) {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all active (non-archived, non-trashed, non-deleted) notes
   */
  async getActiveNotes() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const allNotes = request.result || [];
        // Filter out archived, trashed, locally deleted, or pending notes
        const active = allNotes.filter(n => !n.archived && !n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
        resolve(active);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get archived notes
   */
  async getArchivedNotes() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const allNotes = request.result || [];
        const archived = allNotes.filter(n => n.archived && !n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
        resolve(archived);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get trashed notes
   */
  async getTrashedNotes() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const allNotes = request.result || [];
        const trashed = allNotes.filter(n => n.trash && !n.deleted && (n.accepted === undefined || n.accepted === 1));
        resolve(trashed);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all pending collaborative note invitations
   */
  async getPendingInvitations() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const allNotes = request.result || [];
        const pending = allNotes.filter(n => !n.deleted && n.accepted === 0);
        resolve(pending);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all notes (including dirty/deleted) for sync purposes
   */
  async getAllNotesRaw() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all notes marked as dirty (unsynced changes)
   */
  async getDirtyNotes() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('notes', 'readonly');
      const index = store.index('dirty');
      const request = index.getAll(1);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  // =========================================================================
  // LABELS OPERATIONS
  // =========================================================================

  /**
   * Get all labels
   */
  async getLabels() {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('labels', 'readonly');
      const request = store.getAll();
      request.onsuccess = () => {
        const labels = request.result || [];
        // Sort alphabetically
        labels.sort((a, b) => a.name.localeCompare(b.name));
        resolve(labels);
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get a label by name
   */
  async getLabelByName(name) {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('labels', 'readonly');
      const index = store.index('name');
      const request = index.get(name);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Add a new label
   */
  async addLabel(name) {
    if (!name || name.trim() === '') return null;
    const cleanName = name.trim();

    // Check if label already exists to avoid Transaction Abort / ConstraintError
    const existing = await this.getLabelByName(cleanName);
    if (existing) return existing;

    return new Promise((resolve, reject) => {
      const { store } = this._transaction('labels', 'readwrite');
      const request = store.add({ name: cleanName });
      request.onsuccess = (e) => {
        resolve({ id: e.target.result, name: cleanName });
      };
      request.onerror = (e) => {
        reject(e.target.error);
      };
    });
  }

  /**
   * Delete a label
   */
  async deleteLabel(id) {
    return new Promise((resolve, reject) => {
      const { store } = this._transaction('labels', 'readwrite');
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Rename a label and update it across all notes
   */
  async renameLabel(id, oldName, newName) {
    if (!newName || newName.trim() === '') return [];
    const cleanNewName = newName.trim();

    // 1. Update Label Store
    await new Promise((resolve, reject) => {
      const { store } = this._transaction('labels', 'readwrite');
      const request = store.put({ id, name: cleanNewName });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });

    // 2. Update Notes that reference this label
    const modified = [];
    const allNotes = await this.getAllNotesRaw();
    for (const note of allNotes) {
      if (note.labels.includes(oldName)) {
        note.labels = note.labels.map(l => l === oldName ? cleanNewName : l);
        const saved = await this.saveNote(note, true); // Mark as dirty since tag renamed!
        modified.push(saved);
      }
    }

    return modified;
  }

  // =========================================================================
  // SETTINGS OPERATIONS
  // =========================================================================

  /**
   * Get a settings value
   */
  async getSetting(key, defaultValue = null) {
    // Try localStorage first for instant synchronous cache
    const cached = localStorage.getItem('nostr_keep_' + key);
    if (cached !== null) {
      try {
        return JSON.parse(cached);
      } catch (e) {
        return cached;
      }
    }

    return new Promise((resolve, reject) => {
      const { store } = this._transaction('settings', 'readonly');
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result) {
          // Sync back to localStorage
          try {
            localStorage.setItem('nostr_keep_' + key, JSON.stringify(request.result.value));
          } catch(e) {
            localStorage.setItem('nostr_keep_' + key, request.result.value);
          }
          resolve(request.result.value);
        } else {
          resolve(defaultValue);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Set a settings value
   */
  async setSetting(key, value) {
    // Write to localStorage
    try {
      localStorage.setItem('nostr_keep_' + key, JSON.stringify(value));
    } catch(e) {
      localStorage.setItem('nostr_keep_' + key, value);
    }

    return new Promise((resolve, reject) => {
      const { store } = this._transaction('settings', 'readwrite');
      const request = store.put({ key, value });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }
}

// Export a single global database instance
export const db = new NostrKeepDB();
