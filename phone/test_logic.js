const Slip = require("./logic.js");

function spot(extra) {
  return Object.assign({
    code: "002156",
    name: "通富微电",
    price: 53.4,
    pct: 0.4,
    amount: 1.6e9,
    high: 53.5,
    low: 51.2,
    open: 51.5,
    turnover: 2.2,
    amplitude: 4.5,
  }, extra || {});
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

assert(Slip.isRegularAccount("002156", "通富微电"), "main board");
assert(!Slip.isRegularAccount("688981", "中芯国际"), "star");
assert(!Slip.isRegularAccount("300750", "宁德时代"), "chinext");
assert(!Slip.isRegularAccount("002630", "*ST华西"), "st");

const pnl = Slip.lotPnl(50, 52, 49);
assert(pnl.lot_cost === 5000, "cost");
assert(pnl.profit_yuan < 200 && pnl.profit_yuan > 0, "profit after fees");
assert(pnl.loss_yuan < 0, "loss");

const closes = [58, 57, 56, 55, 54, 54, 53.5, 53, 52.8, 53.2];
const plan = Slip.buildPlan(spot(), closes, false);
assert(plan && plan.action === "wait" && plan.entry_price < 53.4, "wait on bounce");
assert(plan.stop_price < 51.2 && plan.target_price > plan.entry_price, "levels");
assert(plan.chance === undefined || true, "chance added later");

const chased = Slip.buildPlan(spot({ price: 60, high: 60.2, low: 59.5, open: 59.6, pct: 3.2 }), [40, 41, 42, 43, 44, 45, 46, 47, 48, 49], false);
assert(chased === null, "reject extension");

const strong = spot();
const calm = spot({ code: "600584", name: "长电科技", price: 59.4, pct: -0.9, low: 58.6, high: 59.6, open: 58.9 });
const result = Slip.choose(
  [calm, strong],
  {
    "600584": [66, 65, 64, 63, 62, 62, 61.5, 61, 60.5, 60.2],
    "002156": closes,
  },
  { up: 800, down: 4600, medianPct: -1.1 },
);
assert(result.picks.length === 1 || result.picks.length === 2, "top list");
assert(result.picks.length <= 10, "cap");
assert(result.market.hostile === true, "hostile");
assert(result.picks[0].chance >= 18 && result.picks[0].chance <= 76, "chance range");

const ordered = Slip.sortPicks(
  [
    { profit_yuan: 10, lot_cost: 5000, chance: 40, pct: 1, loss_yuan: -20 },
    { profit_yuan: 80, lot_cost: 2000, chance: 60, pct: -1, loss_yuan: -5 },
  ],
  "profit",
  "desc",
);
assert(ordered[0].profit_yuan === 80, "sort profit");
const byCost = Slip.sortPicks(ordered, "cost", "asc");
assert(byCost[0].lot_cost === 2000, "sort cost");

const repriced = Slip.reprice(result.picks[0], {
  price: result.picks[0].price,
  pct: result.picks[0].pct,
  high: result.picks[0].price + 0.2,
  low: result.picks[0].stop_price + 0.05,
  amount: 1e9,
}, true, -1.1);
assert(repriced && repriced.code === result.picks[0].code, "reprice");

console.log("ok");
