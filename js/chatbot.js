/* ============================================================
   ReModelAI — chatbot.js
   AI Chatbot with 20+ intelligent response categories,
   keyword matching, typing animation, quick replies
   ============================================================ */

'use strict';

(function initChatbot() {

  // ── Response Database ────────────────────────────────────────
  const responses = [
    {
      id: 'permits',
      keywords: ['permit', 'permits', 'license', 'licensing', 'legal', 'zoning', 'inspection', 'code', 'compliance', 'building permit'],
      category: '📋 Permits & Licensing',
      response: `Great question! Here's what most small remodeling businesses need:\n\n**General Contractor License** — Required in most states. Costs $50–$500 and requires a state exam.\n\n**Building Permits** — Required for structural, electrical, plumbing, or HVAC work. Apply at your local building department, typically $50–$2,000 depending on project scope.\n\n**Business License** — A basic city/county operating license, usually $50–$150/year.\n\n**Liability Insurance + Worker's Comp** — Not a permit, but required to pull permits in most states.\n\n💡 *Pro Tip:* Use our Planning Guide → "Permits & Licensing" for a step-by-step checklist with your state's requirements.`
    },
    {
      id: 'marketing',
      keywords: ['market', 'marketing', 'advertise', 'advertising', 'social media', 'facebook', 'instagram', 'google', 'seo', 'leads', 'clients', 'customers', 'promote', 'promotion'],
      category: '📣 Marketing',
      response: `Here's a high-ROI marketing strategy for remodeling businesses:\n\n**1. Google Business Profile** — Free, and it's how local customers find you. Get 10+ reviews ASAP.\n\n**2. Before/After Photos** — Instagram and Facebook posts with before/after transformations get 3x more engagement than regular posts.\n\n**3. Local SEO** — Target keywords like "kitchen remodel [your city]" and "bathroom renovation near me".\n\n**4. Referral Program** — Offer existing clients $100–$250 for every referral that books a job.\n\n**5. Houzz & Angi Listings** — Free profiles on these platforms bring qualified leads.\n\n💡 Use our *Marketing Tools* in the dashboard to generate ready-to-post social content in seconds!`
    },
    {
      id: 'roi',
      keywords: ['roi', 'return', 'profit', 'profitable', 'revenue', 'money', 'income', 'earning', 'cost', 'estimate roi', 'make money'],
      category: '💰 ROI Estimate',
      response: `Let's look at typical ROI for a remodeling business:\n\n**Average project margins:**\n• Kitchen remodel: 25–35% net margin\n• Bathroom: 30–40% net margin\n• Basement finish: 35–45% net margin\n• Exterior work: 20–30% net margin\n\n**Example:** A $50,000 kitchen job at 30% margin = **$15,000 profit**.\n\n**Annual revenue benchmarks:**\n• Solo contractor: $80k–$200k/year\n• 3-person crew: $250k–$600k/year\n• Established company: $1M+/year\n\n**Cost reduction with ReModelAI:**\nOur users save an average of **$23,000/year** in overruns by using our budget tracker and AI planning tools.\n\n💡 Use the Budget Tracker in the dashboard to project your specific ROI!`
    },
    {
      id: 'budget',
      keywords: ['budget', 'budgeting', 'cost', 'spending', 'expenses', 'overrun', 'track', 'money management', 'finance', 'financial'],
      category: '📊 Budget Planning',
      response: `Smart budgeting is the #1 factor in project profitability. Here's how to structure yours:\n\n**Standard budget categories:**\n• Labor: 30–40% of total\n• Materials: 35–45%\n• Equipment rental: 5–10%\n• Permits & fees: 2–5%\n• Marketing: 3–8%\n• Contingency buffer: **10–15% always!**\n\n**Key rules:**\n✓ Never start without a signed contract with payment schedule\n✓ Require 25–30% deposit upfront\n✓ Bill at milestones, not completion\n✓ Track actuals weekly against estimates\n\n🚨 **Overrun Alert:** Our system warns you at 70%, 80%, and 90% of any budget category so you never get surprised.\n\n💡 Open the *Budget Tracker* on your dashboard to add categories and start tracking!`
    },
    {
      id: 'hiring',
      keywords: ['hire', 'hiring', 'staff', 'employee', 'employees', 'crew', 'contractor', 'subcontractor', 'worker', 'team', 'labor'],
      category: '👥 Hiring Staff',
      response: `Scaling your team is a major milestone. Here's a hiring roadmap:\n\n**When to hire:**\n• You're turning down work 2+ months in a row\n• You're working 60+ hours/week\n• Quality is slipping due to workload\n\n**First hires to make:**\n1. **Skilled laborer/apprentice** — $18–$28/hr depending on region\n2. **Project coordinator** — manages schedules, client communication\n3. **Estimator** — if you're doing $500k+ in annual revenue\n\n**W2 vs Subcontractors:**\n• Subs: Less paperwork, but higher per-hour cost and less control\n• W2: More overhead, but builds company culture and loyalty\n\n**Platforms:** Indeed, Craigslist Trades, local trade schools, and word of mouth.\n\n💡 See the *Hiring Staff* planning guide for a complete onboarding checklist!`
    },
    {
      id: 'timeline',
      keywords: ['timeline', 'schedule', 'how long', 'duration', 'time', 'weeks', 'months', 'construction schedule', 'project timeline', 'deadline'],
      category: '📅 Project Timeline',
      response: `Here are realistic timelines for common remodels:\n\n**Kitchen remodel:**\n• Minor update (cabinets/countertops): 2–4 weeks\n• Full gut renovation: 6–12 weeks\n\n**Bathroom remodel:**\n• Cosmetic refresh: 1–2 weeks\n• Full renovation: 3–6 weeks\n\n**Basement finish:**\n• Basic: 4–6 weeks\n• Full with bath: 8–14 weeks\n\n**Whole-home renovation:**\n• 3–6 months depending on scope\n\n**Timeline killers to avoid:**\n• Material delays (order 4–6 weeks early)\n• Permit delays (submit 3–4 weeks before needed)\n• Change orders (write tight contracts)\n• Subcontractor scheduling gaps\n\n💡 Use our *Construction Timeline* planning guide for a week-by-week schedule template!`
    },
    {
      id: 'grand_opening',
      keywords: ['grand opening', 'launch', 'open', 'opening day', 'start business', 'launch event', 'ribbon cutting', 'first day'],
      category: '🎉 Grand Opening',
      response: `A strong launch creates momentum. Here's your grand opening playbook:\n\n**30 days before:**\n✓ Create Google Business Profile\n✓ Set up social media accounts with project photos\n✓ Send press release to local paper\n✓ Invite local influencers to tour your first completed project\n\n**2 weeks before:**\n✓ Launch a "founding client" promotion (10–15% off first job)\n✓ Run targeted Facebook/Instagram ads in your ZIP code\n✓ Get listed on Houzz, Angi, HomeAdvisor, Thumbtack\n\n**Launch week:**\n✓ Post daily content showing your work process\n✓ Ask your first clients to post reviews on Google\n✓ Run a "refer a friend" giveaway\n\n💡 See your personalized *30-Day Launch Checklist* in Marketing Tools!`
    },
    {
      id: 'website',
      keywords: ['website', 'web', 'online', 'internet', 'site', 'seo', 'domain', 'hosting', 'page', 'web presence', 'digital'],
      category: '🌐 Website & Online Presence',
      response: `Your website is your #1 lead-generation asset. Here's what you need:\n\n**Must-have pages:**\n• Home — clear headline + photo + CTA button\n• Services — specific services with prices ranges\n• Gallery — before/after photos (most viewed page!)\n• About — your story, licenses, certifications\n• Contact — form + phone + service area map\n\n**Technical basics:**\n✓ Mobile-optimized (60%+ of traffic is mobile)\n✓ Load time under 3 seconds\n✓ SSL certificate (https)\n✓ Local SEO: city/neighborhood keywords in titles\n\n**Proven tools:**\n• Squarespace or Wix for DIY\n• WordPress for more control\n• ReModelAI website builder (included in your plan!)\n\n**Average cost without ReModelAI:** $1,500–$5,000/year\n**With ReModelAI:** Included in your plan 🎉`
    },
    {
      id: 'insurance',
      keywords: ['insurance', 'liability', 'workers comp', "worker's comp", 'bonded', 'bond', 'coverage', 'claim', 'insured'],
      category: '🛡️ Insurance',
      response: `Insurance is non-negotiable. Here's what you need:\n\n**General Liability Insurance**\n• Covers property damage and injury to third parties\n• Typical cost: $500–$2,000/year for $1M coverage\n• Required to pull permits in most states\n\n**Workers' Compensation**\n• Required in almost every state if you have W2 employees\n• Cost: 3–8% of payroll, varies by trade risk level\n• Protects you from lawsuits if a worker is injured\n\n**Commercial Auto**\n• If using vehicles for work, personal auto won't cover claims\n• Cost: $1,200–$3,000/year\n\n**Surety Bond**\n• Protects clients if you fail to complete work\n• Often required for licensing\n• Cost: $200–$600/year for $10k–$25k bond\n\n💡 Total insurance budget: **$2,500–$6,000/year** — factor this into your overhead!`
    },
    {
      id: 'pricing',
      keywords: ['price', 'pricing', 'charge', 'rate', 'how much', 'quote', 'bid', 'estimate', 'hourly', 'project price', 'set price'],
      category: '💵 Pricing Your Work',
      response: `Pricing correctly is critical to profitability. Here's how:\n\n**Calculate your hourly rate:**\n1. Annual overhead (insurance, tools, vehicle, software): ~$40,000\n2. Desired salary: $80,000\n3. Billable hours/year: ~1,600 (after admin, drive time)\n4. Base rate: ($40k + $80k) ÷ 1,600 = **$75/hour minimum**\n\n**Markup on materials:**\n• 15–25% on all materials purchased\n• Prevents losing money on price fluctuations\n\n**Bidding a project:**\n• Labor hours × hourly rate\n• Materials + 20% markup\n• Subcontractor costs + 15% management fee\n• 10% contingency\n• Your profit margin: 15–25% on top\n\n**Never underbid to win work** — it trains clients to expect low prices and you'll lose money.\n\n💡 The Budget Tracker helps you build accurate bids from historical job data!`
    },
    {
      id: 'contracts',
      keywords: ['contract', 'agreement', 'paperwork', 'legal document', 'client agreement', 'scope of work', 'terms', 'payment terms', 'deposit'],
      category: '📄 Contracts',
      response: `A solid contract protects you and builds client trust. Every contract should include:\n\n**Essential sections:**\n1. **Scope of work** — exact, detailed description of what's included (and NOT included)\n2. **Payment schedule** — 25-30% deposit, milestone payments, final payment on completion\n3. **Change order process** — all changes in writing with pricing before work begins\n4. **Timeline** — start date, completion date, what causes delays\n5. **Warranty** — what you cover and for how long\n6. **Dispute resolution** — mediation before litigation clause\n7. **Right to stop work** — if payment is missed\n\n**Payment schedule example:**\n• 30% on signing\n• 30% at rough-in\n• 30% at finish installation\n• 10% at punch-list completion\n\n💡 Never start work without a signed contract AND deposit in hand.`
    },
    {
      id: 'software',
      keywords: ['software', 'tools', 'app', 'technology', 'platform', 'program', 'manage', 'management', 'crm', 'project management', 'system'],
      category: '💻 Business Software',
      response: `Here's the tech stack most successful remodeling companies use:\n\n**Project Management:**\n• ReModelAI (all-in-one — you're already here! 🎉)\n• Buildertrend or CoConstruct for larger operations\n\n**Estimating:**\n• ReModelAI budget tracker\n• Clear Estimates or Contractor Foreman\n\n**Accounting:**\n• QuickBooks (most common)\n• FreshBooks (simpler, good for solo)\n\n**Client Communication:**\n• ReModelAI client portal\n• HubSpot CRM (free tier is great)\n\n**Design:**\n• ReModelAI 3D Scanner\n• SketchUp (free version works)\n• Houzz Pro\n\n**Total cost without ReModelAI:** $400–$800/month in separate tools\n**With ReModelAI Growth plan:** $79/month — saves $3,800+/year 💰`
    },
    {
      id: 'employees_vs_subs',
      keywords: ['subcontractor', 'sub', 'independent', '1099', 'employee vs', 'classify', 'w2', 'w-2', 'contractor vs employee'],
      category: '👷 Employees vs Subs',
      response: `This is one of the most important decisions you'll make. Here's the breakdown:\n\n**Subcontractors (1099):**\n✓ No payroll taxes (saves ~15%)\n✓ No workers' comp (they carry their own)\n✓ No benefits, PTO, or HR complexity\n✗ Less control over schedule/methods\n✗ Risk of IRS misclassification penalties\n✗ Higher per-job cost\n\n**W2 Employees:**\n✓ More control and loyalty\n✓ Better for consistent, skilled work\n✓ Build a company culture\n✗ Payroll taxes (FICA, FUTA, SUTA)\n✗ Workers' comp required\n✗ Benefits expectations over time\n\n**IRS test for classification:** If you control HOW the work is done (not just the result), they must be W2 employees. Misclassifying is a major legal risk.\n\n💡 Most small remodelers start with subs and hire W2 once they hit consistent $300k+ revenue.`
    },
    {
      id: 'materials',
      keywords: ['material', 'materials', 'supply', 'supplies', 'lumber', 'tile', 'flooring', 'countertop', 'fixture', 'supplier', 'wholesale', 'discount'],
      category: '🪚 Materials & Supplies',
      response: `Smart material sourcing can add 5–10% to your bottom line:\n\n**Where to buy:**\n• **Pro accounts at Home Depot/Lowe's** — 5–10% discount + net-30 terms\n• **Local lumber yards** — better quality and pricing on volume\n• **ProSource Wholesale** — trade-only flooring, tile, cabinets\n• **IKEA** for budget kitchens (clients love the look, low cost)\n\n**Tips to save money:**\n✓ Buy in bulk for commonly used items (fasteners, drywall, insulation)\n✓ Establish a relationship with a local tile/flooring distributor\n✓ Sell unused materials to recoup costs\n✓ Charge clients full retail + 15–20% markup\n\n**Markup strategy:**\n• Always markup materials 15–25%\n• This covers your time to shop, haul, and manage returns\n• Never provide materials "at cost" — that's free labor\n\n💡 Track all material costs in the Budget Tracker for accurate job costing!`
    },
    {
      id: 'client_management',
      keywords: ['client', 'customer', 'relationship', 'communication', 'difficult client', 'complaint', 'review', 'dispute', 'happy client', 'client satisfaction'],
      category: '🤝 Client Management',
      response: `Client relationships make or break a remodeling business. Here's how to excel:\n\n**Communication cadence:**\n• Initial meeting: understand their vision, budget, and timeline\n• Weekly updates: even a 2-minute text keeps clients calm\n• Milestone calls: before/during/after major phases\n• Final walkthrough: creates pride and referrals\n\n**Managing expectations:**\n✓ Underpromise and overdeliver on timeline\n✓ Put everything in writing (no verbal agreements)\n✓ Address surprises immediately with solutions, not excuses\n✓ Never hide bad news — clients respect honesty\n\n**Handling complaints:**\n1. Listen fully without defending\n2. Acknowledge their frustration\n3. Present a clear solution within 24 hours\n4. Fix it fast, then follow up\n\n**Generating reviews:**\n• Ask at project completion while excitement is high\n• Send a direct Google review link via text\n• Offer a small gift card as a thank-you`
    },
    {
      id: 'scaling',
      keywords: ['scale', 'scaling', 'grow', 'growth', 'expand', 'expansion', 'multiple crews', 'franchise', 'systemize', 'second crew'],
      category: '📈 Scaling Your Business',
      response: `Scaling a remodeling business requires systems first:\n\n**The 4 pillars of scale:**\n\n1. **Documented processes** — every job should run the same way. Write SOPs for estimating, client onboarding, project execution, and billing.\n\n2. **Technology** — ReModelAI replaces manual tracking. Your team needs one source of truth for projects, budgets, and client communication.\n\n3. **Delegation** — You can't scale if you're on every job. Promote a lead carpenter to project manager, hire an admin/coordinator.\n\n4. **Financial controls** — Weekly P&L review, job costing on every project, cash flow forecasting 90 days out.\n\n**Revenue milestones:**\n• $0–$300k: You doing everything\n• $300k–$800k: First employees, basic systems\n• $800k–$2M: Operations manager, multiple crews\n• $2M+: CEO role, franchise potential\n\n💡 The Planning Guides include a scaling roadmap with specific action items!`
    },
    {
      id: '3d_scanner',
      keywords: ['scan', 'scanner', '3d', 'room', 'floor plan', 'floorplan', 'layout', 'measurement', 'dimension', 'blueprint', 'design', 'ar'],
      category: '📐 3D Room Scanner',
      response: `Our 3D Room Scanner is one of ReModelAI's most powerful tools!\n\n**How it works:**\n1. Open the Room Scanner from the dashboard or navigation\n2. Enter room dimensions manually, OR use webcam capture\n3. Select the room type (kitchen, bathroom, salon, etc.)\n4. Click "Generate 3D Floor Plan"\n5. View AI suggestions for layout, lighting, and customer flow\n\n**What you get:**\n• Detailed top-down floor plan with furniture placement\n• Before/after comparison views\n• AI-generated suggestions tailored to your business type\n• Automatic remodel budget estimate based on room size\n\n**Pro tips:**\n✓ Accurate dimensions = better AI suggestions\n✓ Use the lighting recommendations to reduce remodel cost\n✓ Show clients the floor plan before work begins — reduces change orders by 40%\n\n💡 <a href="room-scanner.html" style="color:var(--accent-cyan)">Open the Room Scanner →</a>`
    },
    {
      id: 'taxes',
      keywords: ['tax', 'taxes', 'deduction', 'write off', 'write-off', 'irs', 'quarterly', 'self employment', 'business tax', 'accountant'],
      category: '🧾 Business Taxes',
      response: `Taxes are manageable with good records. Here's what contractors need to know:\n\n**Key deductions:**\n✓ Vehicle mileage ($0.67/mile for 2024)\n✓ Tools and equipment (Section 179 — deduct full cost in year purchased)\n✓ Home office if you run admin from home\n✓ Software subscriptions (like ReModelAI!)\n✓ Insurance premiums\n✓ Employee wages and benefits\n✓ Marketing expenses\n✓ Professional development/training\n\n**Quarterly estimated taxes:**\nSelf-employed contractors must pay estimated taxes 4x/year:\n• April 15, June 15, September 15, January 15\n• Typically 25–30% of net profit\n\n**Structure matters:**\n• Sole proprietor: Simple but no liability protection\n• LLC: Recommended for most small contractors\n• S-Corp: Tax advantage once you hit $60k+ net profit\n\n💡 Set aside 30% of every payment received into a separate tax savings account!`
    },
    {
      id: 'equipment',
      keywords: ['equipment', 'tools', 'buy tools', 'rent', 'lease', 'machinery', 'saw', 'drill', 'compressor', 'scaffolding', 'lift', 'buy vs rent'],
      category: '🔧 Equipment & Tools',
      response: `Smart equipment decisions protect your cash flow:\n\n**Buy vs. Rent rule of thumb:**\n• Use a tool 3+ times/year → Buy it\n• Use a tool 1–2 times → Rent it\n• Expensive specialty equipment → Consider renting even if frequent\n\n**Essential starting toolkit (~$8,000–$15,000):**\n✓ Circular saw, miter saw, table saw\n✓ Drill set, impact driver set\n✓ Rotary hammer, oscillating multi-tool\n✓ Level, laser level, tape measures\n✓ Air compressor + nail gun set\n✓ Wet/dry vacuum, generator\n\n**Best brands by trade:**\n• General use: DeWalt, Milwaukee, Makita\n• Hand tools: Estwing, Stanley FatMax\n• Blades/bits: Diablo, Bosch\n\n**Tax tip:** Under Section 179, you can deduct 100% of equipment cost in the year you buy it — huge tax advantage on large purchases!\n\n💡 Track equipment costs in the Budget Tracker under "Equipment" category.`
    },
    {
      id: 'business_plan',
      keywords: ['business plan', 'plan', 'strategy', 'start', 'starting', 'new business', 'how to start', 'launch business', 'first steps', 'setup'],
      category: '📝 Business Plan',
      response: `Here's a proven 90-day launch plan for a remodeling business:\n\n**Days 1–30: Foundation**\n✓ Register your LLC ($50–$500 depending on state)\n✓ Get EIN from IRS (free, takes 5 minutes online)\n✓ Open business bank account\n✓ Get general liability insurance\n✓ Apply for contractor's license\n✓ Set up ReModelAI account\n✓ Create Google Business Profile\n\n**Days 31–60: Systems & Marketing**\n✓ Build basic website with portfolio\n✓ Create social media accounts with before/after posts\n✓ Develop service menu with pricing ranges\n✓ Create contract template\n✓ Set up QuickBooks or accounting system\n\n**Days 61–90: First Clients**\n✓ Network with real estate agents and interior designers\n✓ Contact friends/family for first projects\n✓ Ask for reviews after first 3 jobs\n✓ Run targeted local social media ads\n\n💡 All of this is covered in detail in the Planning Guides section!`
    },
    {
      id: 'cash_flow',
      keywords: ['cash flow', 'cashflow', 'cash', 'payment', 'invoice', 'collect', 'overdue', 'late payment', 'slow pay', 'net 30'],
      category: '💳 Cash Flow',
      response: `Cash flow kills more profitable businesses than anything else. Here's how to manage it:\n\n**The golden rules:**\n1. **Always require a deposit** — 25–30% before any work starts\n2. **Milestone billing** — never wait until completion to bill\n3. **Net 15, not Net 30** — give clients 15 days, not 30\n4. **Stop work clause** — if a payment is 5 days late, pause work\n\n**Dealing with slow payers:**\n• Call immediately on day 1 of overdue (don't wait)\n• Offer a payment plan to collect something\n• For amounts over $5,000, send a demand letter via certified mail\n• File in small claims court for amounts under $10,000\n• For large commercial jobs, consider invoice factoring (sells invoice at 85–90% for immediate cash)\n\n**Cash flow planning:**\n✓ Know your monthly fixed costs (overhead)\n✓ Maintain 2–3 months of overhead in reserve\n✓ Track cash weekly, not monthly\n\n💡 The Budget Tracker shows projected cash position based on current jobs!`
    },
    {
      id: 'safety',
      keywords: ['safety', 'osha', 'accident', 'injury', 'hazard', 'ppe', 'hard hat', 'fall protection', 'safe', 'dangerous'],
      category: '⛑️ Jobsite Safety',
      response: `Safety isn't just ethical — it's financial. One injury can cost $50,000+.\n\n**OSHA basics for contractors:**\n• Fall protection required for work 6+ feet above ground\n• Hard hats in areas with overhead hazards\n• Eye and ear protection for power tool use\n• Dust masks/respirators for drywall, concrete, lead paint\n• GFCI protection for electrical tools near water\n\n**Your safety program:**\n1. Pre-job hazard assessment (5 minutes every morning)\n2. Weekly tailgate safety talks with crew\n3. Document all incidents, even near-misses\n4. Post emergency numbers and first aid kit on every site\n5. Ensure all workers have OSHA 10 certification\n\n**Cost of non-compliance:**\n• OSHA fines: $15,625 per violation\n• Willful violation: $156,259 per violation\n• Plus workers' comp claims and lawsuits\n\n**Resource:** OSHA's free consultation service can review your safety program at no cost or penalty risk.`
    },
    {
      id: 'default',
      keywords: [],
      category: '🤖 General Help',
      response: `I'm not sure exactly what you're looking for, but I'm here to help with anything about running your remodeling business!\n\nHere are my most popular topics:\n\n• 📋 **Permits & Licensing** — what you need and how to get them\n• 💰 **Budgeting & ROI** — pricing your work for profitability\n• 📣 **Marketing** — getting clients and growing your brand\n• 👥 **Hiring** — when and how to build your team\n• 📐 **Room Scanner** — how to use our 3D planning tool\n• 📝 **Business Plan** — your 90-day launch roadmap\n\nJust ask about any of these topics, or type your specific question and I'll do my best to help!`
    }
  ];

  // ── Quick replies to show after each response ─────────────
  const quickReplies = [
    ['What permits do I need?', 'How do I market my business?', 'What\'s my ROI estimate?'],
    ['How do I hire staff?', 'What budget should I set?', 'Tell me about contracts'],
    ['How do I price my work?', 'What software do I need?', 'Help with cash flow'],
    ['How do I scale my business?', 'What about insurance?', 'Safety requirements?'],
    ['How do I write a business plan?', 'Tell me about taxes', 'Materials advice']
  ];

  let quickReplyIndex = 0;

  // ── DOM refs ──────────────────────────────────────────────
  const toggle = document.getElementById('chatbotToggle');
  const panel  = document.getElementById('chatbotPanel');
  const closeBtn = document.getElementById('chatClose') || document.getElementById('chatbotClose');
  const input  = document.getElementById('chatInput');
  const sendBtn = document.getElementById('chatSend');
  const messages = document.getElementById('chatMessages');
  const badge  = document.getElementById('chatBadge');
  const quickBtnsContainer = document.getElementById('quickBtns');

  if (!toggle || !panel || !messages) return;

  // ── Open/Close ────────────────────────────────────────────
  function openChat() {
    panel.classList.add('open');
    if (badge) badge.style.display = 'none';
    toggle.innerHTML = '<span>✕</span>';
    if (input) setTimeout(() => input.focus(), 350);
    if (messages.children.length === 0) showWelcome();
  }

  function closeChat() {
    panel.classList.remove('open');
    toggle.innerHTML = `<span id="chatIcon">🤖</span>`;
  }

  toggle.addEventListener('click', () => {
    panel.classList.contains('open') ? closeChat() : openChat();
  });

  if (closeBtn) closeBtn.addEventListener('click', closeChat);

  // ── Welcome message ───────────────────────────────────────
  function showWelcome() {
    appendBotMessage(
      `👋 Hi there! I'm **ReModelAI Assistant**, your 24/7 business advisor.\n\nI can help you with permits, budgeting, marketing, hiring, pricing, and anything else about running a successful remodeling business.\n\nWhat can I help you with today?`,
      false
    );
  }

  // ── Append messages ───────────────────────────────────────
  function appendUserMessage(text) {
    const div = document.createElement('div');
    div.className = 'chat-message user';
    div.innerHTML = `
      <div class="msg-avatar user-avatar-msg">U</div>
      <div class="msg-bubble user-bubble">${escapeHtml(text)}</div>
    `;
    messages.appendChild(div);
    scrollToBottom();
  }

  function appendBotMessage(text, animate = true) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chat-message';
    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble bot-bubble';

    if (animate) {
      // Show typing indicator first
      const typing = createTypingIndicator();
      wrapper.innerHTML = `<div class="msg-avatar bot-avatar">🤖</div>`;
      wrapper.appendChild(typing);
      messages.appendChild(wrapper);
      scrollToBottom();

      setTimeout(() => {
        typing.remove();
        bubble.innerHTML = formatMessage(text);
        wrapper.appendChild(bubble);
        scrollToBottom();
        updateQuickReplies();
      }, 1000 + Math.random() * 800);
    } else {
      wrapper.innerHTML = `<div class="msg-avatar bot-avatar">🤖</div>`;
      bubble.innerHTML = formatMessage(text);
      wrapper.appendChild(bubble);
      messages.appendChild(wrapper);
      scrollToBottom();
    }
  }

  function createTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'typing-indicator';
    div.innerHTML = `
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    `;
    return div;
  }

  // ── Format message text (bold, newlines) ───────────────────
  function formatMessage(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
      .replace(/✓/g, '<span style="color:var(--success)">✓</span>')
      .replace(/✗/g, '<span style="color:var(--danger)">✗</span>')
      .replace(/🚨/g, '<span style="color:var(--danger)">🚨</span>');
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function scrollToBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  // ── Update quick reply buttons ────────────────────────────
  function updateQuickReplies() {
    if (!quickBtnsContainer) return;
    const set = quickReplies[quickReplyIndex % quickReplies.length];
    quickReplyIndex++;
    quickBtnsContainer.innerHTML = '';
    set.forEach(q => {
      const btn = document.createElement('button');
      btn.className = 'quick-btn';
      btn.textContent = q;
      btn.addEventListener('click', () => sendMessage(q));
      quickBtnsContainer.appendChild(btn);
    });
  }

  // ── Find best matching response ───────────────────────────
  function findResponse(text) {
    const normalized = text.toLowerCase().trim();

    // Score each response
    let best = null;
    let bestScore = 0;

    for (const r of responses) {
      if (r.id === 'default') continue;
      let score = 0;
      for (const kw of r.keywords) {
        if (normalized.includes(kw)) {
          // Longer keyword matches score higher
          score += kw.split(' ').length * 2;
          // Exact word match scores higher
          if (new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(normalized)) {
            score += 1;
          }
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    return best || responses.find(r => r.id === 'default');
  }

  // ── Send message ──────────────────────────────────────────
  function sendMessage(text) {
    text = (text || '').trim();
    if (!text) return;

    appendUserMessage(text);
    if (input) input.value = '';

    const response = findResponse(text);
    appendBotMessage(response.response, true);
  }

  // Global function for quick buttons in HTML
  window.sendQuick = sendMessage;

  // ── Event listeners ───────────────────────────────────────
  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      if (input) sendMessage(input.value);
    });
  }

  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(input.value);
      }
    });
  }

  // ── Badge pulse on page load ──────────────────────────────
  if (badge) {
    badge.style.display = 'flex';
    setTimeout(() => {
      if (!panel.classList.contains('open') && badge) {
        badge.style.display = 'none';
      }
    }, 8000);
  }

  // Update quick buttons initially
  updateQuickReplies();

})();
