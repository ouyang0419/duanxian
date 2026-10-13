(function () {
  const QUOTE = "https://push2.eastmoney.com";
  const KLINE = "https://push2his.eastmoney.com";
  const BOARD = "m:1+t:2,m:0+t:6";

  const state = {
    picks: [],
    market: null,
    index: null,
    sortKey: "profit",
    sortDir: "desc",
    openCode: "",
    updatedAt: "",
    session: null,
    error: "",
    loading: true,
    progress: "正在连接行情",
    scanning: false,
    prices: {},
  };

  let timer = 0;
  let scanTimer = 0;
  let jsonpSeq = 0;

  function $(id) { return document.getElementById(id); }

  function shanghaiParts() {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai",
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]));
    return parts;
  }

  function todayText() {
    const parts = shanghaiParts();
    return `${parts.year}-${parts.month}-${parts.day}`;
  }

  function clockText() {
    const parts = shanghaiParts();
    return `${parts.hour}:${parts.minute}:${parts.second}`;
  }

  function sessionNow() {
    const parts = shanghaiParts();
    const weekend = parts.weekday === "Sat" || parts.weekday === "Sun";
    const hm = Number(parts.hour) * 60 + Number(parts.minute);
    if (weekend) return { label: "休市", live: false };
    if ((hm >= 570 && hm < 690) || (hm >= 780 && hm < 900)) return { label: "交易中", live: true };
    if (hm >= 690 && hm < 780) return { label: "午休", live: false };
    return { label: "已收盘", live: false };
  }

  function ymd(daysAgo) {
    const when = new Date(Date.now() - daysAgo * 86400000);
    return when.toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }).replace(/-/g, "");
  }

  function jsonp(url) {
    return new Promise((resolve, reject) => {
      const name = `__slip${++jsonpSeq}`;
      const script = document.createElement("script");
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("timeout"));
      }, 12000);
      function cleanup() {
        clearTimeout(timer);
        delete window[name];
        script.remove();
      }
      window[name] = (data) => {
        cleanup();
        resolve(data);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("network"));
      };
      script.src = `${url}${url.includes("?") ? "&" : "?"}cb=${name}`;
      document.head.appendChild(script);
    });
  }

  function num(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function rowsOf(diff) {
    if (!diff) return [];
    return Array.isArray(diff) ? diff : Object.values(diff);
  }

  function spotFrom(row) {
    const price = num(row.f2);
    const pct = num(row.f3);
    const amount = num(row.f6);
    const amplitude = num(row.f7) || 0;
    const turnover = num(row.f8);
    const high = num(row.f15);
    const low = num(row.f16);
    const open = num(row.f17);
    if ([price, pct, amount, turnover, high, low, open].some((item) => item === null)) return null;
    return {
      code: String(row.f12).padStart(6, "0"),
      name: String(row.f14 || ""),
      price,
      pct,
      amount,
      amplitude,
      turnover,
      high,
      low,
      open,
    };
  }

  async function fetchBoard() {
    const spots = [];
    const changes = [];
    for (let page = 1; page <= 3; page += 1) {
      const data = await jsonp(`${QUOTE}/api/qt/clist/get?pn=${page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(BOARD)}&fields=f2,f3,f6,f7,f8,f12,f14,f15,f16,f17`);
      for (const row of rowsOf(data.data && data.data.diff)) {
        const pct = num(row.f3);
        if (pct !== null) changes.push(pct);
        const spot = spotFrom(row);
        if (spot && Slip.passesSpot(spot)) spots.push(spot);
      }
    }
    return {
      spots,
      up: changes.filter((item) => item > 0).length,
      down: changes.filter((item) => item < 0).length,
      medianPct: Slip.median(changes),
    };
  }

  async function fetchIndex() {
    const data = await jsonp(`${QUOTE}/api/qt/stock/get?secid=1.000001&fltt=2&fields=f43,f58,f170`);
    const row = data.data || {};
    return { name: row.f58 || "上证指数", price: num(row.f43), pct: num(row.f170) };
  }

  async function fetchCloses(code) {
    const market = code.startsWith("6") ? "1" : "0";
    const data = await jsonp(`${KLINE}/api/qt/stock/kline/get?secid=${market}.${code}&klt=101&fqt=1&beg=${ymd(80)}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53`);
    const lines = (data.data && data.data.klines) || [];
    return lines.map((line) => {
      const [date, close] = String(line).split(",");
      return { date, close: Number(close) };
    }).filter((bar) => Number.isFinite(bar.close));
  }

  async function mapPool(pool, worker, limit) {
    const out = new Array(pool.length);
    let cursor = 0;
    async function run() {
      while (cursor < pool.length) {
        const index = cursor;
        cursor += 1;
        out[index] = await worker(pool[index], index);
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, pool.length) }, run));
    return out;
  }

  async function scan() {
    if (state.scanning) return;
    state.scanning = true;
    state.error = "";
    state.progress = "正在拉成交靠前的主板";
    render();
    try {
      const [board, index] = await Promise.all([fetchBoard(), fetchIndex()]);
      state.index = index;
      const pool = Slip.shortlist(board.spots);
      state.progress = `正在核对 ${pool.length} 支的日线`;
      render();
      const bars = await mapPool(pool, (spot) => fetchCloses(spot.code).catch(() => []), 6);
      const closes = {};
      const dated = pool.map((spot, index) => {
        const series = bars[index] || [];
        if (!series.length) return spot;
        closes[spot.code] = series.map((bar) => bar.close);
        return { ...spot, barDate: series[series.length - 1].date };
      });
      const result = Slip.choose(dated, closes, {
        up: board.up,
        down: board.down,
        medianPct: board.medianPct,
      });
      state.market = result.market;
      state.picks = result.picks;
      state.updatedAt = clockText();
      state.loading = false;
      state.error = "";
      rememberPrices();
    } catch (error) {
      state.error = state.picks.length
        ? "这次没刷新完整，先显示上一批。"
        : "手机这会儿没连上行情，过几秒会再试。";
      state.loading = state.picks.length === 0;
    } finally {
      state.scanning = false;
      state.session = sessionNow();
      render();
    }
  }

  function rememberPrices() {
    const next = {};
    for (const pick of state.picks) next[pick.code] = pick.price;
    state.prices = next;
  }

  async function refreshQuotes() {
    if (!state.picks.length || state.scanning) return;
    const secids = state.picks.map((pick) => `${pick.code.startsWith("6") ? "1" : "0"}.${pick.code}`).join(",");
    try {
      const data = await jsonp(`${QUOTE}/api/qt/ulist.np/get?fltt=2&secids=${secids}&fields=f2,f3,f6,f12,f15,f16,f17`);
      const byCode = {};
      for (const row of rowsOf(data.data && data.data.diff)) {
        const spot = spotFrom({ ...row, f14: " ", f7: 1, f8: 1 });
        if (spot) byCode[spot.code] = spot;
      }
      const today = todayText();
      const hostile = state.market ? state.market.hostile : false;
      const medianPct = state.market ? state.market.median_pct : 0;
      state.picks = state.picks.map((pick) => {
        const quote = byCode[pick.code];
        if (!quote) return pick;
        return Slip.reprice(pick, quote, hostile, medianPct, today);
      });
      state.updatedAt = clockText();
      state.session = sessionNow();
      state.error = "";
      render();
      rememberPrices();
    } catch (error) {
      state.error = "报价暂停了一下，列表还是刚才的。";
      render();
    }
  }

  function yuan(value) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${Math.round(value).toLocaleString("zh-CN")} 元`;
  }

  function render() {
    const root = $("app");
    const session = state.session || sessionNow();
    const index = state.index;
    const indexHtml = index && index.price !== null
      ? `<span class="${index.pct >= 0 ? "up" : "down"}">${index.name} ${Number(index.price).toFixed(2)} ${index.pct >= 0 ? "+" : ""}${Number(index.pct).toFixed(2)}%</span>`
      : "";
    const chips = Object.entries(Slip.SORTS).map(([key, spec]) => {
      const on = key === state.sortKey;
      const arrow = on ? (state.sortDir === "desc" ? " ↓" : " ↑") : "";
      return `<button type="button" class="chip${on ? " on" : ""}" data-sort="${key}">${spec.label}${arrow}</button>`;
    }).join("");
    let body;
    if (state.loading && !state.picks.length) {
      body = `<p class="status">${state.progress}</p>`;
    } else if (!state.picks.length) {
      body = `<p class="status">${state.error || "这会儿没有筛出十支。"}</p>`;
    } else {
      const shown = Slip.sortPicks(state.picks, state.sortKey, state.sortDir);
      body = shown.map((pick, index) => rowHtml(pick, index)).join("");
    }
    root.innerHTML = `
      <header class="top">
        <div>
          <p class="eyebrow">短线单 · 十支 · 普通账户</p>
          <p class="clock">${session.label} · ${state.updatedAt || clockText()} 更新</p>
        </div>
        <p class="index">${indexHtml}</p>
      </header>
      <p class="summary">${state.market ? state.market.summary : "只看沪深主板，手机直接向行情站要数据。"}</p>
      <div class="chips" role="toolbar">${chips}</div>
      <div class="list">${body}</div>
      <p class="fine">${state.error ? `${state.error} ` : ""}报价大约十几秒刷新一次。把握是按到价空间、止损空间和今天强弱估算的，不是历史胜率。价差按 1 手扣过佣金和印花税推演，不是收益承诺。今天买入，最早下一个交易日才能卖。</p>
    `;
    root.querySelectorAll("[data-sort]").forEach((button) => {
      button.onclick = () => setSort(button.dataset.sort);
    });
    root.querySelectorAll("[data-code]").forEach((button) => {
      button.onclick = () => {
        state.openCode = state.openCode === button.dataset.code ? "" : button.dataset.code;
        render();
      };
    });
  }

  function rowHtml(pick, index) {
    const up = pick.pct >= 0;
    const flashed = state.prices[pick.code] !== undefined && state.prices[pick.code] !== pick.price;
    const open = state.openCode === pick.code;
    return `
      <article class="slip${pick.stale ? " stale" : ""}">
        <button type="button" class="row" data-code="${pick.code}">
          <span class="rank">${index + 1}</span>
          <span class="main">
            <span class="name">${pick.name}</span>
            <span class="code">${pick.code}</span>
          </span>
          <span class="chop ${pick.action === "wait" ? "wait" : ""}">${pick.action_label}</span>
          <span class="px ${up ? "up" : "down"}${flashed ? " flash" : ""}">${pick.price.toFixed(2)}</span>
          <span class="pct ${up ? "up" : "down"}">${up ? "+" : ""}${pick.pct.toFixed(2)}%</span>
          <span class="metrics">
            <span>到价 <b class="up">${yuan(pick.profit_yuan)}</b></span>
            <span>一手 <b>${Math.round(pick.lot_cost).toLocaleString("zh-CN")}</b></span>
            <span>把握 <b>${pick.chance}</b></span>
          </span>
          <span class="levels">进 ${pick.entry_price.toFixed(2)} · 守 ${pick.stop_price.toFixed(2)} · 收 ${pick.target_price.toFixed(2)}</span>
        </button>
        ${open ? `<div class="detail"><p><b>进</b> ${pick.entry_text}</p><p><b>守</b> ${pick.stop_text}</p><p><b>收</b> ${pick.target_text}</p><p>${pick.why}</p></div>` : ""}
      </article>
    `;
  }

  function setSort(key) {
    if (state.sortKey === key) state.sortDir = state.sortDir === "desc" ? "asc" : "desc";
    else {
      state.sortKey = key;
      state.sortDir = Slip.SORTS[key].start;
    }
    render();
  }

  function arm() {
    clearInterval(timer);
    clearInterval(scanTimer);
    timer = setInterval(() => {
      if (document.hidden) return;
      refreshQuotes();
    }, 15000);
    scanTimer = setInterval(() => {
      if (document.hidden) return;
      scan();
    }, 180000);
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshQuotes();
  });

  state.session = sessionNow();
  render();
  scan();
  arm();
})();
