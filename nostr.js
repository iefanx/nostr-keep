/**
 * Nostr Keep - Nostr Protocol and Cryptography Manager
 * Manages WebSocket connections to relays, encryption/decryption (NIP-04),
 * and event signing (NIP-07 extension or raw private key).
 */

class NostrSyncManager {
  constructor() {
    this.privKey = null;      // Hex format (in-memory only)
    this.pubKey = null;       // Hex format
    this.useExtension = false;// Whether NIP-07 is used
    this.relays = [
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.primal.net',
      'wss://relay.nostr.band'
    ];
    this.sockets = new Map(); // wssUrl -> WebSocket
    this.onStatusChange = null;
    this.onRelayConnected = null; // Sync auto-trigger listener
    this.activeSubId = null;
  }

  /**
   * Sets callback for successful relay connection
   */
  setRelayConnectedCallback(callback) {
    this.onRelayConnected = callback;
  }

  /**
   * Sets callback for sync status changes
   */
  setStatusCallback(callback) {
    this.onStatusChange = callback;
  }

  _notifyStatus(status, details = '') {
    if (this.onStatusChange) {
      this.onStatusChange({ status, details });
    }
  }

  /**
   * Initialize state from stored settings.
   * Returns session object or false if no stored session.
   */
  async loadSession(dbInstance) {
    this._db = dbInstance; // Store reference for later
    
    // Using dbInstance.getSetting is synchronous-fast when cached in localStorage and handles JSON parsing correctly
    let loginType = await dbInstance.getSetting('login_type');
    let pubkey = await dbInstance.getSetting('pubkey');
    let storedKey = await dbInstance.getSetting('encrypted_privkey');
    
    let savedRelays = await dbInstance.getSetting('custom_relays');
    if (savedRelays && Array.isArray(savedRelays)) {
      this.relays = savedRelays;
    }

    if (loginType === 'extension') {
      // 1. If we already have the pubkey cached, we can restore instantly!
      if (pubkey) {
        this.pubKey = pubkey;
        this.privKey = null;
        this.useExtension = true;
        this._notifyStatus('logged_in', 'Logged in via extension');
        return { pubkey, type: 'extension' };
      }
      
      // 2. If no pubkey cached (old session data fallback), wait up to 1.5s for extension script injection
      for (let i = 0; i < 15 && !window.nostr; i++) {
        await new Promise(r => setTimeout(r, 100));
      }
      
      if (window.nostr) {
        try {
          return await this.loginWithExtension();
        } catch (e) {
          console.error('Extension session restore failed:', e);
          return false;
        }
      }
    } else if (loginType === 'privkey' && storedKey) {
      try {
        return await this.loginWithPrivateKey(storedKey);
      } catch (e) {
        console.error('Private key session restore failed:', e);
        return false;
      }
    }
    return false;
  }

  /**
   * Logs in using NIP-07 Browser Extension
   */
  async loginWithExtension() {
    if (!window.nostr) {
      throw new Error('Nostr browser extension (NIP-07) not found. Please install Alby or nos2x.');
    }

    try {
      this._notifyStatus('connecting_extension', 'Requesting public key from extension...');
      const pubkey = await window.nostr.getPublicKey();
      if (!pubkey) throw new Error('Extension returned empty public key');

      this.pubKey = pubkey;
      this.privKey = null;
      this.useExtension = true;
      
      localStorage.setItem('nostr_keep_login_type', 'extension');
      localStorage.setItem('nostr_keep_pubkey', pubkey);
      if (this._db) {
        await this._db.setSetting('login_type', 'extension');
        await this._db.setSetting('pubkey', pubkey);
      }

      this._notifyStatus('logged_in', 'Logged in via extension');
      return { pubkey, type: 'extension' };
    } catch (e) {
      this._notifyStatus('error', `Extension login failed: ${e.message}`);
      throw e;
    }
  }

  /**
   * Logs in using a raw Private Key (nsec or hex)
   */
  async loginWithPrivateKey(keyStr) {
    if (!keyStr) throw new Error('Key cannot be empty');
    let hexKey = keyStr.trim();

    // Check if nsec
    if (hexKey.startsWith('nsec')) {
      try {
        const decoded = window.NostrTools.nip19.decode(hexKey);
        if (decoded.type === 'nsec') {
          hexKey = decoded.data;
        } else {
          throw new Error('Invalid nsec key');
        }
      } catch (e) {
        throw new Error('Failed to decode nsec key: ' + e.message);
      }
    }

    // Validate hex key
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey)) {
      throw new Error('Private key must be a 64-character hex string or an nsec...');
    }

    try {
      const pubkey = window.NostrTools.getPublicKey(hexKey);
      this.pubKey = pubkey;
      this.privKey = hexKey;
      this.useExtension = false;

      localStorage.setItem('nostr_keep_login_type', 'privkey');
      localStorage.setItem('nostr_keep_pubkey', pubkey);
      localStorage.setItem('nostr_keep_encrypted_privkey', hexKey);
      if (this._db) {
        await this._db.setSetting('login_type', 'privkey');
        await this._db.setSetting('pubkey', pubkey);
        await this._db.setSetting('encrypted_privkey', hexKey);
      }

      this._notifyStatus('logged_in', 'Logged in via private key');
      return { pubkey, type: 'privkey', hexKey };
    } catch (e) {
      this._notifyStatus('error', `Private key login failed: ${e.message}`);
      throw e;
    }
  }

  /**
   * Logs out and cleans session
   */
  logout() {
    this.privKey = null;
    this.pubKey = null;
    this.useExtension = false;
    this.disconnectRelays();
    
    // Clear localStorage session
    localStorage.removeItem('nostr_keep_login_type');
    localStorage.removeItem('nostr_keep_pubkey');
    localStorage.removeItem('nostr_keep_encrypted_privkey');
    
    this._notifyStatus('logged_out', 'Session ended');
  }

  /**
   * Connects to all configured relays
   */
  connectRelays() {
    if (!this.pubKey) return;
    
    this.disconnectRelays();
    this._notifyStatus('connecting_relays', 'Connecting to relays...');

    let connectedCount = 0;

    this.relays.forEach(url => {
      try {
        const socket = new WebSocket(url);
        this.sockets.set(url, socket);

        socket.onopen = () => {
          connectedCount++;
          console.log(`Connected to relay: ${url}`);
          this._notifyStatus('syncing', `Connected to ${connectedCount}/${this.relays.length} relays`);
          if (this.onRelayConnected) {
            this.onRelayConnected(url);
          }
        };

        socket.onerror = (e) => {
          console.error(`WebSocket error on relay ${url}:`, e);
        };

        socket.onclose = () => {
          console.log(`Disconnected from relay: ${url}`);
          this.sockets.delete(url);
          
          // Recompute connected count
          const activeCount = Array.from(this.sockets.values()).filter(s => s.readyState === WebSocket.OPEN).length;
          if (activeCount === 0) {
            this._notifyStatus('offline', 'All relay connections closed');
          } else {
            this._notifyStatus('syncing', `Connected to ${activeCount}/${this.relays.length} relays`);
          }
        };
      } catch (e) {
        console.error(`Failed to create WebSocket for ${url}:`, e);
      }
    });
  }

  /**
   * Disconnects all relays
   */
  disconnectRelays() {
    this.sockets.forEach(socket => {
      try {
        socket.close();
      } catch (e) {
        console.error(e);
      }
    });
    this.sockets.clear();
  }

  /**
   * Encrypts plain text (JSON string of the note) for our own pubkey
   */
  async _encrypt(plaintext) {
    if (this.useExtension) {
      if (!window.nostr || !window.nostr.nip04) {
        throw new Error('NIP-07 Extension does not support NIP-04 encryption');
      }
      return await window.nostr.nip04.encrypt(this.pubKey, plaintext);
    } else {
      if (!this.privKey) throw new Error('No private key available for encryption');
      return await window.NostrTools.nip04.encrypt(this.privKey, this.pubKey, plaintext);
    }
  }

  /**
   * Decrypts encrypted cipher text from our own events
   */
  async _decrypt(ciphertext) {
    try {
      if (this.useExtension) {
        if (!window.nostr || !window.nostr.nip04) {
          throw new Error('NIP-07 Extension does not support NIP-04 decryption');
        }
        return await window.nostr.nip04.decrypt(this.pubKey, ciphertext);
      } else {
        if (!this.privKey) throw new Error('No private key available for decryption');
        return await window.NostrTools.nip04.decrypt(this.privKey, this.pubKey, ciphertext);
      }
    } catch (e) {
      console.error('Decryption failed for payload:', ciphertext, e);
      throw e;
    }
  }

  /**
   * Signs a Nostr event
   */
  async _signEvent(event) {
    event.pubkey = this.pubKey;
    event.id = window.NostrTools.getEventHash(event);

    if (this.useExtension) {
      if (!window.nostr || !window.nostr.signEvent) {
        throw new Error('NIP-07 Extension does not support signing events');
      }
      return await window.nostr.signEvent(event);
    } else {
      if (!this.privKey) throw new Error('No private key available for signing');
      event.sig = window.NostrTools.getSignature(event, this.privKey);
      return event;
    }
  }

  /**
   * Encrypts and publishes a note as NIP-78 kind 30078 event
   */
  async publishNote(note) {
    if (!this.pubKey) throw new Error('Not logged in');

    this._notifyStatus('syncing', `Encrypting note: ${note.title || 'Untitled'}`);

    // 1. Construct Note payload
    const payload = JSON.stringify({
      title: note.title || '',
      content: note.content || '',
      color: note.color || '#202124',
      pinned: note.pinned === 1 || note.pinned === true,
      archived: note.archived === 1 || note.archived === true,
      trash: note.trash === 1 || note.trash === true,
      labels: note.labels || [],
      updated_at: note.updated_at || Date.now(),
      deleted: note.deleted === 1 || note.deleted === true
    });

    // 2. Encrypt
    const encryptedContent = await this._encrypt(payload);

    // STRICT SECURITY VERIFICATION: Ensure cleartext title/content is never leaked to Nostr relays.
    // Verify ciphertext format, ensure it does not match plain text, and does not contain cleartext data.
    if (!encryptedContent || 
        encryptedContent === payload || 
        !encryptedContent.includes('?iv=') ||
        (note.title && note.title.trim() !== '' && encryptedContent.includes(note.title.trim())) ||
        (note.content && note.content.trim() !== '' && encryptedContent.includes(note.content.trim()))) {
      throw new Error("Security Alert: Note encryption verification failed! Blocked transmission to prevent cleartext leakage.");
    }

    // 3. Formulate Event
    const event = {
      kind: 30078,
      created_at: Math.floor((note.updated_at || Date.now()) / 1000),
      tags: [
        ['d', `nostr-keep-note-${note.id}`],
        ['alt', 'Encrypted Google Keep note for Nostr Keep app']
      ],
      content: encryptedContent
    };

    // 4. Sign
    const signedEvent = await this._signEvent(event);

    // 5. Broadcast to connected relays
    this._broadcast(signedEvent);
    return signedEvent;
  }

  /**
   * Broadcasts a signed event over all active sockets
   */
  _broadcast(event) {
    const envelope = JSON.stringify(['EVENT', event]);
    let successCount = 0;

    this.sockets.forEach((socket, url) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(envelope);
        successCount++;
      }
    });

    console.log(`Broadcasted event ${event.id} to ${successCount} relays.`);
    if (successCount === 0) {
      this._notifyStatus('offline', 'Failed to publish: all relays offline');
      throw new Error('All relays offline');
    } else {
      this._notifyStatus('synced', `Published successfully to ${successCount} relays`);
    }
  }

  /**
   * Fetches user metadata (kind 0) from connected relays
   */
  async fetchMetadata(pubkey, callback) {
    if (!pubkey) return;
    
    const subId = 'nostr_keep_meta_' + Math.random().toString(36).substring(2, 9);
    const filter = {
      kinds: [0],
      authors: [pubkey],
      limit: 1
    };
    const reqEnvelope = JSON.stringify(['REQ', subId, filter]);
    
    const activeSockets = Array.from(this.sockets.entries()).filter(([url, s]) => s.readyState === WebSocket.OPEN);
    if (activeSockets.length === 0) return;
    
    let completed = false;
    const closeSubscription = () => {
      if (completed) return;
      completed = true;
      activeSockets.forEach(([url, socket]) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(['CLOSE', subId]));
        }
      });
    };
    
    // Safety timeout of 5 seconds
    setTimeout(closeSubscription, 5000);
    
    activeSockets.forEach(([url, socket]) => {
      const originalOnMessage = socket.onmessage;
      socket.onmessage = async (e) => {
        try {
          const message = JSON.parse(e.data);
          if (Array.isArray(message) && message[1] === subId) {
            const [type, , eventData] = message;
            if (type === 'EVENT' && eventData) {
              try {
                const profile = JSON.parse(eventData.content);
                callback(profile);
                closeSubscription();
              } catch (err) {
                console.error('Failed to parse metadata content:', err);
              }
            } else if (type === 'EOSE') {
              closeSubscription();
            }
          }
        } catch (err) {
          console.error(err);
        }
        if (originalOnMessage) originalOnMessage.call(socket, e);
      };
      
      socket.send(reqEnvelope);
    });
  }

  /**
   * Pulls all user notes from relays and triggers callbacks
   * @param {Function} onNoteDecrypted - Callback triggered for each decrypted note
   * @param {Function} onComplete - Callback when fetching ends
   */
  async fetchNotes(onNoteDecrypted, onComplete) {
    if (!this.pubKey) return;

    this._notifyStatus('syncing', 'Fetching notes from Nostr relays...');
    
    const subId = 'nostr_keep_sub_' + Math.random().toString(36).substring(2, 9);
    this.activeSubId = subId;

    const filter = {
      kinds: [30078],
      authors: [this.pubKey]
    };

    const reqEnvelope = JSON.stringify(['REQ', subId, filter]);
    
    // We set a timeout to complete the initial load. Since relays stream events,
    // EOSE (End of Stored Events) will fire, but we can also set a safety timeout.
    let eoseReceivedCount = 0;
    const activeSockets = Array.from(this.sockets.entries()).filter(([url, s]) => s.readyState === WebSocket.OPEN);

    if (activeSockets.length === 0) {
      this._notifyStatus('offline', 'Relays offline. Operating locally.');
      if (onComplete) onComplete();
      return;
    }

    const closeSubscription = () => {
      activeSockets.forEach(([url, socket]) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(['CLOSE', subId]));
        }
      });
      this._notifyStatus('synced', 'Sync complete');
      if (onComplete) onComplete();
    };

    // Safety timeout of 5 seconds to prevent hanging
    const safetyTimeout = setTimeout(() => {
      console.log('Sync safety timeout fired.');
      closeSubscription();
    }, 5000);

    // Keep track of event IDs to prevent duplicate processing
    const processedEvents = new Set();

    activeSockets.forEach(([url, socket]) => {
      // Temporary message router for this subscription
      const originalOnMessage = socket.onmessage;

      socket.onmessage = async (e) => {
        try {
          const message = JSON.parse(e.data);
          
          if (!Array.isArray(message)) return;

          const [type, responseSubId, eventData] = message;

          if (responseSubId === subId) {
            if (type === 'EVENT' && eventData) {
              const dTag = eventData.tags.find(t => t[0] === 'd');
              if (dTag && dTag[1].startsWith('nostr-keep-note-') && !processedEvents.has(eventData.id)) {
                processedEvents.add(eventData.id);
                const noteId = dTag[1].replace('nostr-keep-note-', '');

                try {
                  // Decrypt note in background
                  const plaintext = await this._decrypt(eventData.content);
                  const parsed = JSON.parse(plaintext);
                  
                  // Attach ID and timestamps
                  parsed.id = noteId;
                  // If note has updated_at in JSON, use it, else fallback to event created_at
                  parsed.updated_at = parsed.updated_at || (eventData.created_at * 1000);

                  onNoteDecrypted(parsed);
                } catch (decryptionError) {
                  console.error('Could not decrypt note event:', eventData.id, decryptionError);
                }
              }
            } else if (type === 'EOSE') {
              eoseReceivedCount++;
              console.log(`EOSE received from ${url} (${eoseReceivedCount}/${activeSockets.length})`);
              if (eoseReceivedCount >= activeSockets.length) {
                clearTimeout(safetyTimeout);
                closeSubscription();
              }
            }
          }
        } catch (err) {
          console.error('Error handling WebSocket message:', err);
        }

        // Forward to original handler if it exists
        if (originalOnMessage) {
          originalOnMessage.call(socket, e);
        }
      };
    });

    // Send the subscription request to all active sockets
    activeSockets.forEach(([url, socket]) => {
      socket.send(reqEnvelope);
    });
  }
}

// Export a single global sync manager instance
export const nostr = new NostrSyncManager();
