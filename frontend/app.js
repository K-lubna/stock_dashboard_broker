(() => {
  const SUPPORTED = ["GOOG", "TSLA", "AMZN", "META", "NVDA"];
  const PRICE_KEY = "sb_prices_v5";
  const CHANNEL = "sb_channel_v5";
  const PRICE_INTERVAL_MS = 1000;

  // Elements
  const loginScreen = document.getElementById("login-screen");
  const dashboardScreen = document.getElementById("dashboard-screen");
  const loginForm = document.getElementById("login-form");
  const emailInput = document.getElementById("email-input");
  const userEmailEl = document.getElementById("user-email");
  const logoutBtn = document.getElementById("logout-btn");
  const stockListEl = document.getElementById("stock-list");
  const subsListEl = document.getElementById("subs-list");
  const pricesGridEl = document.getElementById("prices-grid");

  let currentUser = null;
  let prices = loadPrices();
  let bc = null;
  let priceTimer = null;
  let lastRenderedPrices = {};
  
  // User portfolio and favorites stored in localStorage
  function portfolioKey(email){ return `portfolio_${email}`; }
  function favoritesKey(email){ return `favorites_${email}`; }

  initUI();
  startBroadcast();

  function initUI() {
    stockListEl.innerHTML = "";
    SUPPORTED.forEach(sym => {
      const btn = document.createElement("button");
      btn.className = "stock-btn";
      btn.dataset.symbol = sym;
      btn.textContent = sym;
      btn.addEventListener("click", () => toggleSubscription(sym));
      stockListEl.appendChild(btn);
    });

    loginForm.addEventListener("submit", e => {
      e.preventDefault();
      const email = (emailInput.value || "").trim().toLowerCase();
      if (!email) return alert("Please enter an email.");
      login(email);
    });

    logoutBtn.addEventListener("click", logout);

    const saved = sessionStorage.getItem("sb_user");
    if(saved) login(saved, { restoreFocus:true });
    else showScreen("login");

    renderPrices();
  }

  function loadPrices() {
    try {
      const raw = localStorage.getItem(PRICE_KEY);
      if (raw) return JSON.parse(raw);
    } catch {}
    const now = Date.now();
    const p = {};
    SUPPORTED.forEach((s,i)=>{p[s]={symbol:s, price:Number((100+i*200+Math.random()*200).toFixed(2)), last:now}});
    localStorage.setItem(PRICE_KEY, JSON.stringify(p));
    return p;
  }

  function savePrices(toSave){
    prices = toSave;
    localStorage.setItem(PRICE_KEY, JSON.stringify(toSave));
  }

  function startBroadcast(){
    if("BroadcastChannel" in window){
      bc = new BroadcastChannel(CHANNEL);
      bc.onmessage = ev => {
        const {type,payload} = ev.data||{};
        if(type==="prices"){ savePrices(payload); renderPrices(); }
        if(type==="request-prices"){ bc.postMessage({type:"prices",payload:prices}); }
        if(type==="subs-update"){ if(payload.email===currentUser){ renderSubscriptions(); renderPrices(); refreshStockButtons(); } }
      };
      bc.postMessage({type:"request-prices"});
    }
    window.addEventListener("storage", ev => {
      if(ev.key===PRICE_KEY && ev.newValue){ prices = JSON.parse(ev.newValue); renderPrices(); }
    });
  }

  function startPriceUpdates(){
    if(priceTimer) return;
    priceTimer = setInterval(()=>{
      const updated = {...prices};
      SUPPORTED.forEach(s=>{
        const change = (Math.random()-0.5)*4;
        const old = updated[s]?.price || 100;
        updated[s]={symbol:s, price:Number(Math.max(1,(old+change)).toFixed(2)), last:Date.now()};
      });
      savePrices(updated);
      renderPrices();
      if(bc) bc.postMessage({type:"prices",payload:updated});
    },PRICE_INTERVAL_MS);
  }

  function stopPriceUpdates(){ if(priceTimer){clearInterval(priceTimer); priceTimer=null;} }

  function login(email, opts={}){
    currentUser=email;
    sessionStorage.setItem("sb_user",email);
    userEmailEl.textContent=email;
    showScreen("dashboard");
    restoreSubscriptionsUI();
    startPriceUpdates();
    if(!opts.restoreFocus) window.scrollTo(0,0);
    initUserPortfolio();
  }

  function logout(){
    sessionStorage.removeItem("sb_user");
    currentUser=null;
    showScreen("login");
    stopPriceUpdates();
  }

  // --- Subscriptions / Favorites ---
  function subsKey(email){ return `subs_${email}`; }
  function getSubscriptions(email){ 
    try{ const raw=localStorage.getItem(subsKey(email)); return raw?JSON.parse(raw):[] }catch(e){return[]} 
  }
  function setSubscriptions(email,arr){ 
    localStorage.setItem(subsKey(email),JSON.stringify(arr)); 
    renderSubscriptions(); 
    if(bc) bc.postMessage({type:"subs-update",payload:{email,subs:arr}}); 
  }
  function toggleSubscription(sym){
    if(!currentUser) return alert("Login first");
    const cur=getSubscriptions(currentUser);
    const next = cur.includes(sym) ? cur.filter(s=>s!==sym) : [...cur,sym];
    setSubscriptions(currentUser,next);
    refreshStockButtons();
  }

  function removeSubscription(sym){
    const cur=getSubscriptions(currentUser).filter(s=>s!==sym);
    setSubscriptions(currentUser,cur);
    renderPrices();
  }

  // --- Portfolio ---
  function initUserPortfolio(){
    if(!currentUser) return;
    if(!localStorage.getItem(portfolioKey(currentUser))){
      const portfolio = { cash:10000, stocks:{} };
      localStorage.setItem(portfolioKey(currentUser), JSON.stringify(portfolio));
    }
  }

  function buyStock(sym){
    const portfolio = JSON.parse(localStorage.getItem(portfolioKey(currentUser)));
    const price = prices[sym].price;
    if(portfolio.cash < price) return alert("Not enough cash!");
    portfolio.cash -= price;
    portfolio.stocks[sym] = (portfolio.stocks[sym]||0)+1;
    localStorage.setItem(portfolioKey(currentUser), JSON.stringify(portfolio));
    renderPrices();
  }

  function sellStock(sym){
    const portfolio = JSON.parse(localStorage.getItem(portfolioKey(currentUser)));
    if(!(portfolio.stocks[sym]>0)) return alert("No shares to sell!");
    portfolio.stocks[sym] -=1;
    portfolio.cash += prices[sym].price;
    localStorage.setItem(portfolioKey(currentUser), JSON.stringify(portfolio));
    renderPrices();
  }

  function showScreen(name){
    if(name==="login"){ loginScreen.classList.remove("hidden"); dashboardScreen.classList.add("hidden"); }
    else { loginScreen.classList.add("hidden"); dashboardScreen.classList.remove("hidden"); }
  }

  function refreshStockButtons(){
    const subs = currentUser?getSubscriptions(currentUser):[];
    stockListEl.querySelectorAll(".stock-btn").forEach(btn=>{btn.classList.toggle("subbed",subs.includes(btn.dataset.symbol))});
  }

  function renderSubscriptions(){
    if(!currentUser){ subsListEl.textContent="Login to see subscriptions."; return; }
    const subs=getSubscriptions(currentUser);
    subsListEl.innerHTML="";
    if(subs.length===0){ subsListEl.textContent="No subscriptions yet."; return; }
    subs.forEach(s=>{
      const div=document.createElement("div");
      div.className="sub-item";
      div.innerHTML=`${s} <button class="remove-sub" onclick="removeSubscription('${s}')">x</button>`;
      subsListEl.appendChild(div);
    });
  }

  // --- Render Prices + Portfolio + Recommendations ---
  function renderPrices(){
    if(!pricesGridEl) return;
    pricesGridEl.innerHTML="";

    let showSymbols = currentUser ? getSubscriptions(currentUser) : SUPPORTED;
    if(currentUser){
      const subs = getSubscriptions(currentUser);
      showSymbols = subs.length ? subs : SUPPORTED;
    }

    const portfolio = currentUser?JSON.parse(localStorage.getItem(portfolioKey(currentUser))):null;

    // Compute top gainers/losers
    const changes = showSymbols.map(s=>{
      const old = lastRenderedPrices[s]?.price || prices[s].price;
      const delta = Number((prices[s].price - old).toFixed(2));
      return {symbol:s, delta};
    });
    const topGainers = [...changes].sort((a,b)=>b.delta-a.delta).slice(0,2);
    const topLosers = [...changes].sort((a,b)=>a.delta-b.delta).slice(0,2);

    showSymbols.forEach(sym=>{
      const p = prices[sym];
      const prev = lastRenderedPrices[sym]?.price || p.price;
      const delta = Number((p.price - prev).toFixed(2));
      const deltaSign = delta>0?"up":(delta<0?"down":"same");
      const deltaText = delta===0?"":`${delta>0?"▲":"▼"} ${Math.abs(delta).toFixed(2)}`;

      const card = document.createElement("div");
      card.className="price-card";

      // Portfolio buttons
      const shares = portfolio?.stocks[sym]||0;
      const cash = portfolio?.cash||0;

      card.innerHTML=`
        <div class="price-symbol">${p.symbol}</div>
        <div class="price-value">₹ ${p.price} <span class="delta ${deltaSign}">${deltaText}</span></div>
        ${currentUser?`
        <div class="muted tiny">Cash: ₹ ${cash.toFixed(2)}, Shares: ${shares}</div>
        <button class="btn primary" onclick="buyStock('${sym}')">Buy 1</button>
        <button class="btn ghost" onclick="sellStock('${sym}')">Sell 1</button>
        `:""}
        ${topGainers.some(t=>t.symbol===sym)?'<div class="muted tiny" style="color:#22c55e">Top Gainer!</div>':""}
        ${topLosers.some(t=>t.symbol===sym)?'<div class="muted tiny" style="color:#ef4444">Top Loser!</div>':""}
      `;

      pricesGridEl.appendChild(card);

      if(deltaSign!=="same"){
        card.classList.add(deltaSign==="up"?"price-up":"price-down");
        setTimeout(()=>card.classList.remove("price-up","price-down"),600);
      }

      lastRenderedPrices[sym]={price:p.price,last:p.last};
    });

    refreshStockButtons();
  }

  function restoreSubscriptionsUI(){ refreshStockButtons(); renderSubscriptions(); renderPrices(); }

  function timeAgo(ts){
    if(!ts) return "unknown";
    const s=Math.floor((Date.now()-ts)/1000);
    if(s<2) return "just now";
    if(s<60) return `${s}s ago`;
    const m=Math.floor(s/60);
    if(m<60) return `${m}m ago`;
    const h=Math.floor(m/60);
    return `${h}h ago`;
  }

  window.addEventListener("storage",(ev)=>{
    if(!currentUser) return;
    if(ev.key===subsKey(currentUser)){ renderSubscriptions(); renderPrices(); refreshStockButtons(); }
  });

  window.removeSubscription = removeSubscription;
  window.buyStock = buyStock;
  window.sellStock = sellStock;
})();
