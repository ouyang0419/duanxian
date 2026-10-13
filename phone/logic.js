/* Main-board short-term plans for a regular account. Pure functions. */
(function (root) {
  const MAIN = ["600", "601", "603", "605", "000", "001", "002", "003"];

  function roundPrice(value) {
    return Math.round((Number(value) + 1e-8) * 100) / 100;
  }

  function isRegularAccount(code, name) {
    const text = String(code || "").trim().padStart(6, "0");
    if (!MAIN.some((prefix) => text.startsWith(prefix))) return false;
    const compact = String(name || "").toUpperCase().replace(/\s/g, "");
    if (compact.includes("ST") || String(name).includes("退")) return false;
    if (String(name).startsWith("N") || String(name).startsWith("C")) return false;
    return true;
  }

  function lotPnl(entry, target, stop) {
    const shares = 100;
    const cost = shares * entry;
    const buyFee = Math.max(5, cost * 0.00025);
    function sellNet(price) {
      const gross = shares * price;
      const fee = Math.max(5, gross * 0.00025) + gross * 0.0005;
      return gross - fee;
    }
    return {
      shares,
      lot_cost: roundPrice(cost),
      profit_yuan: roundPrice(sellNet(target) - cost - buyFee),
      loss_yuan: roundPrice(sellNet(stop) - cost - buyFee),
      profit_pct: roundPrice(((target - entry) / entry) * 100),
      loss_pct: roundPrice(((entry - stop) / entry) * 100),
    };
  }

  function buildPlan(spot, closes, hostile) {
    if (!closes || closes.length < 10 || spot.price <= 0 || spot.low <= 0) return null;
    if (spot.low > spot.price || spot.high < spot.price) return null;
    const ma5 = closes.slice(-5).reduce((sum, n) => sum + n, 0) / 5;
    const ma10 = closes.slice(-10).reduce((sum, n) => sum + n, 0) / 10;
    const extended = spot.price > ma5 * 1.035;
    if (spot.price > ma5 * 1.08) return null;
    if (spot.price < ma10 * 0.85) return null;

    const stop = roundPrice(spot.low - 0.01);
    if (stop >= spot.price) return null;
    const downside = (spot.price - stop) / spot.price;
    if (downside < 0.008 || downside > 0.06) return null;

    const bounce = (spot.price - spot.low) / spot.low;
    const minEntry = roundPrice(stop / 0.988);
    if (minEntry >= spot.price) return null;
    const aboveMa5 = spot.price > ma5 * 1.006;
    let action;
    let entry;
    if (hostile || bounce >= 0.025 || aboveMa5 || extended) {
      action = "wait";
      const natural = roundPrice(spot.low + (spot.price - spot.low) * 0.4);
      entry = Math.min(Math.max(natural, minEntry), roundPrice(spot.price * 0.995));
      if (extended && ma5 < spot.price && ma5 > stop) {
        const nearMa = roundPrice(Math.max(ma5, minEntry));
        if (nearMa < spot.price) entry = nearMa;
      }
    } else {
      action = "now";
      entry = roundPrice(spot.price);
    }
    if (entry <= stop || (entry - stop) / entry < 0.012) return null;

    let target;
    if (ma5 >= entry * 1.012) target = roundPrice(ma5);
    else if (ma10 >= entry * 1.015) target = roundPrice(Math.min(ma10, entry * 1.05));
    else target = roundPrice(entry * 1.025);
    target = Math.min(target, roundPrice(entry * 1.06));
    if (target <= entry * 1.008) return null;

    const upside = (target - entry) / entry;
    const risk = (entry - stop) / entry;
    if (risk <= 0 || upside / risk < 0.7) return null;

    const ceiling = roundPrice(spot.price * 1.008);
    const entryText = action === "now"
      ? `现价 ${spot.price.toFixed(2)} 附近可以进。高于 ${ceiling.toFixed(2)} 不要追。`
      : `先别追。等回到 ${entry.toFixed(2)} 附近再进。现在离开今天低点已经有一截。`;
    const pace = spot.pct >= 0 ? "今天还强于大多数股票" : "今天跌得比大盘轻";
    const tape = hostile ? "大盘偏差，所以只做回落，不做追价。" : "大盘还能看，回落不大就可以进。";
    return {
      code: spot.code,
      name: spot.name,
      price: roundPrice(spot.price),
      pct: roundPrice(spot.pct),
      action,
      action_label: action === "wait" ? "等" : "进",
      entry_price: entry,
      entry_text: entryText,
      stop_price: stop,
      stop_text: `跌破 ${stop.toFixed(2)} 就抛，不要等它弹回来。`,
      target_price: target,
      target_text: `到 ${target.toFixed(2)} 附近就抛。最晚下一个交易日收盘前处理。`,
      ma5: roundPrice(ma5),
      amount: spot.amount,
      why: `主板、成交够大，${pace}。止损放在今天低点下面。${tape}`,
      ...lotPnl(entry, target, stop),
    };
  }

  function chance(plan, spot, medianPct) {
    const rr = plan.loss_pct > 0 ? plan.profit_pct / plan.loss_pct : 1;
    const strength = spot.pct - medianPct;
    const waitPenalty = plan.action === "wait" ? 7 : 0;
    const chase = Math.max(0, spot.pct - 2) * 3;
    const raw = 40 + rr * 7 + strength * 2.5 - waitPenalty - chase;
    return Math.round(Math.min(76, Math.max(18, raw)));
  }

  function score(plan, spot, medianPct, hostile) {
    const rr = plan.loss_pct > 0 ? plan.profit_pct / plan.loss_pct : 0;
    const liquidity = Math.min(spot.amount / 1e8, 20);
    const relative = spot.pct - medianPct;
    const chase = Math.max(0, spot.pct - 2.5) * 1.5;
    const lot = spot.price * 100;
    const affordable = lot >= 1500 && lot <= 20000 ? 3 : 0;
    let value = rr * 6 + relative * 1.1 + liquidity * 0.15 + affordable - chase;
    if (hostile && spot.pct < 0) value -= 2;
    return value;
  }

  function median(values) {
    const sorted = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (!sorted.length) return 0;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function choose(spots, closesByCode, breadth, options) {
    if (!spots.length) throw new Error("没有可用的主板行情");
    const up = breadth.up;
    const down = breadth.down;
    const medianPct = breadth.medianPct;
    const hostile = down > up * 1.5 || medianPct <= -0.4;
    const ranked = [];
    for (const spot of spots) {
      const closes = closesByCode[spot.code];
      if (!closes) continue;
      const plan = buildPlan(spot, closes, hostile);
      if (!plan) continue;
      if (options && options.onlyNow && plan.action !== "now") continue;
      plan.chance = chance(plan, spot, medianPct);
      plan.prior_closes = closes.slice(0, -1);
      plan.last_close = closes[closes.length - 1];
      plan.bar_date = spot.barDate || "";
      ranked.push([score(plan, spot, medianPct, hostile), plan]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    if (!ranked.length) throw new Error(options && options.onlyNow ? "no-now" : "今天没有符合短线条件的主板股票");
    const summary = hostile
      ? `成交靠前的主板里，上涨 ${up} 家、下跌 ${down} 家。跌得多，每支只做很小一笔。`
      : `成交靠前的主板里，上涨 ${up} 家、下跌 ${down} 家。`;
    return {
      market: {
        up,
        down,
        median_pct: roundPrice(medianPct),
        hostile,
        summary,
      },
      picks: ranked.slice(0, 10).map((item) => item[1]),
    };
  }

  function passesSpot(row, range) {
    if (!isRegularAccount(row.code, row.name)) return false;
    const floor = range && range.min != null ? range.min : 3;
    if (!(row.price >= floor) || !(row.amount >= 3e8)) return false;
    if (range && range.max != null && row.price > range.max) return false;
    if (row.pct < -4 || row.pct > 5) return false;
    if (row.turnover < 0.5 || row.turnover > 20) return false;
    if (row.amplitude > 13) return false;
    return true;
  }

  function shortlist(spots, options) {
    if (!spots.length) return [];
    const onlyNow = !!(options && options.onlyNow);
    const mid = median(spots.map((item) => item.pct));
    return spots
      .slice()
      .sort((a, b) => onlyNow ? nearLow(b) - nearLow(a) : rank(b, mid) - rank(a, mid))
      .slice(0, onlyNow ? 48 : 36);
  }

  function nearLow(item) {
    const bounce = item.low > 0 ? (item.price - item.low) / item.low : 1;
    return -bounce + Math.min(item.amount / 1e9, 3) * 0.01;
  }

  function rank(item, mid) {
    const lot = item.price * 100;
    const affordable = lot >= 1500 && lot <= 20000 ? 2 : 0;
    const chase = Math.max(0, item.pct - 2) * 1.8;
    const lag = Math.max(0, -item.pct - 1) * 0.6;
    return (item.pct - mid) * 0.5 + Math.min(item.amount / 1e9, 8) + affordable - chase - lag;
  }

  function reprice(pick, quote, hostile, medianPct, today) {
    const useLive = !today || !pick.bar_date || pick.bar_date === today;
    const last = useLive ? quote.price : (pick.last_close || quote.price);
    const closes = (pick.prior_closes || []).concat([last]);
    const spot = {
      code: pick.code,
      name: pick.name,
      price: quote.price,
      pct: quote.pct,
      amount: quote.amount || pick.amount,
      high: quote.high,
      low: quote.low,
      open: quote.open || quote.price,
      turnover: quote.turnover || 1,
      amplitude: quote.amplitude || 0,
    };
    const plan = buildPlan(spot, closes, hostile);
    if (!plan) return { ...pick, price: roundPrice(quote.price), pct: roundPrice(quote.pct), stale: true };
    plan.chance = chance(plan, spot, medianPct);
    plan.prior_closes = pick.prior_closes;
    plan.bar_date = pick.bar_date || "";
    plan.last_close = useLive ? quote.price : pick.last_close;
    plan.stale = false;
    return plan;
  }

  const SORTS = {
    profit: { label: "能赚多少", value: (pick) => pick.profit_yuan, start: "desc" },
    cost: { label: "一手成本", value: (pick) => pick.lot_cost, start: "asc" },
    chance: { label: "把握", value: (pick) => pick.chance, start: "desc" },
    pct: { label: "涨跌幅", value: (pick) => pick.pct, start: "desc" },
    loss: { label: "亏多少", value: (pick) => pick.loss_yuan, start: "asc" },
  };

  function sortPicks(picks, key, dir) {
    const spec = SORTS[key] || SORTS.chance;
    const sign = dir === "asc" ? 1 : -1;
    return picks.slice().sort((a, b) => (spec.value(a) - spec.value(b)) * sign);
  }

  root.Slip = {
    isRegularAccount,
    lotPnl,
    buildPlan,
    chance,
    choose,
    passesSpot,
    shortlist,
    reprice,
    sortPicks,
    SORTS,
    median,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.Slip;
})(typeof globalThis !== "undefined" ? globalThis : this);
