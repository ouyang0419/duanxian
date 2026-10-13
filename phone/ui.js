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
    priceMin: "",
    priceMax: "",
    formError: "",
    rangeNote: "",
    onlyNow: false,
    klines: {},
  };

  const PRESETS = [
    { id: "any", label: "不限", min: "", max: "" },
    { id: "u10", label: "10元以下", min: "", max: "10" },
    { id: "m30", label: "10–30元", min: "10", max: "30" },
    { id: "m80", label: "30–80元", min: "30", max: "80" },
    { id: "o80", label: "80元以上", min: "80", max: "" },
  ];

  let timer = 0;
  let scanTimer = 0;
  let jsonpSeq = 0;
  let pendingReason = "";
  const klineFlight = {};

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

  function parseYuan(text) {
    const raw = String(text || "").trim().replace(/，/g, "").replace(/,/g, "");
    if (!raw) return null;
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) return null;
    return number;
  }

  function currentRange() {
    return { min: parseYuan(state.priceMin), max: parseYuan(state.priceMax) };
  }

  function rangeSentence(range) {
    const text = (value) => String(value).replace(/\.0+$/, "");
    let price = "";
    if (range.min != null && range.max != null) price = `股价 ${text(range.min)} 到 ${text(range.max)} 元。`;
    else if (range.min != null) price = `股价 ${text(range.min)} 元以上。`;
    else if (range.max != null) price = `股价 ${text(range.max)} 元以下。`;
    const now = state.onlyNow ? "只留现在能进的。" : "";
    return `${price}${now}`;
  }

  function loadRange() {
    try {
      const saved = JSON.parse(localStorage.getItem("slip-price") || "null");
      if (!saved) return;
      state.priceMin = String(saved.min || "");
      state.priceMax = String(saved.max || "");
      state.onlyNow = !!saved.onlyNow;
    } catch (error) {
      state.priceMin = "";
      state.priceMax = "";
    }
  }

  function saveRange() {
    localStorage.setItem("slip-price", JSON.stringify({
      min: state.priceMin,
      max: state.priceMax,
      onlyNow: state.onlyNow,
    }));
  }

  async function fetchBoard(range, onlyNow) {
    const spots = [];
    const changes = [];
    const limited = range.min != null || range.max != null || onlyNow;
    const maxPages = limited ? 10 : 3;
    for (let page = 1; page <= maxPages; page += 1) {
      state.progress = onlyNow
        ? `正在找现在能进的，第 ${page} 页`
        : (limited ? `正在按股价翻第 ${page} 页` : "正在拉成交靠前的主板");
      render();
      const data = await jsonp(`${QUOTE}/api/qt/clist/get?pn=${page}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f6&fs=${encodeURIComponent(BOARD)}&fields=f2,f3,f6,f7,f8,f12,f14,f15,f16,f17`);
      const rows = rowsOf(data.data && data.data.diff);
      if (!rows.length) break;
      for (const row of rows) {
        const pct = num(row.f3);
        if (pct !== null) changes.push(pct);
        const spot = spotFrom(row);
        if (spot && Slip.passesSpot(spot, range)) spots.push(spot);
      }
      if (limited && !onlyNow && spots.length >= 48) break;
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

  async function fetchBars(code) {
    const market = code.startsWith("6") ? "1" : "0";
    const data = await jsonp(`${KLINE}/api/qt/stock/kline/get?secid=${market}.${code}&klt=101&fqt=1&beg=${ymd(160)}&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55`);
    const lines = (data.data && data.data.klines) || [];
    return lines.map((line) => {
      const [date, open, close, high, low] = String(line).split(",");
      return { date, open: Number(open), close: Number(close), high: Number(high), low: Number(low) };
    }).filter((bar) => [bar.open, bar.close, bar.high, bar.low].every(Number.isFinite));
  }

  async function loadKline(code) {
    if (klineFlight[code] || Array.isArray(state.klines[code])) return;
    klineFlight[code] = true;
    state.klines[code] = "loading";
    render();
    try {
      const bars = await fetchBars(code);
      state.klines[code] = bars.length >= 10 ? bars : "error";
    } catch (error) {
      state.klines[code] = "error";
    } finally {
      delete klineFlight[code];
      if (state.openCode === code) render();
    }
  }

  function candleSvg(bars, pick) {
    const series = bars.slice(-50);
    const width = 320;
    const height = 180;
    const pad = { l: 6, r: 48, t: 8, b: 16 };
    const marks = [pick.entry_price, pick.stop_price, pick.target_price, pick.price].filter(Number.isFinite);
    const min = Math.min(...series.map((bar) => bar.low), ...marks);
    const max = Math.max(...series.map((bar) => bar.high), ...marks);
    const span = max - min || 1;
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const yOf = (price) => pad.t + ((max - price) / span) * plotH;
    const slot = plotW / series.length;
    const bodyW = Math.max(1.6, slot * 0.58);
    const candles = series.map((bar, index) => {
      const x = pad.l + index * slot + slot / 2;
      const rising = bar.close >= bar.open;
      const color = rising ? "#ff5d5d" : "#2fbf7a";
      const top = yOf(Math.max(bar.open, bar.close));
      const body = Math.max(1, yOf(Math.min(bar.open, bar.close)) - top);
      return `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${yOf(bar.high).toFixed(1)}" y2="${yOf(bar.low).toFixed(1)}" stroke="${color}" stroke-width="1"/><rect x="${(x - bodyW / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bodyW.toFixed(1)}" height="${body.toFixed(1)}" fill="${color}"/>`;
    }).join("");
    const guide = (price, color) => {
      const y = yOf(price);
      const labelY = Math.min(pad.t + plotH - 2, Math.max(12, y + 3));
      return `<line x1="${pad.l}" x2="${pad.l + plotW}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${color}" stroke-dasharray="3 3" stroke-width="1"/><text x="${width - 4}" y="${labelY.toFixed(1)}" fill="${color}" font-size="10" text-anchor="end">${price.toFixed(2)}</text>`;
    };
    const grid = [0.25, 0.5, 0.75].map((part) => {
      const y = pad.t + plotH * part;
      return `<line x1="${pad.l}" x2="${pad.l + plotW}" y1="${y}" y2="${y}" stroke="#243244"/>`;
    }).join("");
    const entryColor = pick.action === "wait" ? "#e0b15a" : "#ff5d5d";
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${pick.name}日K">${grid}${candles}${guide(pick.stop_price, "#2fbf7a")}${guide(pick.target_price, "#7eb0ff")}${guide(pick.entry_price, entryColor)}<text x="${pad.l}" y="${height - 2}" fill="#8b98a8" font-size="10">${series[0].date.slice(5)}</text><text x="${pad.l + plotW}" y="${height - 2}" fill="#8b98a8" font-size="10" text-anchor="end">${series[series.length - 1].date.slice(5)}</text></svg>`;
  }

  function chartHtml(pick) {
    const bars = state.klines[pick.code];
    if (!Array.isArray(bars)) {
      return `<p class="chart-note">${bars === "error" ? "日K没取到，再点一次试试。" : "正在取日K。"}</p>`;
    }
    return `<div class="chart"><p class="chart-cap"><span>日K · 前复权</span><span>近 ${Math.min(50, bars.length)} 根</span></p>${candleSvg(bars, pick)}</div>`;
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

  async function scan(reason) {
    if (state.scanning) {
      if (reason === "range") pendingReason = "range";
      return;
    }
    const range = currentRange();
    state.scanning = true;
    state.error = "";
    state.formError = "";
    if (reason === "range") {
      state.picks = [];
      state.market = null;
      state.rangeNote = "";
      state.loading = true;
      state.openCode = "";
    }
    state.progress = state.onlyNow ? "正在找现在能进的" : (range.min != null || range.max != null ? "正在按股价重选" : "正在拉成交靠前的主板");
    render();
    try {
      const [board, index] = await Promise.all([fetchBoard(range, state.onlyNow), fetchIndex()]);
      state.index = index;
      const pool = Slip.shortlist(board.spots, { onlyNow: state.onlyNow });
      if (!pool.length) throw new Error("empty");
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
      }, { onlyNow: state.onlyNow });
      state.market = result.market;
      state.rangeNote = rangeSentence(range);
      state.picks = result.picks;
      state.updatedAt = clockText();
      state.loading = false;
      state.error = "";
      rememberPrices();
    } catch (error) {
      const missed = String(error && error.message || "");
      const offline = missed === "timeout" || missed === "network";
      if (reason === "range") {
        state.picks = [];
        state.market = null;
        state.rangeNote = "";
        state.loading = false;
        state.error = offline
          ? "手机这会儿没连上行情，过几秒会再试。"
          : (state.onlyNow
            ? "这个股价里，现在没有可以进的。"
            : "这个股价范围里，今天没有符合短线条件的股票。");
      } else {
        state.error = state.picks.length
          ? "这次没刷新完整，先显示上一批。"
          : "手机这会儿没连上行情，过几秒会再试。";
        state.loading = state.picks.length === 0;
      }
    } finally {
      state.scanning = false;
      state.session = sessionNow();
      render();
      if (pendingReason) {
        const next = pendingReason;
        pendingReason = "";
        scan(next);
      }
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
      }).filter((pick) => !state.onlyNow || pick.action === "now");
      state.updatedAt = clockText();
      state.session = sessionNow();
      state.error = state.onlyNow && !state.picks.length ? "报价变了，现在没有可以进的。" : "";
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

  function listHtml() {
    if (state.loading && !state.picks.length) return `<p class="status">${state.progress}</p>`;
    if (!state.picks.length) return `<p class="status">${state.error || "这会儿没有筛出十支。"}</p>`;
    const shown = Slip.sortPicks(state.picks, state.sortKey, state.sortDir);
    return shown.map((pick, index) => rowHtml(pick, index)).join("");
  }

  function summaryText() {
    const base = state.market ? state.market.summary : "只看沪深主板。手机直接向行情站要数据。";
    return state.rangeNote ? `${state.rangeNote}${base}` : base;
  }

  function frameHtml() {
    const presets = PRESETS.map((preset) => `<button type="button" class="preset" data-preset="${preset.id}">${preset.label}</button>`).join("");
    return `
      <header class="top">
        <div class="brand">
          <p class="eyebrow">短线单</p>
          <p class="clock"></p>
        </div>
        <p class="index"></p>
      </header>
      <p class="summary"></p>
      <section class="band">
        <p class="band-label">按股价重选</p>
        <p class="band-hint">填一股多少钱。只看能进时，会在这个股价里重找现在可以买的。</p>
        <div class="band-row">
          <label>最低<input class="band-min" inputmode="decimal" enterkeyhint="done" value="${state.priceMin}" placeholder="不限"></label>
          <span class="band-to">到</span>
          <label>最高<input class="band-max" inputmode="decimal" enterkeyhint="done" value="${state.priceMax}" placeholder="不限"></label>
          <span class="band-unit">元</span>
        </div>
        <div class="presets">${presets}</div>
        <button type="button" class="preset now-toggle" data-now>只看能进</button>
        <button type="button" class="go" data-go>重选十支</button>
        <p class="band-msg"></p>
      </section>
      <div class="chips" role="toolbar"></div>
      <div class="list"></div>
      <ul class="fine"></ul>
    `;
  }

  function bind(root) {
    root.addEventListener("click", (event) => {
      const sort = event.target.closest("[data-sort]");
      if (sort) {
        setSort(sort.dataset.sort);
        return;
      }
      const preset = event.target.closest("[data-preset]");
      if (preset) {
        applyPreset(preset.dataset.preset);
        return;
      }
      if (event.target.closest("[data-now]")) {
        state.onlyNow = !state.onlyNow;
        state.formError = "";
        saveRange();
        scan("range");
        return;
      }
      if (event.target.closest("[data-go]")) {
        applyFromInputs();
        return;
      }
      const row = event.target.closest("[data-code]");
      if (!row) return;
      const code = row.dataset.code;
      if (state.openCode === code) state.openCode = "";
      else {
        state.openCode = code;
        if (state.klines[code] === "error") delete state.klines[code];
        loadKline(code);
      }
      render();
    });
  }

  function render() {
    const root = $("app");
    if (!root.querySelector(".band")) {
      root.innerHTML = frameHtml();
      bind(root);
    }
    const session = state.session || sessionNow();
    const index = state.index;
    root.querySelector(".clock").textContent = `${session.label} · ${state.updatedAt || clockText()} 更新`;
    root.querySelector(".index").innerHTML = index && index.price !== null
      ? `<span class="index-name">${index.name}</span><span class="index-px">${Number(index.price).toFixed(2)}</span><span class="pill ${index.pct >= 0 ? "up" : "down"}">${index.pct >= 0 ? "+" : ""}${Number(index.pct).toFixed(2)}%</span>`
      : "";
    root.querySelector(".summary").textContent = summaryText();
    root.querySelector(".chips").innerHTML = Object.entries(Slip.SORTS).map(([key, spec]) => {
      const on = key === state.sortKey;
      const arrow = on ? (state.sortDir === "desc" ? " ↓" : " ↑") : "";
      return `<button type="button" class="chip${on ? " on" : ""}" data-sort="${key}">${spec.label}${arrow}</button>`;
    }).join("");
    root.querySelector(".list").innerHTML = listHtml();
    root.querySelector(".fine").innerHTML = `
      ${state.error ? `<li>${state.error}</li>` : ""}
      <li>报价大约每 15 秒刷新一次。</li>
      <li>只看能进会在这个股价里重找，不把先等的算进去。</li>
      <li>把握按到价空间、止损空间和今天强弱估算，不是历史胜率。</li>
      <li>价差按 1 手估算，已扣佣金和印花税，不是收益承诺。</li>
      <li>今天买入，最早下一个交易日才能卖。</li>
    `;
    const min = state.priceMin.trim();
    const max = state.priceMax.trim();
    root.querySelectorAll("[data-preset]").forEach((button) => {
      const preset = PRESETS.find((item) => item.id === button.dataset.preset);
      button.classList.toggle("on", preset.min === min && preset.max === max);
    });
    root.querySelector("[data-now]").classList.toggle("on", state.onlyNow);
    root.querySelector(".band-msg").textContent = state.formError || (state.scanning ? state.progress : "");
  }

  function applyPreset(id) {
    const preset = PRESETS.find((item) => item.id === id);
    if (!preset) return;
    state.priceMin = preset.min;
    state.priceMax = preset.max;
    state.formError = "";
    $("app").querySelector(".band-min").value = preset.min;
    $("app").querySelector(".band-max").value = preset.max;
    saveRange();
    scan("range");
  }

  function applyFromInputs() {
    const minBox = $("app").querySelector(".band-min");
    const maxBox = $("app").querySelector(".band-max");
    const minRaw = minBox.value.trim();
    const maxRaw = maxBox.value.trim();
    if (minRaw && parseYuan(minRaw) == null) {
      state.formError = "最低价要填数字。";
      render();
      return;
    }
    if (maxRaw && parseYuan(maxRaw) == null) {
      state.formError = "最高价要填数字。";
      render();
      return;
    }
    let min = minRaw;
    let max = maxRaw;
    if (parseYuan(min) != null && parseYuan(max) != null && parseYuan(min) > parseYuan(max)) {
      const swap = min;
      min = max;
      max = swap;
      minBox.value = min;
      maxBox.value = max;
    }
    state.priceMin = min;
    state.priceMax = max;
    state.formError = "";
    saveRange();
    scan("range");
  }

  function rowHtml(pick, index) {
    const up = pick.pct >= 0;
    const flashed = state.prices[pick.code] !== undefined && state.prices[pick.code] !== pick.price;
    const open = state.openCode === pick.code;
    return `
      <article class="slip ${pick.action === "wait" ? "wait" : "now"}${pick.stale ? " stale" : ""}">
        <button type="button" class="row" data-code="${pick.code}">
          <span class="head">
            <span class="rank">${index + 1}</span>
            <span class="who">
              <span class="name">${pick.name}</span>
              <span class="code">${pick.code}</span>
            </span>
            <span class="chop ${pick.action === "wait" ? "wait" : ""}">${pick.action === "wait" ? "先等" : "可进"}</span>
          </span>
          <span class="quote">
            <span class="px ${up ? "up" : "down"}${flashed ? " flash" : ""}">${pick.price.toFixed(2)}</span>
            <span class="pill ${up ? "up" : "down"}">${up ? "+" : ""}${pick.pct.toFixed(2)}%</span>
          </span>
          <span class="facts">
            <span class="line"><span class="k">到价能赚</span><span class="v ${pick.profit_yuan >= 0 ? "up" : "down"}">${yuan(pick.profit_yuan)}</span></span>
            <span class="line"><span class="k">买一手</span><span class="v">${Math.round(pick.lot_cost).toLocaleString("zh-CN")} 元</span></span>
            <span class="line"><span class="k">把握</span><span class="v">${pick.chance}</span></span>
          </span>
          <span class="plan">
            <span class="in"><span class="k">进场</span><span class="v">${pick.entry_price.toFixed(2)}</span></span>
            <span class="stop"><span class="k">跌破抛</span><span class="v">${pick.stop_price.toFixed(2)}</span></span>
            <span class="out"><span class="k">到价抛</span><span class="v">${pick.target_price.toFixed(2)}</span></span>
          </span>
        </button>
        ${open ? `<div class="detail">${chartHtml(pick)}<p><b>进场</b>${pick.entry_text}</p><p><b>跌破抛</b>${pick.stop_text}</p><p><b>到价抛</b>${pick.target_text}</p><p class="why">${pick.why}</p></div>` : ""}
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

  loadRange();
  state.session = sessionNow();
  render();
  scan("open");
  arm();
})();
