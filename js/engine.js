/* ================================================================
   GhostNote — Core Engine
   All encryption, storage, and expiry logic lives here.
   Nothing is ever sent to a server. The decryption key lives
   ONLY in the URL fragment (#) so it never touches any server log.
================================================================ */
'use strict';

var GN = (function(){

  /* ── Helpers ──────────────────────────────────────────── */

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

  function str2buf(str){
    return new TextEncoder().encode(str);
  }

  function buf2str(buf){
    return new TextDecoder().decode(buf);
  }

  function randomId(len){
    len = len || 16;
    var arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return buf2hex(arr.buffer);
  }

  /* ── AES-GCM Encryption ──────────────────────────────── */

  async function generateKey(){
    return crypto.subtle.generateKey(
      { name:'AES-GCM', length:256 },
      true,      // extractable
      ['encrypt','decrypt']
    );
  }

  async function exportKey(key){
    var raw = await crypto.subtle.exportKey('raw', key);
    return buf2hex(raw);
  }

  async function importKey(hexKey){
    var raw = hex2buf(hexKey);
    return crypto.subtle.importKey(
      'raw', raw,
      { name:'AES-GCM', length:256 },
      false,
      ['decrypt']
    );
  }

  async function encrypt(plaintext, key){
    var iv  = crypto.getRandomValues(new Uint8Array(12));
    var enc = await crypto.subtle.encrypt(
      { name:'AES-GCM', iv:iv },
      key,
      str2buf(plaintext)
    );
    return buf2hex(iv.buffer) + ':' + buf2hex(enc);
  }

  async function decrypt(ciphertext, key){
    var parts  = ciphertext.split(':');
    var iv     = new Uint8Array(hex2buf(parts[0]));
    var data   = hex2buf(parts[1]);
    var plain  = await crypto.subtle.decrypt(
      { name:'AES-GCM', iv:iv },
      key,
      data
    );
    return buf2str(plain);
  }

  /* ── Storage Schema ──────────────────────────────────────
     Key:   'gn_' + noteId
     Value: JSON {
       cipher:     string,   // encrypted text
       noConfirm:  bool,     // skip confirmation dialog
       expiresAt:  number|null,  // Unix ms timestamp, null = never
       created:    number,   // Unix ms timestamp
     }
  ────────────────────────────────────────────────────────── */

  function storeNote(id, data){
    try {
      localStorage.setItem('gn_' + id, JSON.stringify(data));
      return true;
    } catch(e) {
      return false;
    }
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

  /* ── Expiry helpers ──────────────────────────────────── */

  // Returns ms from now given a preset string or number of minutes
  function resolveExpiry(value){
    if(!value || value === 'read') return null; // destroy on read only
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

  /* ── Public API ──────────────────────────────────────── */

  return {

    // Create and store a new note. Returns { id, keyHex }
    createNote: async function(text, opts){
      opts = opts || {};
      var key    = await generateKey();
      var keyHex = await exportKey(key);
      var cipher = await encrypt(text, key);
      var id     = randomId(12);

      var expiresAt = resolveExpiry(opts.expiry); // null or timestamp

      var ok = storeNote(id, {
        cipher:    cipher,
        noConfirm: !!opts.noConfirm,
        expiresAt: expiresAt,
        created:   Date.now(),
      });

      if(!ok) throw new Error('Storage unavailable. Try in a non-private browser tab.');
      return { id:id, keyHex:keyHex };
    },

    // Read a note (does NOT delete it yet)
    peekNote: function(id){
      var note = loadNote(id);
      if(!note) return null;
      if(isExpired(note)){
        deleteNote(id);
        return { expired:true };
      }
      return note;
    },

    // Decrypt and permanently destroy a note
    readAndDestroy: async function(id, keyHex){
      var note = loadNote(id);
      if(!note) return null;

      if(isExpired(note)){
        deleteNote(id);
        return { expired:true };
      }

      var key   = await importKey(keyHex);
      var plain = await decrypt(note.cipher, key);
      deleteNote(id);
      return { text:plain, destroyed:true };
    },

    // Build the shareable URL for a note
    buildUrl: function(id, keyHex){
      var base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'read.html';
      return base + '?id=' + id + '#' + keyHex;
    },

    // Parse id and key from current page URL
    parseUrl: function(){
      var params = new URLSearchParams(location.search);
      var id     = params.get('id');
      var keyHex = location.hash.slice(1); // strip the #
      return { id:id, keyHex:keyHex };
    },

    formatTimeLeft: formatTimeLeft,
    isExpired: isExpired,
    deleteNote: deleteNote,
  };

})();
