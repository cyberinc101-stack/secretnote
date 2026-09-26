/* ================================================================
   GhostNote — Core Engine
   Encryption + storage + expiry logic. Note content itself is never
   sent to a server. If a password is set, the AES key is wrapped
   with a password-derived key (PBKDF2) so the password is
   cryptographically required to decrypt - not just a UI check.
   If a destroy notification (email/SMS) is configured, only a
   "note destroyed" ping - no note content - is sent to /api/notify.
================================================================ */
'use strict';

var GN = (function(){

  function buf2hex(buf){
    return Array.from(new Uint8Array(buf))
      .map(function(b){ return b.toString(16).padStart(2,'0'); })
      .join('');
  }

  function hex2buf(hex){
    var bytes = new Uint8Array(hex.length / 2);
    for(var i = 0; i < hex.length; i += 2){
      bytes[i/2] = parseInt(hex.slice(i, i+2), 16);
    }
    return bytes.buffer;
  }

  function str2buf(str){ return new TextEncoder().encode(str); }
  function buf2str(buf){ return new TextDecoder().decode(buf); }

  function randomId(len){
    len = len || 16;
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return buf2hex(arr.buffer);
  }

  async function generateKey(){
    return crypto.subtle.generateKey({ name:'AES-GCM', length:256 }, true, ['encrypt','decrypt']);
  }

  async function importKey(hexKey){
    var raw = hex2buf(hexKey);
    return crypto.subtle.importKey('raw', raw, { name:'AES-GCM', length:256 }, false, ['decrypt']);
  }

  async function encrypt(plaintext, key){
    var iv  = crypto.getRandomValues(new Uint8Array(12));
    var enc = await crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, key, str2buf(plaintext));
    return buf2hex(iv.buffer) + ':' + buf2hex(enc);
  }

  async function decrypt(ciphertext, key){
    var parts  = ciphertext.split(':');
    var iv     = new Uint8Array(hex2buf(parts[0]));
    var data   = hex2buf(parts[1]);
    var plain  = await crypto.subtle.decrypt({ name:'AES-GCM', iv:iv }, key, data);
    return buf2str(plain);
  }

  /* ── Password-based key wrapping (PBKDF2) ──────────────
     The real content key is wrapped with a key derived from the
     password. The stored salt is not secret. Without the correct
     password the content key cannot be recovered.
  ────────────────────────────────────────────────────────── */

  async function deriveKeyFromPassword(password, saltHex){
    var salt = new Uint8Array(hex2buf(saltHex));
    var baseKey = await crypto.subtle.importKey('raw', str2buf(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name:'PBKDF2', salt:salt, iterations:150000, hash:'SHA-256' },
      baseKey,
      { name:'AES-GCM', length:256 },
      false,
      ['encrypt','decrypt']
    );
  }

  async function wrapKeyWithPassword(rawKeyBuf, password){
    var salt    = crypto.getRandomValues(new Uint8Array(16));
    var saltHex = buf2hex(salt.buffer);
    var wrapKey = await deriveKeyFromPassword(password, saltHex);
    var iv      = crypto.getRandomValues(new Uint8Array(12));
    var wrapped = await crypto.subtle.encrypt({ name:'AES-GCM', iv:iv }, wrapKey, rawKeyBuf);
    return { saltHex:saltHex, wrapped: buf2hex(iv.buffer) + ':' + buf2hex(wrapped) };
  }

  async function unwrapKeyWithPassword(saltHex, wrappedStr, password){
    var wrapKey = await deriveKeyFromPassword(password, saltHex);
    var parts   = wrappedStr.split(':');
    var iv      = new Uint8Array(hex2buf(parts[0]));
    var data    = hex2buf(parts[1]);
    var rawKeyBuf = await crypto.subtle.decrypt({ name:'AES-GCM', iv:iv }, wrapKey, data); // throws on wrong password
    return crypto.subtle.importKey('raw', rawKeyBuf, { name:'AES-GCM', length:256 }, false, ['decrypt']);
  }

  /* ── Storage Schema ──────────────────────────────────────
     'gn_' + id -> {
       cipher, noConfirm, expiresAt, created,
       pwSalt?, pwWrapped?,   // present only if password-protected
       notify: {email,phone,ref}|null
     }
  ────────────────────────────────────────────────────────── */

  function storeNote(id, data){
    try { localStorage.setItem('gn_' + id, JSON.stringify(data)); return true; }
    catch(e){ return false; }
  }

  function loadNote(id){
    try {
      var raw = localStorage.getItem('gn_' + id);
      return raw ? JSON.parse(raw) : null;
    } catch(e){ return null; }
  }

  function deleteNote(id){
    try { localStorage.removeItem('gn_' + id); } catch(e){}
  }

  function resolveExpiry(value){
    if(!value || value === 'read') return null;
    var mins = parseInt(value, 10);
    if(isNaN(mins) || mins <= 0) return null;
    return Date.now() + mins * 60 * 1000;
  }

  function isExpired(note){
    if(!note.expiresAt) return false;
    return Date.now() > note.expiresAt;
  }

  function formatTimeLeft(expiresAt){
    if(!expiresAt) return null;
    var ms   = expiresAt - Date.now();
    if(ms <= 0) return 'Expired';
    var secs = Math.floor(ms / 1000);
    var mins = Math.floor(secs / 60);
    var hrs  = Math.floor(mins / 60);
    var days = Math.floor(hrs  / 24);
    if(days  > 0) return days  + 'd ' + (hrs%24)  + 'h remaining';
    if(hrs   > 0) return hrs   + 'h ' + (mins%60) + 'm remaining';
    if(mins  > 0) return mins  + 'm ' + (secs%60) + 's remaining';
    return secs + 's remaining';
  }

  /* ── Destroy notification (fire-and-forget) ────────────
     Sends only "destroyed" + timestamp - never note content or
     the decryption key. Silently no-ops if offline/unreachable.
  ────────────────────────────────────────────────────────── */

  function sendDestroyNotification(notify){
    if(!notify || (!notify.email && !notify.phone)) return;
    try {
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          email: notify.email || null,
          phone: notify.phone || null,
          ref:   notify.ref || null,
          destroyedAt: new Date().toISOString(),
        })
      }).catch(function(){ /* offline or endpoint down - ignore */ });
    } catch(e){ /* ignore */ }
  }

  return {

    // Returns { id, keyHex, hasPassword }. keyHex is null when a
    // password is set - the key exists only wrapped by it.
    createNote: async function(text, opts){
      opts = opts || {};
      var key    = await generateKey();
      var rawKey = await crypto.subtle.exportKey('raw', key);
      var cipher = await encrypt(text, key);
      var id     = randomId(12);
      var expiresAt = resolveExpiry(opts.expiry);

      var record = {
        cipher:    cipher,
        noConfirm: !!opts.noConfirm,
        expiresAt: expiresAt,
        created:   Date.now(),
        notify:    opts.notify || null,
      };

      var keyHex = null;
      if(opts.password){
        var wrap = await wrapKeyWithPassword(rawKey, opts.password);
        record.pwSalt    = wrap.saltHex;
        record.pwWrapped = wrap.wrapped;
      } else {
        keyHex = buf2hex(rawKey);
      }

      var ok = storeNote(id, record);
      if(!ok) throw new Error('Storage unavailable. Try in a non-private browser tab.');
      return { id:id, keyHex:keyHex, hasPassword: !!opts.password };
    },

    peekNote: function(id){
      var note = loadNote(id);
      if(!note) return null;
      if(isExpired(note)){ deleteNote(id); return { expired:true }; }
      return note;
    },

    // Returns: null | {expired:true} | {needsPassword:true} |
    // {wrongPassword:true} | {text, destroyed:true}
    // A wrong password never deletes the note - retry is allowed.
    readAndDestroy: async function(id, keyHex, password){
      var note = loadNote(id);
      if(!note) return null;
      if(isExpired(note)){ deleteNote(id); return { expired:true }; }

      var key;
      if(note.pwSalt){
        if(!password) return { needsPassword:true };
        try {
          key = await unwrapKeyWithPassword(note.pwSalt, note.pwWrapped, password);
        } catch(e){
          return { wrongPassword:true };
        }
      } else {
        key = await importKey(keyHex);
      }

      var plain = await decrypt(note.cipher, key);
      deleteNote(id);
      sendDestroyNotification(note.notify);
      return { text:plain, destroyed:true };
    },

    buildUrl: function(id, keyHex){
      var base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'read.html';
      return keyHex ? (base + '?id=' + id + '#' + keyHex) : (base + '?id=' + id);
    },

    parseUrl: function(){
      var params = new URLSearchParams(location.search);
      var id     = params.get('id');
      var keyHex = location.hash.slice(1);
      return { id:id, keyHex: keyHex || null };
    },

    formatTimeLeft: formatTimeLeft,
    isExpired: isExpired,
    deleteNote: deleteNote,
  };

})();