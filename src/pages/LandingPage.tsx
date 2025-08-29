import React from "react";

export default function Page() {
  // Smooth scroll with header offset (SSR‑safe & legacy‑parser‑safe)
  const scrollToHash = React.useCallback((hash) => {
    if (!hash || !hash.startsWith('#')) return;
    if (typeof document === 'undefined' || typeof window === 'undefined') return;
    const el = document.querySelector(hash);
    if (!el) return;
    const headerOffset = 80; // sticky header height
    const y = el.getBoundingClientRect().top + window.scrollY - headerOffset;
    window.scrollTo({ top: y, behavior: 'smooth' });
    try {
      if (typeof window !== 'undefined' && window.history && window.history.pushState) {
        window.history.pushState(null, '', hash);
      }
    } catch {}
  }, []);

  const onAnchorClick = (e, hash) => {
    e.preventDefault();
    scrollToHash(hash);
  };

  // Pricing drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [selectedPlan, setSelectedPlan] = React.useState(null);
  const openPlan = (plan) => { setSelectedPlan(plan); setDrawerOpen(true); };

  // Auth modal state (Zettle-like)
  const [authOpen, setAuthOpen] = React.useState(false);
  const [authMode, setAuthMode] = React.useState('login'); // 'login' | 'signup'
  const openAuth = (mode = 'login') => { setAuthMode(mode); setAuthOpen(true); };

  // Single source of truth for plan data (used by Pricing cards & Signup modal)
  const PLAN_MAP = React.useMemo(() => ({
    manad: { title: 'Månad', price: '790 kr/månad', note: 'Utan bindningstid, mest flexibelt' },
    ettar: { title: '1 år (Populär)', price: '630 kr/månad · 7 560 kr', note: 'Spara 1 920 kr jämfört med månadspris' },
    tvar: { title: '2 år (Bästa deal)', price: '550:-/månad · 13 200 kr', note: 'Spara 5 760 kr jämfört med månadspris' }
  }), []);

  const handleAuthSubmit = (email, mode, planKey = 'manad') => {
    if (mode === 'signup') {
      const plan = PLAN_MAP[planKey] || PLAN_MAP.manad;
      setAuthOpen(false);
      openPlan(plan);
    } else {
      if (typeof window !== 'undefined') {
        window.location.href = '/login' + (email ? `?email=${encodeURIComponent(email)}` : '');
      }
    }
  };

  // Tiny runtime checks (dev sanity tests)
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    console.assert(!!document.querySelector('#pricing'), 'Pricing section should exist');
    console.assert(!!document.querySelector('#faq'), 'FAQ section should exist');
  }, []);

  return (
    <div className="min-h-screen text-gray-900 bg-white">
      {/* Top Nav */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur border-b border-pink-100">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <a href="#" className="flex items-center gap-2 font-bold text-xl">
            <ForkLogo />
            <span>Bokäta</span>
          </a>
          <nav className="hidden md:flex items-center gap-4 text-base">
            <a href="#features" onClick={(e)=>onAnchorClick(e,'#features')} className="px-3 py-1 rounded-full text-pink-700 font-semibold hover:bg-pink-50 hover:text-pink-800">Funktioner</a>
            <a href="#pricing" onClick={(e)=>onAnchorClick(e,'#pricing')} className="px-3 py-1 rounded-full text-pink-700 font-semibold hover:bg-pink-50 hover:text-pink-800">Priser</a>
          </nav>
          <div className="flex items-center gap-3">
            <button onClick={()=>openAuth('login')} className="hidden sm:inline-flex items-center px-4 py-2 rounded-full border border-pink-200 text-pink-700 hover:bg-pink-50">Log in</button>
            <button onClick={()=>openAuth('signup')} className="inline-flex items-center px-4 py-2 rounded-full bg-pink-600 text-white font-semibold hover:bg-pink-700">Sign up</button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-600 text-white px-6 py-16 text-center">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight mb-4">Bokäta</h1>
          <h2 className="text-2xl md:text-3xl mb-4">Den lagar inte mat. Den lagar allt annat.</h2>
          <p className="text-lg md:text-xl leading-relaxed max-w-2xl mx-auto mb-8">
            AI‑assistenten som sköter bokningar, svarar gäster automatiskt och fyller dina bord utan krångel.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a href="#pricing" onClick={(e)=>onAnchorClick(e,'#pricing')} className="inline-flex justify-center items-center px-6 py-3 rounded-full bg-pink-600 text-white font-semibold hover:bg-pink-700">
              Kom igång nu
            </a>
          </div>
          <p className="mt-6 text-sm opacity-90">
            🌟 Early adopters: De 100 första restaurangerna får lanseringspris och prioriterad support.
          </p>
        </div>
      </section>

      {/* Problem Section */}
      <section className="bg-white px-6 py-10 text-center">
        <div className="max-w-3xl mx-auto">
          <h3 className="text-2xl md:text-3xl font-semibold text-gray-900 mb-4">
            Hinner du inte svara på mejl, hantera bokningar eller följa upp gäster?
          </h3>
          <p className="text-gray-700 text-lg">
            Förfrågningar blir liggande. Bord står tomma. Och återbesöken uteblir.
          </p>
        </div>
      </section>

      {/* Solution Section */}
      <section className="bg-gradient-to-b from-purple-50 to-pink-50 px-6 py-10 text-center">
        <div className="max-w-3xl mx-auto">
          <p className="text-2xl md:text-3xl font-extrabold text-pink-700 mb-4">Bokäta gör (nästan) allt det där åt dig.</p>
          <p className="text-gray-700 text-lg">
            Den svarar på frågor, föreslår lediga tider, hanterar väntelista och skickar smarta påminnelser.
            Efter besöket ber den om Google‑omdömen och lockar till återbesök.
          </p>
        </div>
      </section>

      {/* Dashboard Preview (mock) */}
      <section className="bg-white px-6 py-10">
        <div className="max-w-6xl mx-auto">
          <div className="rounded-2xl overflow-hidden shadow-lg ring-1 ring-pink-100">
            <DashboardMock />
          </div>
          <p className="text-sm font-semibold text-pink-700 mt-3 text-center tracking-wide">Exempel på dashboard: bokningar, gäster och AI‑svar i realtid.</p>
        </div>
      </section>

      {/* Funktioner */}
      <section className="px-6 py-10" id="features">
        <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-pink-100 shadow-[0_14px_40px_rgba(236,72,153,0.15)]">
          <div className="bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-700 text-white text-center px-6 py-10">
            <h3 className="text-3xl md:text-4xl font-extrabold">Funktioner</h3>
            <p className="opacity-90">Så funkar det och allt du behöver, samlat.</p>
            <div className="mt-4 flex justify-center gap-2 text-sm">
              <a href="#features" onClick={(e)=>onAnchorClick(e,'#features')} className="px-4 py-2 rounded-full bg-white text-pink-700 font-semibold shadow ring-1 ring-pink-200 hover:bg-pink-50 text-base md:text-lg">Funktioner</a>
              <a href="#pricing" onClick={(e)=>onAnchorClick(e,'#pricing')} className="px-4 py-2 rounded-full bg-white text-pink-700 font-semibold shadow ring-1 ring-pink-200 hover:bg-pink-50 text-base md:text-lg">Priser</a>
            </div>
          </div>

          <div className="bg-white px-6 md:px-10 py-10">
            {/* Steps */}
            <div className="grid md:grid-cols-3 gap-6 mb-10">
              <StepCard index={1} title="Ställ in kapacitet & tider" text="Lägg in öppettider, sittningar och bord. Importera från kalender om du vill." />
              <StepCard index={2} title="AI:n sköter dialogen" text="Gästen får svar direkt, med förslag, väntelista och bekräftelse." />
              <StepCard index={3} title="Få fler återbesök" text="Efter besöket: omdömen och erbjudanden för att få gästen tillbaka." />
            </div>

            {/* Features grid */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 text-gray-900">
              <Feature>📩 Svarar på mejl & frågor automatiskt</Feature>
              <Feature>📅 Bokningar med bekräftelse och påminnelse</Feature>
              <Feature>🤖 Din egen AI‑assistent hanterar dina bokningar</Feature>
              <Feature>🔁 Erbjudanden för att få gäster tillbaka</Feature>
              <Feature>⭐ Be om Google‑omdömen efter besök</Feature>
              <Feature>🧠 Smart väntelista och överlappsskydd</Feature>
              <Feature>📊 Enkel statistik & export</Feature>
              <Feature>🧾 Förhandsbetalning valbar (grupper/event)</Feature>
            </div>

            <div className="mt-10 flex items-center justify-center">
              <a href="#pricing" onClick={(e)=>onAnchorClick(e,'#pricing')} className="inline-flex justify-center items-center px-6 py-3 rounded-full bg-pink-600 text-white font-semibold hover:bg-pink-700 text-lg" role="button">Kom igång</a>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section className="px-6 py-10" id="pricing">
        <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-pink-100 shadow-[0_14px_40px_rgba(236,72,153,0.15)]">
          <div className="bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-700 text-white text-center px-6 py-10">
            <h2 className="text-3xl md:text-4xl font-extrabold">Priser</h2>
            <p className="mt-2"><span className="inline-block bg-white text-pink-700 font-semibold px-3 py-1 rounded-full">Gratisperiod: 14 dagar!</span></p>
            <p className="opacity-90 text-sm mt-2">Priser inkl. moms. Fakturering via Stripe. Ingen bindningstid på månadsplanen.</p>
          </div>
          <div className="bg-white px-6 md:px-10 py-10">
            <div className="grid md:grid-cols-3 gap-8">
              <PriceCard title="Månad" priceLine="790 kr/månad" note="Utan bindningstid, mest flexibelt" cta="Starta månadsplan" onSelect={()=>openPlan(PLAN_MAP.manad)} />
              <PriceCard title="1 år (Populär)" highlight priceLine="630 kr/månad · 7 560 kr" note="Spara 1 920 kr jämfört med månadspris" cta="Välj årsplan" onSelect={()=>openPlan(PLAN_MAP.ettar)} />
              <PriceCard title="2 år (Bästa deal)" priceLine="550:-/månad · 13 200 kr" note="Spara 5 760 kr jämfört med månadspris" cta="Välj 2‑årsplan" onSelect={()=>openPlan(PLAN_MAP.tvar)} />
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-10" id="faq">
        <div className="max-w-6xl mx-auto rounded-3xl overflow-hidden border border-pink-100 shadow-[0_14px_40px_rgba(236,72,153,0.15)]">
          <div className="bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-700 text-white text-center px-6 py-10">
            <h2 className="text-2xl md:text-3xl font-extrabold">Vanliga frågor</h2>
          </div>
          <div className="bg-white px-6 md:px-10 py-10">
            <div className="space-y-6 text-gray-900">
              <Faq q="Hur funkar betalningen?" a="Betala via Stripe (kort eller faktura). Du får kvitto direkt. Årsplaner förskottsbetalas." />
              <Faq q="Kan jag avsluta?" a="Månadsplanen kan sägas upp när som helst. Early‑adopter‑planerna förnyas inte automatiskt, de upphör efter perioden." />
              <Faq q="Kan jag aktivera förhandsbetalning?" a="Ja, valbart för särskilda bokningar (t.ex. grupper, event, brunch)." />
              <Faq q="Behöver jag installera en app?" a="Nej, allt sker i webbläsaren (dator eller surfplatta)." />
              <Faq q="Hur anpassar jag AI:n?" a="Du förkonfigurerar svar, meny, sittningar och policy. AI:n följer dina regler och kan eskalera till människa." />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-white border-t border-pink-100 text-center text-xs text-gray-500 py-6">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
            <p>© {new Date().getFullYear()} Bokäta</p>
            <div className="flex flex-wrap items-center gap-4">
              <a href="#" className="hover:text-pink-700">Integritet</a>
              <a href="#" className="hover:text-pink-700">Villkor</a>
            </div>
          </div>
        </div>
      </footer>

      {/* Drawers & Modals */}
      <PlanDrawer open={drawerOpen} plan={selectedPlan} onClose={()=>setDrawerOpen(false)} />
      <AuthModal open={authOpen} mode={authMode} onClose={()=>setAuthOpen(false)} onSubmit={handleAuthSubmit} onToggleMode={(m)=>setAuthMode(m)} />
    </div>
  );
}

function ForkLogo() {
  return (
    <svg className="h-8 w-8" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="forkGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FF2BD0" />
          <stop offset="100%" stopColor="#7A3CFF" />
        </linearGradient>
      </defs>
      <g transform="rotate(-25 32 32)">
        <rect x="18" y="10" width="8" height="18" rx="3" fill="url(#forkGrad)" />
        <rect x="28" y="10" width="8" height="18" rx="3" fill="url(#forkGrad)" />
        <rect x="38" y="10" width="8" height="18" rx="3" fill="url(#forkGrad)" />
        <rect x="26" y="28" width="12" height="26" rx="6" fill="url(#forkGrad)" />
      </g>
    </svg>
  );
}

function DashboardMock() {
  const [viewDate, setViewDate] = React.useState(new Date(2025, 8, 5)); // Sep 2025
  const monthLabel = viewDate.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  const monthLabelCap = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);

  const start = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const end = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const daysInMonth = end.getDate();
  const startOffset = (start.getDay() + 6) % 7; // Monday=0
  const totalCells = 42;
  const cells = Array.from({ length: totalCells }, (_, idx) => {
    const dayNum = idx - startOffset + 1;
    return dayNum >= 1 && dayNum <= daysInMonth ? dayNum : null;
  });
  const isActiveDay = (day) => viewDate.getFullYear() === 2025 && viewDate.getMonth() === 8 && day === 5;

  const prevMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const nextMonth = () => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));

  const stats = [
    { label: 'Bokningar idag', value: '26', icon: '📅' },
    { label: 'Antal gäster idag', value: '79', icon: '👥' },
    { label: 'Mest bokade tid', value: '11:00–12:00', icon: '🕒' },
    { label: 'Totalt denna vecka', value: '348', icon: '📈' },
    { label: 'Stammiskunder', value: '35', icon: '💗' },
    { label: 'Svar skickade av AI denna vecka', value: '37', icon: '🤖' },
  ];

  const schedule = [
    { time: '11:00', items: [
      ['Emma Larsson', 2, 'green'],
      ['Linnéa Bergström', 2, 'teal'],
      ['Alva Lind', 2, 'yellow'],
      ['Noel Svensson', 2, 'rose'],
    ] },
    { time: '11:30', items: [
      ['Per Andersson', 2, 'blue'],
      ['Gustav Åberg', 2, 'teal'],
      ['Klara Nyman', 2, 'green'],
      ['Maja Berg', 2, 'violet'],
    ] },
    { time: '12:00', items: [
      ['Sofie Dahl', 2, 'yellow'],
      ['Elin Wiklund', 3, 'amber'],
      ['Sara Lind', 3, 'orange'],
      ['Viktor Lindqvist', 2, 'rose'],
    ] },
    { time: '12:30', items: [
      ['Oskar Nilsson', 2, 'blue'],
      ['Agnes Holmgren', 2, 'teal'],
      ['Henrik Holm', 2, 'indigo'],
      ['Familjen Nyström', 3, 'green'],
    ] },
    { time: '13:00', items: [
      ['Camilla Svensson', 2, 'rose'],
      ['Familjen Sjögren', 4, 'teal'],
      ['Johanna Sjöberg', 3, 'yellow'],
      ['Hugo Dahl', 2, 'amber'],
    ] },
    { time: '13:30', items: [
      ['Fredrik Björk', 2, 'blue'],
      ['Patrik Olsson', 2, 'indigo'],
      ['Matilda Åkesson', 2, 'violet'],
      ['Elin Karlsson', 2, 'rose'],
    ] },
    { time: '14:00', items: [['Erik Sandberg', 4, 'green']] },
  ];

  return (
    <div className="rounded-3xl border border-pink-100 shadow-[0_14px_40px_rgba(236,72,153,0.2)] overflow-hidden bg-white">
      {/* Top gradient header */}
      <div className="relative">
        <div className="h-36 sm:h-40 bg-gradient-to-br from-[#3d015f] via-[#2a0044] to-pink-700" />
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white drop-shadow">Dashboard</h2>
          <p className="text-white/90 text-sm sm:text-base">Övervaka bokningar, gäster och AI‑svar i realtid.</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button className="px-4 py-2 rounded-full bg-pink-600 text-white text-sm font-semibold shadow hover:bg-pink-700">Ny bokning</button>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="px-4 sm:px-6 md:px-8 py-4 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {stats.map((s) => (
          <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} />
        ))}
      </div>

      {/* Calendar + timeline */}
      <div className="px-4 sm:px-6 md:px-8 pb-6">
        <div className="grid lg:grid-cols-3 gap-4">
          {/* Left: Calendar card */}
          <div className="rounded-2xl border border-pink-200 bg-white p-2 shadow-sm text-[11px]">
            <div className="mb-2">
              <div className="flex items-center justify-center gap-2 text-gray-700">
                <button onClick={prevMonth} aria-label="Föregående månad" className="h-7 w-7 rounded-md border border-gray-200 hover:bg-gray-50">‹</button>
                <div className="text-xs font-semibold w-32 text-center select-none">{monthLabelCap}</div>
                <button onClick={nextMonth} aria-label="Nästa månad" className="h-7 w-7 rounded-md border border-gray-200 hover:bg-gray-50">›</button>
              </div>
            </div>
            <div className="grid grid-cols-7 text-center text-[9px] uppercase tracking-wide text-gray-500">
              {['Må', 'Ti', 'On', 'To', 'Fr', 'Lö', 'Sö'].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {cells.map((day, idx) => (
                <div
                  key={idx}
                  className={`h-6 w-6 md:h-7 md:w-7 mx-auto flex items-center justify-center rounded-md text-[10px] ${
                    day
                      ? isActiveDay(day)
                        ? 'bg-pink-600 text-white font-semibold ring-2 ring-pink-300 ring-offset-2'
                        : 'bg-gray-50 hover:bg-gray-100'
                      : 'invisible'
                  }`}
                >
                  {day ?? ''}
                </div>
              ))}
            </div>

            {/* Summary stats under calendar */}
            <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
              <div className="rounded-lg bg-gradient-to-br from-pink-600 to-rose-500 text-white px-2 py-1 flex items-center justify-between shadow-sm">
                <span className="font-semibold">Kvar idag</span>
                <span className="font-bold">26</span>
              </div>
              <div className="rounded-lg bg-purple-50 border border-purple-200 text-purple-900 px-2.5 py-1.5 flex items-center justify-between">
                <span>Morgon</span>
                <span>0</span>
              </div>
              <div className="rounded-lg bg-pink-50 border border-pink-200 text-pink-900 px-2.5 py-1.5 flex items-center justify-between">
                <span>Lunch</span>
                <span>20</span>
              </div>
              <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-900 px-2.5 py-1.5 flex items-center justify-between">
                <span>Kväll</span>
                <span>6</span>
              </div>
            </div>
          </div>

          {/* Right: Timeline */}
          <div className="lg:col-span-2 rounded-2xl border border-pink-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-3">
              <div className="flex gap-2">
                {['Alla', 'Frukost', 'Lunch', 'Middag'].map((tag) => (
                  <span
                    key={tag}
                    className={`px-2 py-1 rounded-full border ${
                      tag === 'Lunch' ? 'bg-pink-100 border-pink-200 text-pink-700' : 'bg-white border-gray-200'
                    }`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div>25 bokningar • 66 gäster</div>
            </div>

            <div className="space-y-2">
              {schedule.map((row) => (
                <div key={row.time} className="rounded-lg border border-gray-200 bg-white px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500 w-14 shrink-0">{row.time}</span>
                    <div className="flex flex-wrap gap-2">
                      {row.items.map(([name, guests, variant]) => (
                        <BookChip key={name + row.time} name={name} guests={guests} variant={variant} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="text-center text-xs text-gray-400 mt-4">© 2025 Bokäta</div>
      </div>
    </div>
  );
}

function StepCard({ index, title, text }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-pink-100 p-6 shadow-sm">
      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-7xl md:text-8xl font-black bg-gradient-to-br from-[#3d015f] to-pink-600 bg-clip-text text-transparent opacity-10 select-none">{index}</span>
      <h4 className="relative font-semibold mb-2">{title}</h4>
      <p className="relative text-gray-700">{text}</p>
    </div>
  );
}

function StatCard({ icon, label, value }) {
  return (
    <div className="rounded-xl border border-pink-200 bg-white p-4 shadow-sm flex items-center gap-3">
      <div className="text-lg select-none">{icon}</div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
        <div className="text-xl font-semibold text-gray-900">{value}</div>
      </div>
    </div>
  );
}

function BookChip({ name, guests, variant = 'gray' }) {
  const variants = {
    green: 'bg-green-100 text-green-800 border-green-200',
    teal: 'bg-teal-100 text-teal-800 border-teal-200',
    yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    amber: 'bg-amber-100 text-amber-800 border-amber-200',
    orange: 'bg-orange-100 text-orange-800 border-orange-200',
    blue: 'bg-blue-100 text-blue-800 border-blue-200',
    indigo: 'bg-indigo-100 text-indigo-800 border-indigo-200',
    violet: 'bg-violet-100 text-violet-800 border-violet-200',
    rose: 'bg-rose-100 text-rose-800 border-rose-200',
    gray: 'bg-gray-100 text-gray-800 border-gray-200',
  };
  const cls = variants[variant] || variants.gray;
  return (
    <span className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs font-medium ${cls}`}>
      <span className="truncate max-w-[10rem]">{name}</span>
      <span className="opacity-80">{guests} gäster</span>
      <span className="opacity-70">🍴</span>
    </span>
  );
}

function Feature({ children }) {
  return <div className="rounded-2xl bg-white p-5 border border-pink-100 shadow-sm">{children}</div>;
}

function PriceCard({ title, priceLine, note, cta, highlight, onSelect }) {
  return (
    <div
      className={`relative bg-white p-6 rounded-2xl shadow-sm border ${
        highlight ? 'border-2 border-pink-500' : 'border-pink-100'
      }`}
    >
      {highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs px-2 py-1 rounded-full bg-pink-600 text-white shadow">
          Populär
        </span>
      )}
      <h3 className="text-xl font-semibold mb-1">{title}</h3>
      <p className="text-gray-800">{priceLine}</p>
      {note && <p className="text-sm text-gray-500 mt-2">{note}</p>}
      <button onClick={()=>onSelect && onSelect({ title, price: priceLine, note })} className="mt-5 w-full rounded-full bg-pink-600 text-white py-2.5 hover:bg-pink-700">{cta}</button>
    </div>
  );
}

function PlanDrawer({ open, plan, onClose }) {
  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`}>
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      <aside
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl border-l border-pink-100 transform transition-transform ${open ? 'translate-x-0' : 'translate-x-full'}`}
        aria-hidden={!open}
      >
        <div className="p-6 flex items-start justify-between border-b">
          <div>
            <h3 className="text-xl font-bold">{plan?.title ?? 'Plan'}</h3>
            <p className="text-gray-600">{plan?.price}</p>
          </div>
          <button aria-label="Stäng" onClick={onClose} className="rounded-full px-2 py-1 hover:bg-gray-100">✕</button>
        </div>
        <div className="p-6 space-y-4 text-sm">
          <p>{plan?.note}</p>
          <ul className="list-disc list-inside space-y-1 text-gray-700">
            <li>Fakturering via Stripe.</li>
            <li>Ingen bindningstid på månadsplan.</li>
            <li>Avsluta när som helst inför nästa period.</li>
          </ul>
          <a href="/signup" className="inline-flex justify-center items-center px-4 py-2 rounded-full bg-pink-600 text-white font-semibold hover:bg-pink-700">Fortsätt</a>
        </div>
      </aside>
    </div>
  );
}

function PlanPill({ active, children, ...props }) {
  return (
    <button
      type="button"
      className={`px-3 py-1.5 rounded-full border text-sm ${active ? 'bg-pink-600 text-white border-pink-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
      {...props}
    >
      {children}
    </button>
  );
}

function AuthModal({ open, mode = 'login', onClose, onSubmit, onToggleMode }) {
  const [email, setEmail] = React.useState('');
  const [planKey, setPlanKey] = React.useState('manad');
  React.useEffect(()=>{ if(!open){ setEmail(''); setPlanKey('manad'); } }, [open]);
  const title = mode === 'signup' ? 'Skapa konto' : 'Logga in';
  const next = () => onSubmit && onSubmit(email, mode, planKey);
  const onKey = (e) => { if(e.key === 'Enter') next(); };
  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'hidden'}`}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-0 flex items-start justify-center mt-28 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-pink-100 p-6">
          <h3 className="text-2xl font-bold text-center mb-6">{title}</h3>

          {mode === 'signup' && (
            <div className="mb-4">
              <div className="text-sm font-medium mb-2">Välj plan</div>
              <div className="flex gap-2">
                <PlanPill active={planKey==='manad'} onClick={()=>setPlanKey('manad')}>Månad</PlanPill>
                <PlanPill active={planKey==='ettar'} onClick={()=>setPlanKey('ettar')}>1 år</PlanPill>
                <PlanPill active={planKey==='tvar'} onClick={()=>setPlanKey('tvar')}>2 år</PlanPill>
              </div>
            </div>
          )}

          <label className="block text-sm text-gray-700 mb-2">Ange e‑postadressen för ditt konto</label>
          <input
            type="email"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            onKeyDown={onKey}
            placeholder="E‑post"
            className="w-full h-12 rounded-lg border border-gray-300 px-4 mb-4 focus:outline-none focus:ring-2 focus:ring-pink-500"
          />
          <button onClick={next} className="w-full h-12 rounded-full bg-pink-700 text-white font-semibold">Nästa</button>
          <div className="text-center text-sm mt-4">
            {mode === 'login' ? (
              <span>Inget konto än? <button onClick={()=>onToggleMode && onToggleMode('signup')} className="text-pink-700 hover:underline">Skapa ett konto</button></span>
            ) : (
              <span>Har du redan ett konto? <button onClick={()=>onToggleMode && onToggleMode('login')} className="text-pink-700 hover:underline">Logga in</button></span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Faq({ q, a }) {
  return (
    <details className="group rounded-2xl border border-pink-100 p-5 open:bg-pink-50">
      <summary className="cursor-pointer list-none flex items-center justify-between gap-4">
        <span className="font-semibold text-gray-900">{q}</span>
        <span className="shrink-0 rounded-full border border-pink-200 px-2 py-0.5 text-xs">Öppna</span>
      </summary>
      <p className="mt-3 text-gray-700">{a}</p>
    </details>
  );
}
