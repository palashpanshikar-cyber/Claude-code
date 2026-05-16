/* ============================================================
   ReModelAI — marketing.js
   Social post generator, name generator, color palettes,
   30-day checklist, SEO keywords
   ============================================================ */

'use strict';

window.MarketingTools = (function () {

  // ── Social Post Templates ─────────────────────────────────
  const postTemplates = {
    facebook: [
      (biz, type) => `🏠 Exciting news from ${biz}!\n\nWe just completed an incredible ${type} transformation for one of our amazing clients. From outdated and cramped to modern and spacious — the difference is night and day!\n\n✅ Completed on time\n✅ 12% under budget\n✅ Zero surprises\n\nReady to transform your space? Call us today for a FREE estimate!\n\n📞 [Your phone number]\n🌐 [Your website]\n\n#${sanitizeHashtag(type)}Remodel #HomeRenovation #LocalContractor #BeforeAndAfter #HomeImprovement`,

      (biz, type) => `Transform your ${type} into the space you've always dreamed of! 🌟\n\n${biz} has helped over 50 local families achieve stunning ${type.toLowerCase()} renovations — and we're ready to help you next!\n\n💡 Free design consultation\n💡 Detailed written estimates\n💡 Licensed & insured crew\n💡 100% satisfaction guarantee\n\nDM us or comment "QUOTE" below and we'll reach out within 24 hours!\n\n#${sanitizeHashtag(biz)} #${sanitizeHashtag(type)}Renovation #HomeRemodel #LocalBusiness`,

      (biz, type) => `BEFORE & AFTER ALERT 📸\n\nThis ${type.toLowerCase()} went from dated 1990s design to absolutely stunning in just 3 weeks!\n\n🎨 Complete ${type.toLowerCase()} overhaul\n🪟 New fixtures and lighting\n🏗️ Custom storage solutions\n✨ Premium finishes throughout\n\nBig thanks to our incredible clients for trusting ${biz} with their vision!\n\nThinking about a renovation? Let's chat → Link in bio\n\n#${sanitizeHashtag(type)}Remodel #${sanitizeHashtag(biz)} #HomeTransformation #RenovationGoals`
    ],
    instagram: [
      (biz, type) => `✨ SWIPE TO SEE THE TRANSFORMATION ✨\n\nAnother incredible ${type.toLowerCase()} remodel complete! Our team at ${biz} poured heart and skill into every detail.\n\n🏆 Project highlight:\n• Scope: Full ${type.toLowerCase()} renovation\n• Timeline: 4 weeks\n• Result: Absolutely stunning\n\nYour dream space is closer than you think. Tap the link in our bio to get started! 💫\n\n#${sanitizeHashtag(type)}Remodel #${sanitizeHashtag(type)}Renovation #HomeDesign #InteriorDesign #ContractorLife #HomeImprovement #RenovationNation #BeforeAndAfter`,

      (biz, type) => `This is what we live for 🙌\n\nWatching a client's vision come to life is the best part of what we do at ${biz}. This ${type.toLowerCase()} was completely gutted and rebuilt from scratch — and the result speaks for itself.\n\nDrop a 🔥 if you love this transformation!\n\nReady to start your project? Free consultations available this week — DM us NOW!\n\n#Renovation #${sanitizeHashtag(type)}Design #ContractorLife #HomeMakeover #LocalContractor #${sanitizeHashtag(biz)}`,

      (biz, type) => `POV: You walked into your brand new ${type.toLowerCase()} 🚿✨\n\n${biz} just delivered another jaw-dropping transformation. Our clients are over the moon and honestly — so are we!\n\n📐 Custom design\n🛠️ Expert craftsmanship  \n⏰ On-time delivery\n💰 On-budget promise\n\nLink in bio for free estimate! Or DM "START" to begin your journey.\n\n#${sanitizeHashtag(type)}Goals #HomeRenovation #${sanitizeHashtag(biz)} #NewHome #Remodel`
    ]
  };

  // ── Business Name Ideas ───────────────────────────────────
  const namePrefixes  = ['Premier', 'Elite', 'Apex', 'Summit', 'Prestige', 'Craft', 'Master', 'Pro', 'Legacy', 'Bold', 'Swift', 'Anchor', 'Peak', 'Origin', 'Prime'];
  const nameMiddles   = ['Build', 'Remodel', 'Craft', 'Construct', 'Renew', 'Restore', 'Revive', 'Transform', 'Design', 'Create', 'Elevate', 'Rebuild'];
  const nameSuffixes  = ['Co.', 'Group', 'Solutions', 'Services', 'Studio', 'Works', 'Pros', 'Inc.', 'Team', 'Partners'];

  // ── Color Palettes ────────────────────────────────────────
  const palettes = {
    'Kitchen':    [['#F5F0EB','#D4A574','#8B6914','#3D2B1F','#F8F4EF'], ['#E8F4F0','#4ECDC4','#1A535C','#F7FFF7','#FF6B6B'], ['#FFF8F0','#FFB347','#CC5200','#2C1810','#FFEFD5']],
    'Bathroom':   [['#F0F4F8','#63B3ED','#2B6CB0','#1A365D','#EBF8FF'], ['#FAF0E6','#DEB887','#A0522D','#8B4513','#FFF8DC'], ['#F0FFF4','#68D391','#276749','#1C4532','#F0FFF4']],
    'Salon':      [['#FFF0F5','#FF69B4','#C71585','#8B0045','#FFE4EE'], ['#F5F0FF','#9B59B6','#6C3483','#4A235A','#EEE8FF'], ['#FFF9F0','#F4A460','#D2691E','#8B4513','#FFDAB9']],
    'Office':     [['#F0F4FF','#4299E1','#2B6CB0','#1A365D','#EBF8FF'], ['#F0FFF4','#48BB78','#2F855A','#1C4532','#E6FFED'], ['#FFFFF0','#ECC94B','#D69E2E','#744210','#FEFCBF']],
    'Restaurant': [['#FFF8F0','#C0392B','#922B21','#641E16','#FDEDEC'], ['#F5F5DC','#8B4513','#A0522D','#5C4033','#FAEBD7'], ['#1A1A2E','#E94560','#0F3460','#16213E','#533483']],
    'Retail':     [['#F0F0FF','#7C3AED','#5B21B6','#3730A3','#EDE9FE'], ['#FFF5F5','#FC8181','#E53E3E','#9B2335','#FED7D7'], ['#F0FFFF','#38B2AC','#2C7A7B','#234E52','#E6FFFA']],
    'General':    [['#0D0D1A','#7C3AED','#06B6D4','#1A1A2E','#16213E'], ['#F8FAFC','#334155','#0F172A','#64748B','#E2E8F0'], ['#FFF7ED','#FB923C','#EA580C','#9A3412','#FFEDD5']]
  };

  // ── SEO Keywords ─────────────────────────────────────────
  const seoKeywords = {
    'Kitchen':    ['kitchen remodel [city]','kitchen renovation contractor','custom kitchen cabinets','kitchen countertop installation','kitchen gut renovation','modern kitchen design','kitchen remodel cost','best kitchen remodeler','affordable kitchen renovation','kitchen upgrade ideas'],
    'Bathroom':   ['bathroom remodel [city]','bathroom renovation contractor','tile installation near me','custom shower installation','bathroom gut renovation','master bath remodel','small bathroom renovation','bathroom vanity installation','luxury bathroom design','walk-in shower contractor'],
    'Salon':      ['salon renovation contractor','beauty salon design [city]','hair salon buildout','salon interior designer','commercial renovation contractor','salon furniture installation','beauty salon remodel cost','nail salon design','barber shop renovation','spa interior design'],
    'Office':     ['office renovation [city]','commercial interior contractor','office buildout contractor','small office renovation','workspace design contractor','conference room renovation','office remodel cost','commercial construction [city]','office suite renovation','workplace renovation'],
    'Restaurant': ['restaurant renovation contractor','commercial kitchen renovation','restaurant buildout [city]','dining room remodel','restaurant interior design','bar renovation contractor','food service renovation','commercial flooring installation','restaurant hood installation','dining space design'],
    'Retail':     ['retail store renovation','storefront contractor [city]','retail buildout contractor','commercial flooring contractor','store fixture installation','retail interior design','shop renovation cost','boutique renovation','retail space remodel','display fixture contractor'],
    'General':    ['home remodeling contractor [city]','local remodeling company','licensed general contractor','home renovation estimate','residential remodeling services','full home renovation','affordable remodeling contractor','top-rated remodeler near me','home addition contractor','remodeling company reviews']
  };

  // ── 30-Day Checklist ──────────────────────────────────────
  const launchChecklist = [
    { day: 'Week 1',  items: [
      'Register your business (LLC or sole proprietor)',
      'Apply for EIN at IRS.gov (free, takes 5 minutes)',
      'Open a dedicated business bank account',
      'Get general liability insurance quote',
      'Set up ReModelAI account and complete your profile'
    ]},
    { day: 'Week 2',  items: [
      'Apply for contractor\'s license in your state',
      'Create Google Business Profile with photos',
      'Set up Facebook Business page',
      'Create Instagram business account',
      'Build or launch basic website (use ReModelAI builder)'
    ]},
    { day: 'Week 3',  items: [
      'Post first 5 portfolio photos to social media',
      'List business on Houzz, Angi, and Thumbtack',
      'Create your service menu with pricing ranges',
      'Draft your standard contract template',
      'Reach out to 10 potential clients in your network'
    ]},
    { day: 'Week 4',  items: [
      'Run first targeted Facebook/Instagram ad ($50 test budget)',
      'Contact 3 real estate agents about referral partnerships',
      'Complete first job and ask for a Google review',
      'Post before/after photos from your first project',
      'Celebrate your launch! 🎉 The hardest step is starting.'
    ]}
  ];

  // ── DOM Helpers ───────────────────────────────────────────
  function sanitizeHashtag(str) {
    return str.replace(/[^a-zA-Z0-9]/g, '');
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ── Post Generator ────────────────────────────────────────
  function generatePost(platform, businessType, businessName) {
    const biz  = businessName  || 'Our Company';
    const type = businessType  || 'Kitchen';
    const templates = postTemplates[platform] || postTemplates.facebook;
    const pick = templates[Math.floor(Math.random() * templates.length)];
    return pick(biz, type);
  }

  function renderPostOutput(containerId, text) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.style.opacity = '0';
    el.textContent = text;
    setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = '1'; }, 50);
  }

  // ── Name Generator ────────────────────────────────────────
  function generateNames(keyword) {
    const results = [];
    const kw = keyword ? (keyword.charAt(0).toUpperCase() + keyword.slice(1).toLowerCase()) : '';

    // Template 1: Prefix + keyword/middle + suffix
    for (let i = 0; i < 3; i++) {
      const p = namePrefixes[Math.floor(Math.random() * namePrefixes.length)];
      const m = kw || nameMiddles[Math.floor(Math.random() * nameMiddles.length)];
      const s = nameSuffixes[Math.floor(Math.random() * nameSuffixes.length)];
      results.push(`${p} ${m} ${s}`);
    }

    // Template 2: keyword + middle
    if (kw) {
      results.push(`${kw} Masters`);
      results.push(`Pro ${kw} Group`);
      results.push(`${kw} & Beyond`);
    } else {
      results.push('NextLevel Builders');
      results.push('CraftRight Solutions');
      results.push('BuildSmart Co.');
    }

    // Remove duplicates
    return [...new Set(results)].slice(0, 6);
  }

  function renderNameResults(containerId, names) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = names.map(n => `<span class="name-chip" onclick="navigator.clipboard&&navigator.clipboard.writeText('${n}');window.ReModelAI&&window.ReModelAI.showToast('Copied: ${n}','success',2000)">${escapeHtml(n)}</span>`).join('');
  }

  // ── Color Palette ─────────────────────────────────────────
  function getPalette(businessType) {
    const palList = palettes[businessType] || palettes.General;
    return palList[Math.floor(Math.random() * palList.length)];
  }

  function renderPalette(containerId, colors) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = colors.map(c => `
      <div class="swatch" style="background:${c}" title="${c}"
        onclick="navigator.clipboard&&navigator.clipboard.writeText('${c}');window.ReModelAI&&window.ReModelAI.showToast('Copied color: ${c}','success',2000)">
      </div>
    `).join('');
  }

  // ── SEO Keywords ──────────────────────────────────────────
  function getKeywords(businessType, city) {
    const base = seoKeywords[businessType] || seoKeywords.General;
    return base.map(k => k.replace('[city]', city || 'your city'));
  }

  function renderKeywords(containerId, keywords) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = keywords.map(k => `
      <span class="seo-tag" title="Click to copy" onclick="navigator.clipboard&&navigator.clipboard.writeText('${escapeHtml(k)}');window.ReModelAI&&window.ReModelAI.showToast('Copied keyword','success',2000)">${escapeHtml(k)}</span>
    `).join('');
  }

  // ── 30-Day Checklist ──────────────────────────────────────
  function renderChecklist(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let html = '';
    let itemIndex = 0;

    launchChecklist.forEach(week => {
      html += `<div style="margin-bottom:16px;">
        <div style="font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent-cyan);margin-bottom:8px;">${week.day}</div>
      `;
      week.items.forEach(item => {
        html += `
          <div class="checklist-item" id="cl-${itemIndex}">
            <input type="checkbox" class="checklist-cb" id="cb-${itemIndex}"
              onchange="document.getElementById('cl-${itemIndex}').classList.toggle('done',this.checked)">
            <label for="cb-${itemIndex}" style="cursor:pointer;color:var(--text-secondary);font-size:0.85rem;">${escapeHtml(item)}</label>
          </div>
        `;
        itemIndex++;
      });
      html += `</div>`;
    });

    el.innerHTML = html;
  }

  // ── Print checklist ───────────────────────────────────────
  function printChecklist() {
    const content = document.getElementById('checklistContent');
    if (!content) return;

    const printWin = window.open('', '_blank', 'width=800,height=700');
    printWin.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>ReModelAI — 30-Day Launch Checklist</title>
        <style>
          body { font-family: system-ui; max-width: 700px; margin: 40px auto; color: #1a1a2e; }
          h1 { font-size: 1.5rem; margin-bottom: 8px; }
          .week { margin-bottom: 20px; }
          .week-label { font-weight: 800; font-size: 0.9rem; text-transform: uppercase; color: #7c3aed; margin-bottom: 10px; }
          .item { display: flex; gap: 10px; padding: 7px 0; border-bottom: 1px solid #eee; font-size: 0.9rem; align-items: flex-start; }
          .cb { width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
          @media print { .no-print { display: none; } }
        </style>
      </head>
      <body>
        <h1>🏠 ReModelAI — 30-Day Business Launch Checklist</h1>
        <p style="color:#666;margin-bottom:24px;">Generated ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p>
        ${launchChecklist.map(week => `
          <div class="week">
            <div class="week-label">${week.day}</div>
            ${week.items.map(item => `<div class="item"><input type="checkbox" class="cb"><span>${item}</span></div>`).join('')}
          </div>
        `).join('')}
        <p style="color:#aaa;font-size:0.75rem;margin-top:30px;border-top:1px solid #eee;padding-top:12px;">ReModelAI — remodelai.io</p>
        <button class="no-print" onclick="window.print()" style="background:#7c3aed;color:#fff;border:none;padding:10px 24px;border-radius:8px;cursor:pointer;margin-top:16px;">Print Checklist</button>
      </body>
      </html>
    `);
    printWin.document.close();
    printWin.focus();
  }

  // ── Public API ────────────────────────────────────────────
  return {
    generatePost,
    renderPostOutput,
    generateNames,
    renderNameResults,
    getPalette,
    renderPalette,
    getKeywords,
    renderKeywords,
    renderChecklist,
    printChecklist
  };

})();
