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
    this.subscriptions = new Map(); // subId -> { filters, callback }
    this.onLiveUpdate = null;        // listener for live changes
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
        this.pubKey = pubkey.toLowerCase();
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

      this.pubKey = pubkey.toLowerCase();
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
      // nostr-tools v2: getPublicKey takes Uint8Array; v1 takes hex string
      const NT = window.NostrTools;
      let pubkey;
      if (NT.generateSecretKey) {
        // v2: pass bytes
        pubkey = NT.getPublicKey(this._hexToBytes(hexKey));
      } else {
        pubkey = NT.getPublicKey(hexKey);
      }
      this.pubKey = pubkey.toLowerCase();
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
          
          // Resend all active subscriptions to this socket
          this.subscriptions.forEach((sub, subId) => {
            const envelope = JSON.stringify(['REQ', subId, ...sub.filters]);
            socket.send(envelope);
          });

          if (this.onRelayConnected) {
            this.onRelayConnected(url);
          }
        };

        socket.onmessage = (e) => {
          this._handleIncomingMessage(url, e.data);
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
   * Main router for all incoming WebSocket messages
   */
  _handleIncomingMessage(url, rawData) {
    try {
      const message = JSON.parse(rawData);
      if (!Array.isArray(message)) return;
      
      const [type, subId, eventData] = message;
      
      if (this.subscriptions.has(subId)) {
        this.subscriptions.get(subId).callback(type, eventData, url);
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  }

  /**
   * Subscribe to a set of filters on all connected relays
   */
  subscribe(subId, filters, callback) {
    this.subscriptions.set(subId, { filters, callback });
    const envelope = JSON.stringify(['REQ', subId, ...filters]);
    this.sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(envelope);
      }
    });
  }

  /**
   * Unsubscribe from a subscription on all relays
   */
  unsubscribe(subId) {
    this.subscriptions.delete(subId);
    const envelope = JSON.stringify(['CLOSE', subId]);
    this.sockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(envelope);
      }
    });
  }

  /**
   * Helper to retrieve NIP-44 v2 cryptographic engine from NostrTools.
   * nostr-tools v2 exposes nip44 with getConversationKey/encrypt/decrypt directly.
   */
  _getNip44Engine() {
    if (window.NostrTools && window.NostrTools.nip44) {
      // v2: functions live directly on nip44
      const n44 = window.NostrTools.nip44;
      if (n44.getConversationKey && n44.encrypt && n44.decrypt) {
        return n44;
      }
      // Older path: functions nested under .v2
      if (n44.v2 && n44.v2.getConversationKey) {
        return n44.v2;
      }
    }
    return null;
  }

  /**
   * Helper: convert a hex private key string to Uint8Array (needed by nostr-tools v2)
   */
  _hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  /**
   * Helper: convert Uint8Array to hex string
   */
  _bytesToHex(bytes) {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypts plaintext using NIP-44 v2 to a recipient's pubkey
   */
  async _encryptTo(recipientPubKey, plaintext) {
    if (this.useExtension) {
      if (window.nostr && window.nostr.nip44) {
        return await window.nostr.nip44.encrypt(recipientPubKey, plaintext);
      }
      if (window.nostr && window.nostr.nip04) {
        console.warn('NIP-44 not supported by extension. Falling back to NIP-04.');
        return await window.nostr.nip04.encrypt(recipientPubKey, plaintext);
      }
      throw new Error('NIP-07 Extension does not support encryption');
    } else {
      if (!this.privKey) throw new Error('No private key available for encryption');
      const nip44 = this._getNip44Engine();
      if (nip44) {
        const conversationKey = nip44.getConversationKey(this.privKey, recipientPubKey);
        return nip44.encrypt(plaintext, conversationKey);
      }
      return await window.NostrTools.nip04.encrypt(this.privKey, recipientPubKey, plaintext);
    }
  }

  /**
   * Decrypts ciphertext using NIP-44 v2 from a sender's pubkey
   */
  async _decryptFrom(senderPubKey, ciphertext) {
    try {
      if (this.useExtension) {
        if (window.nostr && window.nostr.nip44) {
          try {
            return await window.nostr.nip44.decrypt(senderPubKey, ciphertext);
          } catch (e) {
            if (window.nostr.nip04) {
              return await window.nostr.nip04.decrypt(senderPubKey, ciphertext);
            }
            throw e;
          }
        } else if (window.nostr && window.nostr.nip04) {
          return await window.nostr.nip04.decrypt(senderPubKey, ciphertext);
        }
        throw new Error('NIP-07 Extension does not support decryption');
      } else {
        if (!this.privKey) throw new Error('No private key available for decryption');
        const nip44 = this._getNip44Engine();
        if (nip44) {
          try {
            const conversationKey = nip44.getConversationKey(this.privKey, senderPubKey);
            return nip44.decrypt(ciphertext, conversationKey);
          } catch (e) {
            return await window.NostrTools.nip04.decrypt(this.privKey, senderPubKey, ciphertext);
          }
        } else {
          return await window.NostrTools.nip04.decrypt(this.privKey, senderPubKey, ciphertext);
        }
      }
    } catch (e) {
      console.error('Decryption failed for payload from:', senderPubKey, e);
      throw e;
    }
  }

  /**
   * Helper to encrypt inside throwaway-key wrapper.
   * senderPrivKey must be a hex string; converted to Uint8Array for NIP-44 v2.
   */
  _encryptWithKeys(senderPrivKey, recipientPubKey, plaintext) {
    const nip44 = this._getNip44Engine();
    if (!nip44) throw new Error('NostrTools NIP-44 v2 not loaded');
    // nostr-tools v2 getConversationKey officially takes Uint8Array for privkey
    const privBytes = (typeof senderPrivKey === 'string')
      ? this._hexToBytes(senderPrivKey)
      : senderPrivKey;
    const conversationKey = nip44.getConversationKey(privBytes, recipientPubKey);
    return nip44.encrypt(plaintext, conversationKey);
  }

  /**
   * Helper to decrypt inside throwaway-key wrapper.
   * recipientPrivKey must be a hex string; converted to Uint8Array for NIP-44 v2.
   */
  _decryptWithKeys(recipientPrivKey, senderPubKey, ciphertext) {
    const nip44 = this._getNip44Engine();
    if (!nip44) throw new Error('NostrTools NIP-44 v2 not loaded');
    const privBytes = (typeof recipientPrivKey === 'string')
      ? this._hexToBytes(recipientPrivKey)
      : recipientPrivKey;
    const conversationKey = nip44.getConversationKey(privBytes, senderPubKey);
    return nip44.decrypt(ciphertext, conversationKey);
  }

  /**
   * Wraps an unsigned rumor event inside a NIP-59 Gift Wrap (kind:1059 or kind:21059)
   */
  async wrapEvent(rumor, recipientPubKey, ephemeral = false) {
    if (!this.pubKey) throw new Error('Not logged in');

    // 1. Create the kind:13 seal
    const serializedRumor = JSON.stringify(rumor);
    const sealContent = await this._encryptTo(recipientPubKey, serializedRumor);

    // Tweak seal created_at slightly
    const sealCreatedAt = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 300);

    const seal = {
      pubkey: this.pubKey,
      content: sealContent,
      kind: 13,
      created_at: sealCreatedAt,
      tags: []
    };

    // Sign the seal (identifies real sender to recipient)
    const signedSeal = await this._signEvent(seal);

    // 2. Generate throwaway one-time key
    // nostr-tools v2: generateSecretKey() returns Uint8Array; we hex-encode it for consistency
    const NT = window.NostrTools;
    let throwawayPrivBytes;
    let throwawayPrivHex;
    let throwawayPub;
    if (NT.generateSecretKey) {
      // v2 API
      throwawayPrivBytes = NT.generateSecretKey();
      throwawayPrivHex = this._bytesToHex(throwawayPrivBytes);
      throwawayPub = NT.getPublicKey(throwawayPrivBytes);
    } else {
      // v1 API fallback
      throwawayPrivHex = NT.generatePrivateKey();
      throwawayPub = NT.getPublicKey(throwawayPrivHex);
    }

    // Encrypt the seal to recipient using NIP-44 with throwaway key
    const serializedSeal = JSON.stringify(signedSeal);
    const wrapContent = this._encryptWithKeys(throwawayPrivHex, recipientPubKey, serializedSeal);

    // Tweak wrap created_at slightly
    const wrapCreatedAt = Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 300);

    const giftWrap = {
      kind: ephemeral ? 21059 : 1059,
      created_at: wrapCreatedAt,
      tags: [['p', recipientPubKey]],
      content: wrapContent,
      pubkey: throwawayPub
    };

    // Sign the gift wrap with throwaway key using v2-compatible finalizeEvent
    if (NT.finalizeEvent) {
      // v2: finalizeEvent sets id, pubkey, sig in-place
      const privForSign = throwawayPrivBytes || this._hexToBytes(throwawayPrivHex);
      const finalized = NT.finalizeEvent(giftWrap, privForSign);
      return finalized;
    }
    // v1 fallback
    giftWrap.id = NT.getEventHash(giftWrap);
    giftWrap.sig = NT.getSignature(giftWrap, throwawayPrivHex);

    return giftWrap;
  }

  /**
   * Unwraps a NIP-59 Gift Wrap (kind:1059) returning the raw rumor.
   * Double-layer NIP-44 decryption: outer wrap (throwaway key) → seal → inner rumor.
   */
  async unwrapEvent(giftWrap) {
    if (!this.pubKey) throw new Error('Not logged in');

    try {
      // Layer 1: Decrypt outer gift wrap with our key + throwaway pubkey → seal (kind:13)
      let decryptedSealText;
      if (this.useExtension) {
        decryptedSealText = await window.nostr.nip44.decrypt(giftWrap.pubkey, giftWrap.content);
      } else {
        if (!this.privKey) throw new Error('No private key available');
        decryptedSealText = this._decryptWithKeys(this.privKey, giftWrap.pubkey, giftWrap.content);
      }

      const seal = JSON.parse(decryptedSealText);
      if (seal.kind !== 13) {
        throw new Error(`Expected seal kind 13, got ${seal.kind}`);
      }

      // Layer 2: Decrypt inner seal with our key + sender pubkey → rumor (plaintext note)
      let decryptedRumorText;
      if (this.useExtension) {
        decryptedRumorText = await window.nostr.nip44.decrypt(seal.pubkey, seal.content);
      } else {
        if (!this.privKey) throw new Error('No private key available');
        decryptedRumorText = this._decryptWithKeys(this.privKey, seal.pubkey, seal.content);
      }

      const rumor = JSON.parse(decryptedRumorText);

      // Attach the sender's verified real public key (from the signed seal)
      rumor.sender_pubkey = seal.pubkey;

      return rumor;
    } catch (e) {
      console.error('[COLLAB] Failed to unwrap gift wrap event:', giftWrap.id, e.message);
      throw e;
    }
  }

  /**
   * Starts a persistent subscription to hear live note updates and collaborative messages
   */
  startLiveSubscription() {
    if (!this.pubKey) return;

    const subId = 'nostr_keep_live_' + this.pubKey.substring(0, 8);

    const filters = [
      {
        kinds: [30078],
        authors: [this.pubKey]
      },
      {
        // kind:1059 gift wraps addressed to us (used for all collab messages)
        kinds: [1059],
        '#p': [this.pubKey]
      }
    ];

    console.log("[COLLAB] Starting live subscription on relays with subId:", subId, "filters:", filters);

    this.subscribe(subId, filters, async (type, eventData) => {
      if (type === 'EVENT' && eventData) {
        await this._handleIncomingLiveEvent(eventData);
      }
    });
  }

  /**
   * Processes live collaborative/sync events from relays
   */
  async _handleIncomingLiveEvent(event) {
    console.log("[COLLAB] Inbound live event received on WebSocket: kind =", event.kind, "id =", event.id, "from pubkey =", event.pubkey);
    try {
      if (!this._processedEventIds) {
        this._processedEventIds = new Set();
      }
      if (this._processedEventIds.has(event.id)) return;
      this._processedEventIds.add(event.id);

      if (event.kind === 30078) {
        const dTag = event.tags.find(t => t[0] === 'd');
        if (dTag && dTag[1].startsWith('nostr-keep-note-')) {
          const noteId = dTag[1].replace('nostr-keep-note-', '');
          const plaintext = await this._decrypt(event.content);
          const parsed = JSON.parse(plaintext);
          parsed.id = noteId;
          parsed.updated_at = parsed.updated_at || (event.created_at * 1000);
          
          if (this.onLiveUpdate) {
            this.onLiveUpdate({ type: 'note', note: parsed });
          }
        }
      } else if (event.kind === 1059 || event.kind === 21059) {
        const rumor = await this.unwrapEvent(event);
        if (rumor) {
          if (this.onLiveUpdate) {
            this.onLiveUpdate({ type: 'rumor', rumor, ephemeral: event.kind === 21059 });
          }
        }
      }
    } catch (e) {
      console.error('[COLLAB] Failed to process live event:', event.id, e);
    }
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
   * Encrypts plain text (JSON string of the note) for our own pubkey using NIP-44.
   * The note is encrypted to ourselves so only we can decrypt it from relays.
   */
  async _encrypt(plaintext) {
    if (this.useExtension) {
      if (window.nostr && window.nostr.nip44) {
        return await window.nostr.nip44.encrypt(this.pubKey, plaintext);
      }
      if (window.nostr && window.nostr.nip04) {
        console.warn('Extension does not support NIP-44. Falling back to NIP-04.');
        return await window.nostr.nip04.encrypt(this.pubKey, plaintext);
      }
      throw new Error('Extension does not support encryption');
    } else {
      if (!this.privKey) throw new Error('No private key available for encryption');
      const nip44 = this._getNip44Engine();
      if (nip44) {
        const privBytes = this._hexToBytes(this.privKey);
        const conversationKey = nip44.getConversationKey(privBytes, this.pubKey);
        return nip44.encrypt(plaintext, conversationKey);
      }
      return await window.NostrTools.nip04.encrypt(this.privKey, this.pubKey, plaintext);
    }
  }

  /**
   * Decrypts our own encrypted note content using NIP-44.
   */
  async _decrypt(ciphertext) {
    try {
      if (this.useExtension) {
        if (window.nostr && window.nostr.nip44) {
          try {
            return await window.nostr.nip44.decrypt(this.pubKey, ciphertext);
          } catch (e) {
            if (window.nostr.nip04) {
              return await window.nostr.nip04.decrypt(this.pubKey, ciphertext);
            }
            throw e;
          }
        } else if (window.nostr && window.nostr.nip04) {
          return await window.nostr.nip04.decrypt(this.pubKey, ciphertext);
        }
        throw new Error('Extension does not support decryption');
      } else {
        if (!this.privKey) throw new Error('No private key available for decryption');
        const nip44 = this._getNip44Engine();
        if (nip44) {
          try {
            const privBytes = this._hexToBytes(this.privKey);
            const conversationKey = nip44.getConversationKey(privBytes, this.pubKey);
            return nip44.decrypt(ciphertext, conversationKey);
          } catch (e) {
            return await window.NostrTools.nip04.decrypt(this.privKey, this.pubKey, ciphertext);
          }
        } else {
          return await window.NostrTools.nip04.decrypt(this.privKey, this.pubKey, ciphertext);
        }
      }
    } catch (e) {
      console.error('Decryption failed:', e.message);
      throw e;
    }
  }

  /**
   * Signs a Nostr event.
   * Supports both nostr-tools v1 (getEventHash + getSignature) and v2 (finalizeEvent).
   */
  async _signEvent(event) {
    const NT = window.NostrTools;
    event.pubkey = this.pubKey;

    if (this.useExtension) {
      if (!window.nostr || !window.nostr.signEvent) {
        throw new Error('NIP-07 Extension does not support signing events');
      }
      // Extension handles id and sig internally
      return await window.nostr.signEvent(event);
    } else {
      if (!this.privKey) throw new Error('No private key available for signing');

      if (NT.finalizeEvent) {
        // v2 API: finalizeEvent(template, secretKeyBytes) fills pubkey, id, sig
        const privBytes = this._hexToBytes(this.privKey);
        return NT.finalizeEvent(event, privBytes);
      }
      // v1 API fallback
      event.id = NT.getEventHash(event);
      event.sig = NT.getSignature(event, this.privKey);
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
    // Verify ciphertext format: must be valid NIP-04 (?iv=) or NIP-44 (compact base64 format), and must not contain raw JSON or cleartext title/content.
    const isNip04 = encryptedContent && encryptedContent.includes('?iv=');
    const isNip44 = encryptedContent && !encryptedContent.includes('{') && !encryptedContent.includes(' ') && encryptedContent.length > 10;
    const isValidCipher = isNip04 || isNip44;

    if (!encryptedContent || 
        encryptedContent === payload || 
        !isValidCipher ||
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
    const filter = [{
      kinds: [0],
      authors: [pubkey],
      limit: 1
    }];
    
    let completed = false;
    const closeSubscription = () => {
      if (completed) return;
      completed = true;
      this.unsubscribe(subId);
    };
    
    // Safety timeout of 5 seconds
    setTimeout(closeSubscription, 5000);
    
    this.subscribe(subId, filter, (type, eventData) => {
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

    const filter = [{
      kinds: [30078],
      authors: [this.pubKey]
    }];
    
    let eoseReceivedCount = 0;
    const activeSockets = Array.from(this.sockets.entries()).filter(([url, s]) => s.readyState === WebSocket.OPEN);

    if (activeSockets.length === 0) {
      this._notifyStatus('offline', 'Relays offline. Operating locally.');
      if (onComplete) onComplete();
      return;
    }

    const closeSubscription = () => {
      this.unsubscribe(subId);
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

    this.subscribe(subId, filter, async (type, eventData, url) => {
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
    });
  }
}

// Export a single global sync manager instance
export const nostr = new NostrSyncManager();
