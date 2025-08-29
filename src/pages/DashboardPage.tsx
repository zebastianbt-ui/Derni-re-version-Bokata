import React, { useEffect, useMemo, useRef, useState } from "react";

type Meal = "Alla" | "Frukost" | "Lunch" | "Middag";
type Booking = {
  id: string;
  date: string;
  time: string;
  name: string;
  guests: number;
  durationMin?: number;
  tableId?: number | null;
  status?: "pending" | "confirmed" | "cancelled";
  source?: "web" | "phone" | "walkin";
  note?: boolean;
  notes?: string;
  color?: string;
};
type PetsPolicy = "none" | "terrace" | "everywhere";
const DAYS_SV: readonly ["söndag","måndag","tisdag","onsdag","torsdag","fredag","lördag"] = [
  "söndag","måndag","tisdag","onsdag","torsdag","fredag","lördag"
];
type DayName = (typeof DAYS_SV)[number];
const DAYS_ORDER: DayName[] = ["måndag","tisdag","onsdag","torsdag","fredag","lördag","söndag"];

type Settings = {
  info: { email: string };
  seating: { groupThreshold: number; highChairs: number; allowCombineTables: boolean };
  policies: { vegan: boolean; glutenFree: boolean; lactoseFree: boolean; kidsMenu: boolean; strollerAllowed: boolean; pets: PetsPolicy; wheelchair: boolean };
  hours: { normal: Record<DayName, { closed: boolean; open: string; close: string }>; special: { date: string; closed: boolean; open: string; close: string }[] };
  ai: { name: string; allowAutoConfirm: boolean; outOfScopeReply: string; languages: string[]; knowledge: string; faq: string };
  escalation: { maxGuestsPerReservation: number; manualReviewKeywords: string[] };
  notifications: { to: string };
};

const MEAL_RANGES: Record<Meal, [string, string]> = {
  Alla: ["00:00", "23:59"],
  Frukost: ["08:00", "10:59"],
  Lunch: ["11:00", "14:30"],
  Middag: ["17:00", "21:30"],
};
const ENGINE = { slotStepMin: 30, durations: { Frukost: 60, Lunch: 90, Middag: 120 }, tables: [2,2,2,4,4,4,6,6] };
const MONTHS = ["januari","februari","mars","april","maj","juni","juli","augusti","september","oktober","november","december"];
const WD_SHORT = ["Må","Ti","On","To","Fr","Lö","Sö"];
const WD_FULL = ["Söndag","Måndag","Tisdag","Onsdag","Torsdag","Fredag","Lördag"];
const HOLIDAYS_2025 = [
  {date:"2025-01-01", name:"Nyårsdagen"},
  {date:"2025-01-06", name:"Trettondedag jul"},
  {date:"2025-05-01", name:"Första maj"},
  {date:"2025-05-29", name:"Kristi himmelsfärdsdag"},
  {date:"2025-06-06", name:"Nationaldagen"},
  {date:"2025-06-21", name:"Midsommardagen"},
  {date:"2025-12-25", name:"Juldagen"},
  {date:"2025-12-26", name:"Annandag jul"},
];
const pad2 = (n:number)=>String(n).padStart(2,"0");
const timeToMin = (t:string)=>{const [h,m]=t.split(":").map(Number);return h*60+m};
const minToTime = (m:number)=>`${pad2(Math.floor(m/60))}:${pad2(m%60)}`;
const round30 = (t:string)=>{const [h,m]=t.split(":").map(Number); if(m<15) return `${pad2(h)}:00`; if(m<45) return `${pad2(h)}:30`; return `${pad2((h+1)%24)}:00`;};
const mealFor = (t:string):Meal=>{const x=timeToMin(t); for(const m of ["Frukost","Lunch","Middag"] as Meal[]){const [a,b]=MEAL_RANGES[m]; if(x>=timeToMin(a)&&x<=timeToMin(b)) return m;} return "Alla"};
const overlap = (aS:number,aE:number,bS:number,bE:number)=>aS<bE&&bS<aE;
const uid = ()=>Math.random().toString(36).slice(2,10);

function assignTablesForDate(date:string, input:Booking[]):Booking[]{
  const tables = ENGINE.tables.map((cap,i)=>({id:i+1,cap}));
  const day = input.filter(b=>b.date===date).map(b=>({...b})).sort((a,b)=>b.guests-a.guests||timeToMin(a.time)-timeToMin(b.time));
  const out:Booking[]=[];
  for(const b of day){
    const dur=b.durationMin??ENGINE.durations[mealFor(b.time) as keyof typeof ENGINE.durations]??90;
    const s=timeToMin(round30(b.time)); const e=s+dur; let chosen:number|null=null;
    for(const t of tables.filter(t=>t.cap>=b.guests).sort((a,b)=>a.cap-b.cap)){
      const conflict=out.some(x=>x.tableId===t.id && overlap(s,e,timeToMin(round30(x.time)), timeToMin(round30(x.time)) + (x.durationMin??ENGINE.durations[mealFor(x.time) as keyof typeof ENGINE.durations])));
      if(!conflict){chosen=t.id; break;}
    }
    out.push({...b, tableId:chosen, durationMin:dur, time:round30(b.time)});
  }
  return [...input.filter(b=>b.date!==date), ...out];
}
function findAvailableTable({date,time,guests,bookings}:{date:string;time:string;guests:number;bookings:Booking[]}):number|null{
  const when=round30(time); const dur=ENGINE.durations[mealFor(when) as keyof typeof ENGINE.durations]??90; const s=timeToMin(when), e=s+dur;
  for(let i=0;i<ENGINE.tables.length;i++){ const id=i+1, cap=ENGINE.tables[i]; if(cap<guests) continue; const conflict=bookings.some(b=>b.date===date && b.tableId===id && overlap(s,e,timeToMin(round30(b.time)), timeToMin(round30(b.time))+(b.durationMin??ENGINE.durations[mealFor(b.time) as keyof typeof ENGINE.durations]))); if(!conflict) return id; }
  return null;
}

export default function ReservationDashboard(){
  const [activeMeal,setActiveMeal]=useState<Meal>("Lunch");
  const [openBooking,setOpenBooking]=useState<Booking|null>(null);
  const [createOpen,setCreateOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [month,setMonth]=useState(8); // 0-indexed (Sept)
  const [year,setYear]=useState(2025);
  const [selectedDay,setSelectedDay]=useState(5);
  const dateSel=`${year}-${pad2(month+1)}-${pad2(selectedDay)}`;

  const defaultSettings:Settings={
    info:{email:"bookings@example.se"},
    seating:{groupThreshold:6,highChairs:3,allowCombineTables:false},
    policies:{vegan:true,glutenFree:true,lactoseFree:true,kidsMenu:true,strollerAllowed:true,pets:"terrace",wheelchair:true},
    hours:{
      normal:{
        söndag:{closed:false,open:"11:00",close:"17:00"},
        måndag:{closed:false,open:"11:00",close:"17:00"},
        tisdag:{closed:false,open:"11:00",close:"17:00"},
        onsdag:{closed:false,open:"11:00",close:"17:00"},
        torsdag:{closed:false,open:"11:00",close:"17:00"},
        fredag:{closed:false,open:"11:00",close:"17:00"},
        lördag:{closed:false,open:"11:00",close:"17:00"},
      },
      special:[
        {date:"2025-05-29",closed:false,open:"09:00",close:"17:00"},
        {date:"2025-06-06",closed:false,open:"11:00",close:"17:00"},
        {date:"2025-06-20",closed:false,open:"11:00",close:"16:00"},
      ],
    },
    ai:{
      name:"Bokäta Assistant",
      allowAutoConfirm:true,
      outOfScopeReply:"Jag kan bara hjälpa till med bordsbokningar och relaterade frågor. Kontakta oss på {email}.",
      languages:["sv","en","fr"],
      knowledge:"",
      faq:[
        "Tar ni emot kontanter?",
        "Tar ni kort (Visa/Mastercard/Amex)? Swish?",
        "Vilka är era öppettider per dag?",
        "Hur lång är bordsbokningstiden per sittning?",
        "Hur tar man sig till er med kollektivtrafik?",
        "Finns det parkering i närheten?",
        "Tillgänglig entré och toalett?",
        "Erbjuder ni vegan-, gluten- och laktosfria alternativ?",
        "Finns barnstolar? Barnvagn? Barnmeny?",
        "Hundpolicy (ej/terrass/överallt)?",
        "Max antal gäster per bokning?",
      ].join("\n"),
    },
    escalation:{maxGuestsPerReservation:22, manualReviewKeywords:["privat event","bröllop","afterwork"]},
    notifications:{to:"bookings@example.se"},
  };
  const [config,setConfig]=useState<Settings>(defaultSettings);

  const seed:Booking[]=[
    {id:uid(),date:"2025-09-05",time:"11:00",name:"Emma Larsson",guests:2,color:"bg-green-200",note:true,notes:"Allergi: nötter (inga spår)."},
    {id:uid(),date:"2025-09-05",time:"11:30",name:"Klara Nyman",guests:2,color:"bg-green-200"},
    {id:uid(),date:"2025-09-05",time:"12:00",name:"Sara Lind",guests:3,color:"bg-yellow-200",note:true,notes:"Vegan + glutenfritt."},
    {id:uid(),date:"2025-09-05",time:"12:30",name:"Henrik Holm",guests:6,color:"bg-purple-200"},
    {id:uid(),date:"2025-09-05",time:"13:00",name:"Familjen Sjögren",guests:4,color:"bg-green-200",note:true,notes:"Barnstol. Hörnbord om möjligt."},
    {id:uid(),date:"2025-09-05",time:"18:00",name:"Familjen Karlsson",guests:8,color:"bg-yellow-200",note:true,notes:"Jordnöt – inga spår."},
  ];
  const [bookings,setBookings]=useState<Booking[]>(assignTablesForDate(dateSel, seed));

  const ALL_TIMES = useMemo(()=>{const mins=[MEAL_RANGES.Frukost[0],MEAL_RANGES.Lunch[0],MEAL_RANGES.Middag[0]].map(timeToMin); const maxs=[MEAL_RANGES.Frukost[1],MEAL_RANGES.Lunch[1],MEAL_RANGES.Middag[1]].map(timeToMin); const out:string[]=[]; for(let s=Math.min(...mins),e=Math.max(...maxs);s<=e;s+=ENGINE.slotStepMin) out.push(minToTime(s)); return out;},[]);

  const dayBookings=useMemo(()=>bookings.filter(b=>b.date===dateSel),[bookings,dateSel]);
  const filtered=useMemo(()=>{const [a,b]=MEAL_RANGES[activeMeal]; const s=timeToMin(a),e=timeToMin(b); return dayBookings.filter(bk=>{const t=timeToMin(bk.time); return t>=s&&t<=e}).sort((x,y)=>timeToMin(x.time)-timeToMin(y.time));},[activeMeal,dayBookings]);
  const displayBookings=useMemo(()=>filtered.map(b=>({...b,time:round30(b.time)})),[filtered]);
  const groupedByTime=useMemo(()=>{const g:Record<string,Booking[]>={}; for(const b of displayBookings){(g[b.time]??=[]).push(b);} return g;},[displayBookings]);
  const totalGuestsDay=useMemo(()=>dayBookings.reduce((s,b)=>s+b.guests,0),[dayBookings]);
  const totals=useMemo(()=>displayBookings.reduce((a,b)=>({count:a.count+1,guests:a.guests+b.guests}),{count:0,guests:0}),[displayBookings]);
  const busiestLeast=useMemo(()=>{const map=new Map<number,number>(); dayBookings.forEach(b=>{const h=Math.floor(timeToMin(b.time)/60); map.set(h,(map.get(h)||0)+1);}); if(!map.size) return {max:"–",min:"–"}; let maxH=-1,maxV=-1,minH=-1,minV=1e9; map.forEach((v,h)=>{if(v>maxV){maxV=v;maxH=h;} if(v<minV){minV=v;minH=h;}}); const hr=(h:number)=>`${pad2(h)}:00 – ${pad2((h+1)%24)}:00`; return {max:hr(maxH),min:hr(minH)};},[dayBookings]);
  const guestsByMeal=useMemo(()=>{const m:{[k in Meal]:number}={Alla:0,Frukost:0,Lunch:0,Middag:0}; dayBookings.forEach(b=>{const mf=mealFor(b.time); m[mf]+=b.guests; m.Alla+=b.guests;}); return m;},[dayBookings]);

  const [aiMsg,setAiMsg]=useState("");
  const [aiPreview,setAiPreview]=useState("");
  const knowledgeRef=useRef<HTMLTextAreaElement>(null);
  const faqItems=useMemo(()=>config.ai.faq.split("\n").map(s=>s.trim()).filter(Boolean),[config.ai.faq]);
  const insertFaqIntoKnowledge=(q:string)=>{const block=`Fråga: ${q}\nSvar: \n\n`; setConfig(prev=>{const exists=prev.ai.knowledge.includes(q); const kn=exists?prev.ai.knowledge:(prev.ai.knowledge?(prev.ai.knowledge.endsWith("\n")?prev.ai.knowledge+block:prev.ai.knowledge+"\n"+block):block); return {...prev, ai:{...prev.ai, knowledge:kn}}}); setTimeout(()=>knowledgeRef.current?.focus(),0);};

  function isBookingIntent(txt:string){const t=txt.toLowerCase(); return /(boka|booking|reservation|reservera|bord|table)/.test(t) || /\b\d{1,2}[:\.h]\d{2}\b/.test(t) || /\b\d{1,2}\s*(gäster|guests|personer|pers)\b/.test(t)}
  function extractGuests(txt:string){const nums=(txt.match(/\d+/g)||[]).map(Number).filter(n=>n>0&&n<500); return nums.length?Math.max(...nums):null}
  function aiRespond(text:string){ if(!isBookingIntent(text)) return config.ai.outOfScopeReply.replace("{email}",config.notifications.to); const guests=extractGuests(text)??2; if(guests>config.escalation.maxGuestsPerReservation) return `Tack! För ${guests} gäster behöver vi manuell bekräftelse. Vi återkommer snarast.`; return `Förfrågan mottagen för ${guests} gäster.`; }

  const [formDate,setFormDate]=useState<string>(dateSel);
  const [formTime,setFormTime]=useState<string>("12:00");
  const [formName,setFormName]=useState<string>("");
  const [formGuests,setFormGuests]=useState<number>(2);
  const [formNotes,setFormNotes]=useState<string>("");
  const [formError,setFormError]=useState<string|null>(null);
  useEffect(()=>{ if(createOpen){ setFormDate(dateSel); setFormTime("12:00"); setFormName(""); setFormGuests(2); setFormNotes(""); setFormError(null);} },[createOpen,dateSel]);
  const handleCreate=()=>{ const res=createReservation({date:formDate,time:formTime,name:formName,guests:formGuests,notes:formNotes}); if(!(res as any).ok){ setFormError((res as any).error||"Kunde inte spara."); return; } setFormError(null); const d=new Date(formDate); if(!Number.isNaN(d.getTime())){ setYear(d.getFullYear()); setMonth(d.getMonth()); setSelectedDay(d.getDate()); } setCreateOpen(false); };

  const upsertSpecialByDate = (date: string, patch: Partial<{closed:boolean; open:string; close:string}>) => {
    setConfig(prev => {
      const arr = prev.hours.special.slice();
      const idx = arr.findIndex(s => s.date === date);
      if (idx === -1) arr.push({ date, closed: true, open: "11:00", close: "17:00", ...patch });
      else arr[idx] = { ...arr[idx], ...patch } as any;
      return { ...prev, hours: { ...prev.hours, special: arr } };
    });
  };

  function createReservation(d:{date:string;time:string;name:string;guests:number;notes?:string}){
    if(!d.name.trim()) return {ok:false,error:"Namn krävs."}; if(!d.date) return {ok:false,error:"Datum krävs."}; if(!d.time) return {ok:false,error:"Tid krävs."}; if(d.guests<1) return {ok:false,error:"Ogiltigt antal gäster."}; if(d.guests>config.escalation.maxGuestsPerReservation) return {ok:false,error:"Kräver manuell bekräftelse p.g.a. gruppstorlek."};
    const when=round30(d.time); const tableId=findAvailableTable({date:d.date,time:when,guests:d.guests,bookings}); if(tableId==null) return {ok:false,error:"Ingen ledig passande bord i detta tidsintervall."};
    const dur=ENGINE.durations[mealFor(when) as keyof typeof ENGINE.durations]??90; const colors=["bg-green-200","bg-blue-200","bg-yellow-200","bg-pink-200","bg-purple-200"]; const b:Booking={id:uid(),date:d.date,time:when,name:d.name.trim(),guests:d.guests,notes:d.notes,note:!!d.notes,color:colors[Math.floor(Math.random()*colors.length)],tableId,durationMin:dur,status:"confirmed",source:"web"};
    setBookings(prev=>assignTablesForDate(d.date,[...prev,b])); return {ok:true};
  }

  // Header
  return (
    <div className="min-h-screen bg-pink-50 p-6">
      <header className="-mx-1 mb-8 rounded-2xl bg-gradient-to-br from-[#180033] via-[#2a0146] to-[#3b024f] px-6 py-10 text-white shadow-lg">
        <div className="max-w-6xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-black tracking-tight">Dashboard</h1>
          <p className="mt-3 text-lg md:text-xl text-white/80 max-w-2xl mx-auto">Övervaka bokningar, gäster och AI-svar i realtid.</p>
          <div className="mt-6 flex flex-wrap gap-3 justify-center">
            <button className="rounded-full px-6 py-3 font-semibold text-white bg-pink-500 hover:bg-pink-600 shadow-md ring-1 ring-pink-300" onClick={()=>setCreateOpen(true)}>Ny bokning</button>
            <button className="rounded-full px-6 py-3 font-semibold text-white/90 bg-white/10 border border-white/20 hover:bg-white/15" onClick={()=>setSettingsOpen(true)}>Inställningar</button>
          </div>
        </div>
      </header>

      {/* Top stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">📅 Bokningar idag</p><h2 className="text-xl font-bold text-gray-800">{dayBookings.length}</h2></div>
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">👨‍👩‍👧‍👦 Antal gäster idag</p><h2 className="text-xl font-bold text-gray-800">{totalGuestsDay}</h2></div>
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">🕓 Mest bokade tid</p><h2 className="text-xl font-bold text-gray-800">{busiestLeast.max}</h2></div>
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">🕓 Minst bokade tid</p><h2 className="text-xl font-bold text-gray-800">{busiestLeast.min}</h2></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">📊 Totalt denna vecka</p><h2 className="text-xl font-bold text-gray-800">348</h2></div>
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">💖 Stammiskunder</p><h2 className="text-xl font-bold text-gray-800">35</h2></div>
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">⭐️ Google-recensioner</p><h2 className="text-xl font-bold text-gray-800">4.8 ★</h2><p className="text-xs text-gray-500">12 nya denna vecka</p></div>
        <div className="bg-white p-4 shadow-lg rounded-lg border border-pink-300"><p className="text-sm text-gray-500">🤖 Svar skickade av AI denna vecka</p><h2 className="text-xl font-bold text-gray-800">37</h2></div>
      </div>

      {/* Calendar + Day view */}
      <div className="bg-white shadow rounded-lg p-4">
        <h3 className="text-lg font-bold text-gray-700 mb-4">{(()=>{const dim=new Date(year,month+1,0).getDate(); const d=Math.min(selectedDay,dim); const dd=new Date(year,month,d); return `${WD_FULL[dd.getDay()]} ${d} ${MONTHS[month]} ${year}`;})()}</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Month */}
          <div className="border border-gray-300 rounded-lg p-4">
            <div className="grid grid-cols-3 items-center mb-2">
              <button className="justify-self-start h-8 w-8 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50" onClick={()=>setMonth(m=>{if(m===0){setYear(y=>y-1); return 11;} return m-1;})} aria-label="Föregående månad">‹</button>
              <p className="justify-self-center text-sm font-bold text-gray-700 text-center">{MONTHS[month]} {year}</p>
              <button className="justify-self-end h-8 w-8 rounded-full border border-pink-300 text-pink-700 hover:bg-pink-50" onClick={()=>setMonth(m=>{if(m===11){setYear(y=>y+1); return 0;} return m+1;})} aria-label="Nästa månad">›</button>
            </div>
            <div className="grid grid-cols-7 text-center text-sm text-gray-700 gap-1">
              {WD_SHORT.map(d=>(<div key={d} className="font-semibold text-gray-500">{d}</div>))}
              {(()=>{const off=(new Date(year,month,1).getDay()+6)%7; const days=new Date(year,month+1,0).getDate(); const disp=Math.min(selectedDay,days); const blanks=Array.from({length:off},(_,i)=><div key={`b-${i}`}/>); const cells=Array.from({length:days},(_,i)=>{const day=i+1; const sel=day===disp; return (<div key={day} onClick={()=>setSelectedDay(day)} className={`rounded-full w-8 h-8 flex items-center justify-center ${sel?"bg-pink-500 text-white font-bold ring-2 ring-pink-700":"text-gray-800 hover:bg-gray-100 cursor-pointer"}`} role="button" tabIndex={0} aria-label={`Välj ${day} ${MONTHS[month]} ${year}`}>{day}</div>);}); return [...blanks,...cells];})()}
            </div>
          </div>

          {/* Day schedule */}
          <div className="md:col-span-3 border border-gray-300 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {(["Alla","Frukost","Lunch","Middag"] as Meal[]).map(m=>{const on=activeMeal===m; return (
                <button key={m} className={`px-3 py-1 text-sm rounded transition border focus:outline-none focus:ring-2 focus:ring-pink-400 ${on?"bg-pink-100 border-pink-500 text-pink-700 font-bold":"bg-white border-pink-300 text-pink-600 hover:bg-pink-50"}`} onClick={()=>setActiveMeal(m)} aria-pressed={on}>{m} ({guestsByMeal[m]})</button>
              );})}
              <span className="ml-auto text-xs text-gray-500">{totals.count} bokningar • {totals.guests} gäster</span>
            </div>
            {Object.keys(groupedByTime).length===0?(
              <div className="text-sm text-gray-500 italic p-3 bg-gray-50 rounded border border-dashed border-gray-300">Inga bokningar i denna tidsperiod.</div>
            ):(
              <div className="space-y-2">
                {Object.keys(groupedByTime).sort((a,b)=>timeToMin(a)-timeToMin(b)).map(time=>(
                  <div key={time} className="bg-gray-50 rounded-md p-2 border border-gray-200">
                    <div className="flex items-start gap-3">
                      <div className="w-14 shrink-0 text-sm font-semibold text-gray-700 pt-1">{time}</div>
                      <div className="flex flex-wrap gap-2">
                        {groupedByTime[time].map((b,idx)=>(
                          <div key={`${time}-${idx}`} className={`px-2 py-1 rounded shadow border text-sm text-gray-700 ${b.color??"bg-pink-100"} ${b.note?"cursor-pointer hover:brightness-95":""}`} onClick={b.note?()=>setOpenBooking(b):undefined} role={b.note?"button":undefined} tabIndex={b.note?0:-1} title={b.note?"Visa anteckning":undefined}>
                            <div className="font-medium">{b.name}{b.note&&<span className="ml-1">📎</span>}</div>
                            <div className="text-xs text-gray-600">{b.guests} gäster</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Note modal */}
      {openBooking&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setOpenBooking(null)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-xl w-[92vw] max-w-md p-6 border border-pink-200">
            <button className="absolute top-3 right-3 text-gray-500 hover:text-gray-700" onClick={()=>setOpenBooking(null)} aria-label="Stäng">✕</button>
            <h4 className="text-lg font-bold text-gray-800">{openBooking.name} – {openBooking.time}</h4>
            <p className="text-sm text-gray-500 mb-4">{openBooking.guests} gäster{openBooking.tableId?` • Bord ${openBooking.tableId}`:""}</p>
            <div className="bg-pink-50 border border-pink-200 rounded-lg p-3 text-gray-800 whitespace-pre-wrap">{openBooking.notes||"(Ingen anteckning)"}</div>
            <div className="mt-5 flex justify-end"><button className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow" onClick={()=>setOpenBooking(null)}>OK</button></div>
          </div>
        </div>
      )}

      {/* Create booking */}
      {createOpen&&(
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setCreateOpen(false)} aria-hidden="true" />
          <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-xl w-[92vw] max-w-md p-6 border border-pink-200">
            <button className="absolute top-3 right-3 text-gray-500 hover:text-gray-700" onClick={()=>setCreateOpen(false)} aria-label="Stäng">✕</button>
            <h4 className="text-lg font-bold text-gray-800">Ny bokning</h4>
            <div className="mt-4 space-y-3">
              <label className="block text-sm"><span className="text-gray-600">Datum</span><input type="date" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={formDate} onChange={e=>setFormDate(e.target.value)} /></label>
              <label className="block text-sm"><span className="text-gray-600">Tid</span><select className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={formTime} onChange={e=>setFormTime(e.target.value)}>{ALL_TIMES.map(t=>(<option key={t}>{t}</option>))}</select></label>
              <label className="block text-sm"><span className="text-gray-600">Namn</span><input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" placeholder="För- och efternamn" value={formName} onChange={e=>setFormName(e.target.value)} /></label>
              <label className="block text-sm"><span className="text-gray-600">Gäster</span><input type="number" min={1} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={formGuests} onChange={e=>setFormGuests(Math.max(1,Number(e.target.value)||1))} /></label>
              <label className="block text-sm"><span className="text-gray-600">Anteckning</span><textarea rows={3} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" placeholder="Allergier, barnstol, hund, vegan…" value={formNotes} onChange={e=>setFormNotes(e.target.value)} /></label>
            </div>
            {formError&&(<div className="pt-2 text-sm text-red-600">{formError}</div>)}
            <div className="pt-4 flex justify-end gap-2"><button className="px-4 py-2 rounded-lg border border-gray-300" onClick={()=>setCreateOpen(false)}>Avbryt</button><button className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow" onClick={handleCreate}>Skapa</button></div>
          </div>
        </div>
      )}

      {/* Settings */}
      {settingsOpen&&(
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={()=>setSettingsOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 top-0 h-full w-full max-w-2xl bg-gradient-to-b from-pink-50 via-white to-purple-50 shadow-xl border-l border-pink-200 p-6 overflow-y-auto">
            <div className="sticky top-0 z-10 flex items-center justify-between mb-4 bg-white/80 backdrop-blur border-b border-pink-200 rounded-t-xl px-1 py-3">
              <h4 className="text-xl font-bold text-gray-800">Inställningar</h4>
              <button className="text-gray-500 hover:text-gray-700" onClick={()=>setSettingsOpen(false)} aria-label="Stäng">✕</button>
            </div>

            <div className="space-y-6">
              <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
                <h5 className="font-semibold mb-3 text-pink-700">Restauranginfo</h5>
                <label className="block text-sm mb-2">E‑post för bokningar<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.info.email} onChange={e=>setConfig({...config, info:{...config.info, email:e.target.value}})} /></label>
              </section>

              <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
                <h5 className="font-semibold mb-3 text-pink-700">Kapacitet & tider</h5>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">Gräns för grupp<input type="number" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.seating.groupThreshold} onChange={e=>setConfig({...config, seating:{...config.seating, groupThreshold:Math.max(1,Number(e.target.value)||1)}})} /></label>
                  <label className="text-sm">Barnstolar<input type="number" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.seating.highChairs} onChange={e=>setConfig({...config, seating:{...config.seating, highChairs:Math.max(0,Number(e.target.value)||0)}})} /></label>
                  <label className="text-sm col-span-2">Max gäster per bokning<input type="number" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.escalation.maxGuestsPerReservation} onChange={e=>setConfig({...config, escalation:{...config.escalation, maxGuestsPerReservation:Math.max(1,Number(e.target.value)||1)}})} /></label>
                </div>

                <div className="mt-6">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Öppettider (normala)</div>
                  <div className="divide-y rounded-lg border border-pink-200 bg-pink-50/40">
                    {DAYS_ORDER.map(day=>{const d=config.hours.normal[day]; return (
                      <div key={day} className="grid grid-cols-12 items-center gap-2 px-3 py-2">
                        <div className="col-span-3 capitalize">{day}</div>
                        <label className="col-span-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={d.closed} onChange={e=>setConfig(prev=>({...prev,hours:{...prev.hours,normal:{...prev.hours.normal,[day]:{...prev.hours.normal[day],closed:e.target.checked}}}}))} />Stängt</label>
                        <div className="col-span-3"><input type="time" className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60" value={d.open} onChange={e=>setConfig(prev=>({...prev,hours:{...prev.hours,normal:{...prev.hours.normal,[day]:{...prev.hours.normal[day],open:e.target.value}}}}))} disabled={d.closed} /></div>
                        <div className="col-span-3"><input type="time" className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60" value={d.close} onChange={e=>setConfig(prev=>({...prev,hours:{...prev.hours,normal:{...prev.hours.normal,[day]:{...prev.hours.normal[day],close:e.target.value}}}}))} disabled={d.closed} /></div>
                      </div>
                    );})}
                  </div>
                </div>

                <div className="mt-6">
                  <div className="text-sm font-semibold text-gray-700 mb-2">Särskilda öppettider</div>
                  <div className="space-y-2">
                    {config.hours.special.map((sp,idx)=>(
                      <div key={idx} className="grid grid-cols-12 items-center gap-2">
                        <div className="col-span-3"><input type="date" className="w-full rounded-md border border-gray-300 px-2 py-1" value={sp.date} onChange={e=>setConfig(prev=>{const arr=prev.hours.special.slice(); arr[idx]={...arr[idx],date:e.target.value}; return {...prev,hours:{...prev.hours,special:arr}}})} /></div>
                        <label className="col-span-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={sp.closed} onChange={e=>setConfig(prev=>{const arr=prev.hours.special.slice(); arr[idx]={...arr[idx],closed:e.target.checked}; return {...prev,hours:{...prev.hours,special:arr}}})} />Stängt</label>
                        <div className="col-span-3"><input type="time" className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60" value={sp.open} onChange={e=>setConfig(prev=>{const arr=prev.hours.special.slice(); arr[idx]={...arr[idx],open:e.target.value}; return {...prev,hours:{...prev.hours,special:arr}}})} disabled={sp.closed} /></div>
                        <div className="col-span-3"><input type="time" className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60" value={sp.close} onChange={e=>setConfig(prev=>{const arr=prev.hours.special.slice(); arr[idx]={...arr[idx],close:e.target.value}; return {...prev,hours:{...prev.hours,special:arr}}})} disabled={sp.closed} /></div>
                        <div className="col-span-1 text-right"><button className="px-2 py-1 rounded-md border hover:bg-gray-50" onClick={()=>setConfig(prev=>({...prev,hours:{...prev.hours,special:prev.hours.special.filter((_,i)=>i!==idx)}}))}>🗑️</button></div>
                      </div>
                    ))}
                    <button className="mt-1 inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-pink-300 text-pink-700 bg-white hover:bg-pink-50" onClick={()=>setConfig(prev=>({...prev,hours:{...prev.hours,special:[...prev.hours.special,{date:new Date().toISOString().slice(0,10),closed:false,open:"11:00",close:"17:00"}]}}))}>+ Lägg till dag</button>
                  </div>
                </div>
              </section>

              <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
                <h5 className="font-semibold mb-3 text-pink-700">Röda dagar (helgdagar)</h5>
                <div className="space-y-2">
                  {HOLIDAYS_2025.map(h => {
                    const sp = config.hours.special.find(s => s.date === h.date) || { date: h.date, closed: true, open: "11:00", close: "17:00" };
                    return (
                      <div key={h.date} className="grid grid-cols-12 items-center gap-2">
                        <div className="col-span-4">{h.name}<div className="text-xs text-gray-500">{h.date}</div></div>
                        <label className="col-span-2 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={sp.closed} onChange={e=>upsertSpecialByDate(h.date,{closed:e.target.checked})} />Stängt</label>
                        <div className="col-span-3"><input type="time" className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60" value={sp.open} onChange={e=>upsertSpecialByDate(h.date,{open:e.target.value})} disabled={sp.closed} /></div>
                        <div className="col-span-3"><input type="time" className="w-full rounded-md border border-gray-300 px-2 py-1 disabled:opacity-60" value={sp.close} onChange={e=>upsertSpecialByDate(h.date,{close:e.target.value})} disabled={sp.closed} /></div>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
                <h5 className="font-semibold mb-3 text-pink-700">Policies</h5>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={config.policies.vegan} onChange={e=>setConfig({...config,policies:{...config.policies,vegan:e.target.checked}})} />Vegan</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={config.policies.glutenFree} onChange={e=>setConfig({...config,policies:{...config.policies,glutenFree:e.target.checked}})} />Glutenfri</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={config.policies.lactoseFree} onChange={e=>setConfig({...config,policies:{...config.policies,lactoseFree:e.target.checked}})} />Laktosfri</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={config.policies.kidsMenu} onChange={e=>setConfig({...config,policies:{...config.policies,kidsMenu:e.target.checked}})} />Barnmeny</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={config.policies.strollerAllowed} onChange={e=>setConfig({...config,policies:{...config.policies,strollerAllowed:e.target.checked}})} />Barnvagn tillåten</label>
                  <label className="inline-flex items-center gap-2"><input type="checkbox" checked={config.policies.wheelchair} onChange={e=>setConfig({...config,policies:{...config.policies,wheelchair:e.target.checked}})} />Rullstolsvänligt</label>
                  <label className="col-span-2 text-sm">Djur
                    <select className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.policies.pets} onChange={e=>setConfig({...config,policies:{...config.policies,pets:e.target.value as PetsPolicy}})}>
                      <option value="none">Inga</option>
                      <option value="terrace">Endast terrass</option>
                      <option value="everywhere">Överallt</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
                <h5 className="font-semibold mb-3 text-pink-700">AI‑profil & kunskapsbas</h5>
                <label className="block text-sm mb-2">Namn på assistent<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.ai.name} onChange={e=>setConfig({...config, ai:{...config.ai, name:e.target.value}})} /></label>
                <label className="block text-sm mb-2">Kunskapsbas (affärsinfo för bokning)<textarea rows={4} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" ref={knowledgeRef} value={config.ai.knowledge} onChange={e=>setConfig({...config, ai:{...config.ai, knowledge:e.target.value}})} /></label>
                <div className="text-sm">
                  <div className="mb-2 text-gray-700">Vanliga frågor</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {faqItems.map((q,i)=>(
                      <button key={i} type="button" className="border border-pink-300 rounded-lg p-3 bg-pink-50 text-gray-800 hover:bg-pink-100 hover:border-pink-400 transition text-left focus:outline-none focus:ring-2 focus:ring-pink-400" onClick={()=>insertFaqIntoKnowledge(q)} aria-label={`Använd FAQ: ${q}`}>{q}</button>
                    ))}
                  </div>
                </div>
                <div className="mt-4">
                  <textarea rows={2} className="w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="Skriv en fråga för att förhandsvisa svaret" value={aiMsg} onChange={e=>setAiMsg(e.target.value)} />
                  <div className="mt-2 flex gap-2">
                    <button className="px-4 py-2 rounded-lg bg-pink-500 text-white hover:bg-pink-600 shadow" onClick={()=>setAiPreview(aiRespond(aiMsg))}>Förhandsvisa</button>
                    <button className="px-4 py-2 rounded-lg border" onClick={()=>setAiPreview("")}>Rensa</button>
                  </div>
                  {aiPreview && <div className="mt-3 p-3 rounded-lg border border-pink-200 bg-gray-50 text-sm text-gray-800 whitespace-pre-wrap"><div className="mb-1 font-semibold text-pink-700">Svar från {config.ai.name}</div>{aiPreview}</div>}
                </div>
              </section>

              <section className="border border-pink-200 rounded-xl p-4 bg-white shadow-sm">
                <h5 className="font-semibold mb-3 text-pink-700">Aviseringar</h5>
                <label className="block text-sm">Mottagare<input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400 focus:border-pink-300" value={config.notifications.to} onChange={e=>setConfig({...config, notifications:{...config.notifications, to:e.target.value}})} /></label>
              </section>

              <div className="flex justify-end gap-2"><button className="px-4 py-2 rounded-lg border" onClick={()=>setSettingsOpen(false)}>Stäng</button></div>
            </div>
          </div>
        </div>
      )}

      <footer className="mt-12 text-center text-sm text-gray-400">© {new Date().getFullYear()} Bokäta</footer>
    </div>
  );
}
