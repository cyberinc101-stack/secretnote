(function(){
  'use strict';

  /* ── Theme ─────────────────────────────────────────── */
  function applyTheme(t){
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('gn_theme', t);
    document.querySelectorAll('.theme-btn').forEach(function(b){
      b.classList.toggle('active', b.dataset.theme === t);
    });
  }

  function initTheme(){
    var saved = localStorage.getItem('gn_theme');
    if(saved){ applyTheme(saved); return; }
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }

  window.setTheme = function(t){ applyTheme(t); };

  /* ── Header ─────────────────────────────────────────── */
  function pre(){ return location.pathname.includes('/pages/') ? '../' : ''; }

  function logoMark(){
    return '<svg viewBox="0 0 28 28" width="18" height="18" aria-hidden="true" focusable="false">'
      +'<path fill="#fff" d="M8 4H16V8H19V11H22V22A2 2 0 0 1 20 24H8A2 2 0 0 1 6 22V6A2 2 0 0 1 8 4Z"/>'
      +'<g fill="#fff">'
      +'<rect x="21" y="2" width="3" height="3" rx="0.7" opacity=".6"/>'
      +'<rect x="24.4" y="6.2" width="2.3" height="2.3" rx="0.5" opacity=".42"/>'
      +'<rect x="17.3" y="1" width="2" height="2" rx="0.45" opacity=".42"/>'
      +'</g>'
      +'<path stroke="var(--primary)" stroke-width="1.6" stroke-linecap="round" d="M9 14H14M9 17.4H18M9 20.8H16"/>'
      +'</svg>';
  }

  function buildHeader(){
    var p = pre();
    return '<header class="site-header"><div class="header-inner">'
      +'<a href="'+p+'index.html" class="logo">'
      +'<div class="logo-icon">'+logoMark()+'</div>'
      +'<div class="logo-name">Secret<span>Note</span></div>'
      +'</a>'
      +'<nav class="header-nav">'
      +'<a href="'+p+'index.html" class="nav-link">New Note</a>'
      +'<a href="'+p+'pages/how-it-works.html" class="nav-link">How It Works</a>'
      +'<a href="'+p+'pages/faq.html" class="nav-link">FAQ</a>'
      +'</nav>'
      +'<div class="theme-toggle">'
      +'<button class="theme-btn" data-theme="light" onclick="setTheme(\'light\')" title="Light mode">&#9728;</button>'
      +'<button class="theme-btn" data-theme="dark"  onclick="setTheme(\'dark\')"  title="Dark mode">&#9790;</button>'
      +'</div>'
      +'</div></header>';
  }

  /* ── Footer ─────────────────────────────────────────── */
  function buildFooter(){
    var p = pre();
    return '<footer class="site-footer">'
      +'<div class="footer-inner">'
      +'<div class="footer-col"><div class="footer-col-title">SecretNote</div>'
      +'<a href="'+p+'index.html">Create a Note</a>'
      +'<a href="'+p+'pages/how-it-works.html">How It Works</a>'
      +'<a href="'+p+'pages/faq.html">FAQ</a>'
      +'</div>'
      +'<div class="footer-col"><div class="footer-col-title">Use Cases</div>'
      +'<a href="'+p+'index.html">Share Passwords</a>'
      +'<a href="'+p+'index.html">Private Messages</a>'
      +'<a href="'+p+'index.html">One-Time Codes</a>'
      +'<a href="'+p+'index.html">API Keys &amp; Tokens</a>'
      +'</div>'
      +'<div class="footer-col"><div class="footer-col-title">Legal</div>'
      +'<a href="'+p+'pages/privacy.html">Privacy Policy</a>'
      +'<a href="'+p+'pages/terms.html">Terms of Service</a>'
      +'</div>'
      +'</div>'
      +'<div class="footer-bottom">'
      +'<span>&copy; '+new Date().getFullYear()+' SecretNote &mdash; Encrypted notes that vanish after reading</span>'
      +'<div class="footer-legal">'
      +'<a href="'+p+'pages/privacy.html">Privacy</a>'
      +'<a href="'+p+'pages/terms.html">Terms</a>'
      +'</div></div></footer>'
      +'<div id="toast"></div>';
  }

  /* ── Init ─────────────────────────────────────────── */
  // Apply theme immediately (before DOMContentLoaded to avoid flash)
  initTheme();

  // Watch system preference changes
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e){
      if(!localStorage.getItem('gn_theme')){ applyTheme(e.matches ? 'dark' : 'light'); }
    });
  }

  document.addEventListener('DOMContentLoaded', function(){
    var h = document.getElementById('site-header');
    var f = document.getElementById('site-footer');
    if(h) h.outerHTML = buildHeader();
    if(f) f.outerHTML = buildFooter();

    // Re-apply theme to update button active state after header is injected
    var saved = localStorage.getItem('gn_theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(saved);

    // FAQ
    document.querySelectorAll('.faq-q').forEach(function(q){
      q.addEventListener('click', function(){ q.closest('.faq-item').classList.toggle('open'); });
    });
  });

  /* ── Utilities ─────────────────────────────────────── */
  window.showToast = function(msg, isError){
    var t = document.getElementById('toast');
    if(!t) return;
    t.textContent = msg;
    t.style.background = isError ? 'var(--red)' : 'var(--green)';
    t.classList.add('show');
    setTimeout(function(){ t.classList.remove('show'); }, 2800);
  };

  window.copyText = function(text, label){
    if(navigator.clipboard){
      navigator.clipboard.writeText(text).then(function(){ window.showToast(label || 'Copied!'); });
    } else {
      var ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
      window.showToast(label || 'Copied!');
    }
  };
})();