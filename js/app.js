/* ============================================================
   ReModelAI — app.js
   Main application logic, scroll animations, counter, shared UI
   ============================================================ */

'use strict';

// ── Intersection Observer for reveal animations ────────────────
(function initReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
})();

// ── Navbar scroll effect ───────────────────────────────────────
(function initNavScroll() {
  const nav = document.querySelector('.navbar') || document.querySelector('.nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 30);
  window.addEventListener('scroll', onScroll, { passive: true });
})();

// ── Animated counter utility ───────────────────────────────────
function animateCounter(el, from, to, duration, prefix, suffix, decimals) {
  const start = performance.now();
  function update(now) {
    const elapsed = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - elapsed, 3); // ease out cubic
    const current = from + (to - from) * ease;
    const display = decimals > 0 ? current.toFixed(decimals) : Math.floor(current).toLocaleString();
    el.textContent = prefix + display + suffix;
    if (elapsed < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

// ── Observe counter elements ───────────────────────────────────
(function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const target = parseFloat(el.dataset.count);
        const prefix = el.dataset.prefix || '';
        const suffix = el.dataset.suffix || (target >= 1000 ? '+' : '');
        const decimals = String(target).includes('.') ? 1 : 0;
        animateCounter(el, 0, target, 1800, prefix, suffix, decimals);
        observer.unobserve(el);
      }
    });
  }, { threshold: 0.5 });

  counters.forEach(el => observer.observe(el));
})();

// ── Smooth scroll for anchor links ────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', e => {
    const id = link.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      const top = target.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  });
});

// ── Notification system (global) ──────────────────────────────
window.ReModelAI = window.ReModelAI || {};

window.ReModelAI.showToast = function(message, type = 'info', duration = 3500) {
  const colors = {
    success: '#10b981',
    error:   '#ef4444',
    warning: '#f59e0b',
    info:    '#06b6d4'
  };

  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    info:    '✦'
  };

  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(80px);
    background: var(--bg-card); border: 1px solid ${colors[type]};
    border-left: 4px solid ${colors[type]};
    color: var(--text-primary); padding: 12px 20px;
    border-radius: 10px; font-size: 0.875rem; font-weight: 500;
    box-shadow: 0 8px 30px rgba(0,0,0,0.5); z-index: 99999;
    display: flex; align-items: center; gap: 10px;
    transition: transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s;
    max-width: 380px; width: calc(100vw - 40px);
  `;

  toast.innerHTML = `
    <span style="color:${colors[type]};font-weight:800;">${icons[type]}</span>
    <span>${message}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });
  });

  // Animate out
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(80px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  }, duration);
};

// ── Mobile menu (landing page) ─────────────────────────────────
(function initMobileMenu() {
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  const mobileClose = document.getElementById('mobileClose');

  if (!hamburger || !mobileMenu) return;

  hamburger.addEventListener('click', () => mobileMenu.classList.add('open'));
  if (mobileClose) mobileClose.addEventListener('click', () => mobileMenu.classList.remove('open'));

  // Close on background click
  mobileMenu.addEventListener('click', e => {
    if (e.target === mobileMenu) mobileMenu.classList.remove('open');
  });
})();

// ── Stagger reveal for grids ───────────────────────────────────
(function staggerGridItems() {
  document.querySelectorAll('.features-grid, .pricing-grid, .overview-cards').forEach(grid => {
    const children = grid.querySelectorAll(':scope > *');
    children.forEach((child, i) => {
      if (!child.classList.contains('reveal')) {
        child.classList.add('reveal', `reveal-delay-${(i % 5) + 1}`);
      }
    });
  });
})();
