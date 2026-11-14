// Turns a portfolio data file (portals/<id>.json) into the portal's HTML.
// All figures are calculated here at build time; the result is then encrypted by build.mjs.
// Any figure may be null (not yet provided): it shows as a dash, and totals that depend on it are left blank.
// For a property with no mortgage, set "loan": false. Leave "loan": null while the details are unknown.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const has = v => typeof v === "number" && Number.isFinite(v);
const all = (...vs) => vs.every(has);
const NA = `<span class="na">—</span>`;
const usd = n => has(n) ? (n < 0 ? "−" : "") + "$" + Math.round(Math.abs(n)).toLocaleString("en-US") : NA;
const pct = (n, d = 1) => has(n) ? (n < 0 ? "−" : "") + Math.abs(n).toFixed(d) + "%" : NA;
const signed = n => has(n) ? `<span class="${n < 0 ? "neg" : ""}">${usd(n)}</span>` : NA;
const neg = n => has(n) ? usd(-n) : NA;
const date = iso => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : NA;
const monthLabel = ym => new Date(ym + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const monthYear = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const STATUS = { paid: "Paid", late: "Paid late", due: "Due", unpaid: "Unpaid" };
const total = xs => xs.every(has) && xs.length ? xs.reduce((a, b) => a + b, 0) : null;

// Months of payments made from the first payment through the current month, inclusive.
function paymentsMade(firstPayment, now = new Date()) {
  const [y, m] = firstPayment.split("-").map(Number);
  return Math.max(0, (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m) + 1);
}
// Remaining principal on a fixed-rate loan after n scheduled payments.
function amortizedBalance(original, ratePct, termYears, n) {
  const r = ratePct / 100 / 12, N = termYears * 12;
  if (n >= N) return 0;
  return original * (Math.pow(1 + r, N) - Math.pow(1 + r, n)) / (Math.pow(1 + r, N) - 1);
}
export function loanBalance(loan) {
  if (!loan) return null;
  if (has(loan.balance)) return { value: loan.balance, estimated: false };
  if (all(loan.original, loan.rate, loan.termYears) && loan.firstPayment)
    return { value: amortizedBalance(loan.original, loan.rate, loan.termYears, paymentsMade(loan.firstPayment)), estimated: true };
  return null;
}

function calc(p) {
  const loan = p.loan;
  const noLoan = loan === false;
  const rent = p.units ? total(p.units.map(u => u.rent)) : (has(p.rent) ? p.rent : null);
  const mortgageDebt = noLoan ? 0 : (loan && has(loan.payment) ? loan.payment + (loan.mi || 0) + (loan.escrow || 0) : null);
  // A home equity line of credit adds its monthly payment to debt service and its balance to what is owed.
  const heloc = p.heloc || null;
  const helocPayment = heloc && has(heloc.payment) ? heloc.payment : 0;
  const helocBalance = heloc && has(heloc.balance) ? heloc.balance : 0;
  const debt = has(mortgageDebt) ? mortgageDebt + helocPayment : null;
  const expList = Object.values(p.expenses || {});
  const expenses = p.expenses && expList.length && expList.every(v => v === 0 || has(v)) ? expList.reduce((a, b) => a + b, 0) : null;
  const otherList = [...Object.values(p.otherIncome || {}), ...(p.units || []).flatMap(u => Object.values(u.charges || {}))];
  const other = otherList.every(has) ? otherList.reduce((a, b) => a + b, 0) : null;
  const income = all(rent, other) ? rent + other : null;
  const cashFlow = all(income, debt, expenses) ? income - debt - expenses : null;
  const lb = loanBalance(loan);
  const mortgageBalance = noLoan ? 0 : (lb ? lb.value : null);
  const balance = has(mortgageBalance) ? mortgageBalance + helocBalance : null;
  const original = noLoan ? 0 : (loan && has(loan.original) ? loan.original : null);
  const invested = all(p.purchasePrice, original) ? p.purchasePrice - original + (p.closingCosts || 0) : null;
  // Equity uses the latest market estimate (e.g. RentCast) when there is one, otherwise the recorded value.
  const equityBase = p.market && has(p.market.value) ? p.market.value : p.estimatedValue;
  const equity = all(equityBase, balance) ? equityBase - balance : null;
  return {
    rent, income, debt, mortgageDebt, helocPayment, expenses, cashFlow, balance, mortgageBalance, helocBalance, equity, balanceEstimated: !!(lb && lb.estimated),
    annualCashFlow: has(cashFlow) ? cashFlow * 12 : null,
    cashOnCash: has(cashFlow) && has(invested) && invested > 0 ? (cashFlow * 12 / invested) * 100 : null,
    ltv: has(balance) && has(p.estimatedValue) && p.estimatedValue ? (balance / p.estimatedValue) * 100 : null,
    appreciation: all(p.estimatedValue, p.purchasePrice) ? p.estimatedValue - p.purchasePrice : null,
    appreciationPct: all(p.estimatedValue, p.purchasePrice) ? ((p.estimatedValue - p.purchasePrice) / p.purchasePrice) * 100 : null
  };
}

const dl = rows => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const awaiting = what => `<p class="empty">${what} not yet provided.</p>`;

function tenantFacts(t, rent, unit) {
  if (t === false) return dl([unit ? ["Unit", esc(unit)] : null, ["Tenant", "Vacant"]]);
  if (!t) return unit ? dl([["Unit", esc(unit)], ["Tenant", NA]]) : awaiting("Tenant details");
  return dl([
    unit ? ["Unit", `<strong>${esc(unit)}</strong>${t.unitNote ? ` <span class="sub">(${esc(t.unitNote)})</span>` : ""}`] : null,
    ["Tenant", esc(t.name)],
    ["Lease", t.leaseStart ? `${date(t.leaseStart)} to ${t.leaseEnd ? date(t.leaseEnd) : NA}` : NA],
    t.note ? ["Status", esc(t.note)] : null,
    ["Monthly rent", usd(rent)],
    ["Security deposit", usd(t.deposit)]
  ]);
}

function months(payments) {
  const pay = Object.entries(payments || {}).sort(([a], [b]) => a.localeCompare(b));
  if (!pay.length) return awaiting("Rent payment history");
  return `<ol class="months">${pay.map(([m, s]) => `<li><span class="m">${monthLabel(m)}</span><span class="chip ${esc(s)}">${STATUS[s] || esc(s)}</span></li>`).join("")}</ol>`;
}

function property(p) {
  const c = calc(p);
  const l = p.loan;
  const maturityYear = l && l.start && has(l.termYears) ? Number(l.start.slice(0, 4)) + l.termYears : null;
  const maint = [...(p.maintenance || [])].sort((a, b) => b.date.localeCompare(a.date));
  const maintTotal = total(maint.map(m => m.cost));
  const subtitle = [p.address, p.type].filter(Boolean).map(esc).join(" · ");

  let financing;
  if (l === false) financing = `<p class="empty">No mortgage. Owned outright.</p>`;
  else if (!l) financing = awaiting("Loan details");
  else financing = dl([
    ["Lender", l.lender ? esc(l.lender) : NA],
    ["Original loan", usd(l.original)],
    l.loanType ? ["Loan type", esc(l.loanType)] : null,
    ["Current balance", has(c.mortgageBalance) ? usd(c.mortgageBalance) + (c.balanceEstimated ? ` <span class="sub">(est.)</span>` : "") : NA],
    ["Interest rate", has(l.rate) ? pct(l.rate, 3).replace(/0%$/, "%") + (l.rateType ? " " + esc(l.rateType) : "") : NA],
    ["Term", has(l.termYears) ? `${l.termYears} years${maturityYear ? `, matures ${maturityYear}` : ""}` : NA],
    ["Principal and interest", usd(l.payment)],
    l.mi ? ["Mortgage insurance", usd(l.mi) + (l.miNote ? ` <span class="sub">(${esc(l.miNote)})</span>` : "")] : null,
    l.escrow ? ["Escrow (taxes and insurance)", usd(l.escrow)] : null,
    (l.mi || l.escrow) && has(c.mortgageDebt) ? ["Total monthly payment", usd(c.mortgageDebt)] : null,
    ["Loan to value" + (p.heloc ? " (incl. HELOC)" : ""), pct(c.ltv)]
  ]);
  const h = p.heloc;
  if (h) financing += `
      <p class="subhead">Home equity line of credit</p>
      ${dl([
        ["Lender", h.lender ? esc(h.lender) : NA],
        ["Balance", usd(h.balance) + (h.asOf ? ` <span class="sub">(as of ${date(h.asOf)})</span>` : "")],
        ["Credit limit", usd(h.limit) + (all(h.limit, h.balance) ? ` <span class="sub">(${usd(h.limit - h.balance)} available)</span>` : "")],
        ["Interest rate", has(h.rate) ? pct(h.rate, 2) + (h.rateType ? " " + esc(h.rateType) : "") : NA],
        ["Monthly payment", usd(h.payment) + (has(h.minimum) ? ` <span class="sub">(minimum due ${usd(h.minimum)}, interest only)</span>` : "")]
      ])}`;

  const expRows = Object.entries(p.expenses || {}).filter(([, v]) => v !== 0);
  const rentRows = p.units
    ? p.units.map(u => `<div><dt>Rent, ${esc(u.unit)}</dt><dd>${usd(u.rent)}</dd></div>`).join("")
    : `<div><dt>Rent</dt><dd>${usd(c.rent)}</dd></div>`;
  const otherRows = [...Object.entries(p.otherIncome || {}), ...(p.units || []).flatMap(u => Object.entries(u.charges || {}).map(([k, v]) => [`${k}, ${u.unit}`, v]))]
    .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${usd(v)}</dd></div>`).join("");
  const debtRows = l && (l.mi || l.escrow)
    ? `<div><dt>Mortgage principal and interest</dt><dd>${neg(l.payment)}</dd></div>`
      + (l.mi ? `<div><dt>Mortgage insurance</dt><dd>${neg(l.mi)}</dd></div>` : "")
      + (l.escrow ? `<div><dt>Escrow (taxes and insurance)</dt><dd>${neg(l.escrow)}</dd></div>` : "")
    : `<div><dt>Mortgage</dt><dd>${neg(c.mortgageDebt)}</dd></div>`;
  const helocRow = p.heloc ? `<div><dt>HELOC payment</dt><dd>${neg(p.heloc.payment)}</dd></div>` : "";
  const cashflow = (has(c.rent) || p.units || expRows.length || has(c.debt)) ? `
      <dl class="facts ledger">
        ${rentRows}
        ${otherRows}
        ${debtRows}
        ${helocRow}
        ${expRows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${neg(v)}</dd></div>`).join("")}
        ${expRows.length ? "" : `<div><dt>Operating expenses</dt><dd>${NA}</dd></div>`}
        <div class="total"><dt>Cash flow after debt</dt><dd>${signed(c.cashFlow)}</dd></div>
        <div><dt>Per year</dt><dd>${signed(c.annualCashFlow)}</dd></div>
        <div><dt>Cash-on-cash return</dt><dd>${pct(c.cashOnCash)}</dd></div>
      </dl>` : awaiting("Rent and expenses");

  return `
<details class="property">
  <summary>
    <span class="p-name"><strong>${esc(p.name)}</strong><span>${subtitle}</span></span>
    <span class="p-flow"><span>Cash flow / mo</span>${signed(c.cashFlow)}</span>
  </summary>
  <div class="p-body">
    <section class="panel">
      <h4>Purchase and value</h4>
      ${dl([
        ["Purchase price", usd(p.purchasePrice)],
        ["Purchased", date(p.purchaseDate)],
        ["Closing costs", usd(p.closingCosts)],
        ["Estimated value", usd(p.estimatedValue) + (p.valueSource ? ` <span class="sub">(${esc(p.valueSource)})</span>` : "")],
        p.market ? [`Market estimate (${esc(p.market.source)}, ${monthYear(p.market.date)})`,
          `${usd(p.market.value)}${has(p.market.low) ? ` <span class="sub">(range ${usd(p.market.low)} – ${usd(p.market.high)})</span>` : ""}`] : null,
        p.market && has(p.purchasePrice) ? ["Market estimate vs. purchase", `${signed(p.market.value - p.purchasePrice)} <span class="sub">(${pct((p.market.value - p.purchasePrice) / p.purchasePrice * 100)})</span>`] : null,
        p.zillow ? ["Live estimate", `<a class="ext" href="${esc(p.zillow)}" target="_blank" rel="noopener">View on Zillow</a>`] : null,
        ["Appreciation", has(c.appreciation) ? `${signed(c.appreciation)} <span class="sub">(${pct(c.appreciationPct)})</span>` : NA],
        ["Equity" + (p.market ? "*" : ""), usd(c.equity)]
      ])}
      ${p.market && has(c.balance) ? `<p class="footnote">* ${esc(p.market.source)} market estimate of ${usd(p.market.value)} (${monthYear(p.market.date)}) minus ${p.heloc ? `the mortgage balance of ${usd(c.mortgageBalance)} and HELOC balance of ${usd(c.helocBalance)}` : `the loan balance of ${usd(c.balance)}`}.${has(p.purchasePrice) ? ` Based on the purchase price of ${usd(p.purchasePrice)}, equity would be ${usd(p.purchasePrice - c.balance)}.` : ""}</p>` : ""}
    </section>
    <section class="panel">
      <h4>Financing</h4>
      ${financing}
    </section>
    <section class="panel">
      <h4>Monthly cash flow</h4>
      ${cashflow}
    </section>
    <section class="panel">
      <h4>${p.units ? "Tenants and leases" : "Tenant and lease"}</h4>
      ${p.units ? p.units.map(u => tenantFacts(u.tenant, u.rent, u.unit)).join("") : p.vacant ? `<p class="empty">Vacant.</p>` : tenantFacts(p.tenant, p.rent)}
    </section>
    <section class="panel wide">
      <h4>Rent payments</h4>
      ${p.units
        ? p.units.map(u => `<div class="unit-pay"><p class="unit-label">${esc(u.unit)}</p>${months(u.payments)}</div>`).join("")
        : months(p.payments)}
    </section>
    <section class="panel wide">
      <h4>Maintenance history</h4>
      ${maint.length ? `<div class="scroll"><table class="maint">
        <thead><tr><th>Date</th><th>Work</th><th class="num">Cost</th></tr></thead>
        <tbody>${maint.map(m => `<tr><td>${date(m.date)}</td><td>${esc(m.item)}</td><td class="num">${usd(m.cost)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${usd(maintTotal)}</td></tr></tfoot>
      </table></div>` : `<p class="empty">No maintenance recorded yet.</p>`}
    </section>
  </div>
</details>`;
}

export function renderPortfolio(data, title) {
  const ps = data.properties.map(p => ({ p, c: calc(p) }));
  const T = f => total(ps.map(f));
  const anyMarket = ps.some(({ p }) => p.market);
  const marketDates = [...new Set(ps.filter(({ p }) => p.market).map(({ p }) => `${p.market.source}, ${monthYear(p.market.date)}`))];
  const value = T(x => x.p.estimatedValue), balance = T(x => x.c.balance), equity = T(x => x.c.equity), flow = T(x => x.c.cashFlow);
  const purchaseTotal = T(x => x.p.purchasePrice);
  const marketTotal = total(ps.map(({ p }) => p.market && has(p.market.value) ? p.market.value : p.estimatedValue));
  const equityNote = anyMarket ? `<p class="footnote">* Equity is the latest market estimates (${esc(marketDates.join("; "))}) of ${usd(marketTotal)} minus loan balances of ${usd(balance)}.${has(purchaseTotal) && has(balance) ? ` Based on purchase prices of ${usd(purchaseTotal)}, equity would be ${usd(purchaseTotal - balance)}.` : ""}</p>` : "";
  const rent = T(x => x.c.income), debt = T(x => x.c.debt), exp = T(x => x.c.expenses);
  const market = T(x => x.p.market ? x.p.market.value : null);
  const ltv = has(balance) && has(value) && value ? balance / value * 100 : null;
  const incomplete = ps.some(({ c }) => !has(c.cashFlow) || !has(c.equity));

  return `
<div class="portal">
  <div class="intro">
    <p class="eyebrow">${esc(title)} · ${esc(data.portalLabel || "Executive Portal")}</p>
    <h1>Portfolio</h1>
    <p>${data.asOf ? `Figures as of ${esc(data.asOf)}. ` : ""}Select a property for financing, tenant, rent and maintenance details.</p>
    ${data.sample ? `<p class="sample-note">Sample data. These properties and figures are examples to show the layout.</p>` : ""}
    ${!data.sample && incomplete ? `<p class="sample-note">Some figures have not been entered yet and show as a dash. Totals appear once every property's figures are in.</p>` : ""}
  </div>

  <div class="tiles">
    <div><span>Properties</span><strong>${ps.length}</strong></div>
    <div><span>Estimated value</span><strong>${usd(value)}</strong></div>
    <div><span>Loan balances</span><strong>${usd(balance)}</strong></div>
    <div><span>Equity${anyMarket ? "*" : ""}</span><strong>${usd(equity)}</strong></div>
    <div class="key"><span>Cash flow after debt</span><strong>${signed(flow)}${has(flow) ? "<small> / mo</small>" : ""}</strong></div>
  </div>

  ${equityNote}

  <section class="block">
    <h3>Monthly cash flow by property</h3>
    <div class="scroll">
      <table class="ledger-table">
        <thead><tr><th>Property</th><th class="num">Income</th><th class="num">Debt service</th><th class="num">Expenses</th><th class="num">Cash flow</th><th class="num">Est. value</th><th class="num">Market est.</th><th class="num">Equity${anyMarket ? "*" : ""}</th><th class="num">LTV</th></tr></thead>
        <tbody>${ps.map(({ p, c }) => `<tr><td>${esc(p.name)}</td><td class="num">${usd(c.income)}</td><td class="num">${neg(c.debt)}</td><td class="num">${neg(c.expenses)}</td><td class="num strong">${signed(c.cashFlow)}</td><td class="num">${usd(p.estimatedValue)}</td><td class="num">${usd(p.market && p.market.value)}</td><td class="num">${usd(c.equity)}</td><td class="num">${pct(c.ltv, 0)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${usd(rent)}</td><td class="num">${neg(debt)}</td><td class="num">${neg(exp)}</td><td class="num strong">${signed(flow)}</td><td class="num">${usd(value)}</td><td class="num">${usd(market)}</td><td class="num">${usd(equity)}</td><td class="num">${pct(ltv, 0)}</td></tr></tfoot>
      </table>
    </div>
  </section>

  <section class="block">
    <h3>Properties</h3>
    <div class="properties">${ps.map(({ p }) => property(p)).join("")}</div>
  </section>
</div>`;
}

// ---------- Tenant portal: one page per unit, showing only that unit's own details ----------

const firstNames = name => {
  const parts = String(name).split(/,\s*|\s+and\s+|\s*&\s*/).map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
  return parts.length <= 1 ? parts.join("") : parts.slice(0, -1).join(", ") + " and " + parts.at(-1);
};

export function renderTenant(data, p, u) {
  const t = u.tenant || {};
  const extras = Object.entries(u.charges || {});
  const due = (u.rent || 0) + extras.reduce((a, [, v]) => a + v, 0);
  const address = `${u.unit} ${p.street}`;
  const memo = `${address} rent`;
  const venmoUrl = `https://venmo.com/?txn=pay&recipients=${encodeURIComponent(data.venmo)}&amount=${due.toFixed(2)}&note=${encodeURIComponent(memo)}`;
  const contacts = (data.contacts || []).map(c => `
        <li>
          <strong>${esc(c.name)}</strong>
          <a href="tel:${esc(c.phone.replace(/[^0-9+]/g, ""))}">${esc(c.phone)}</a>
          <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>
        </li>`).join("");

  return `
<div class="portal tenant">
  <div class="intro">
    <p class="eyebrow">MP Holdings · Tenant Portal</p>
    <h1>Welcome, ${esc(firstNames(t.name || ""))}</h1>
    <p>${esc(address)}, ${esc(p.city)}</p>
  </div>

  <div class="tenant-grid">
    <section class="pay-card">
      <h3>Pay Rent</h3>
      <p class="due"><strong>${usd(due)}</strong> due on the 1st of each month</p>
      ${extras.length ? `<dl class="facts">
        <div><dt>Rent</dt><dd>${usd(u.rent)}</dd></div>
        ${extras.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${usd(v)}</dd></div>`).join("")}
      </dl>` : ""}
      <a class="button venmo" href="${esc(venmoUrl)}" target="_blank" rel="noopener">Pay with Venmo</a>
      <p class="handle">Venmo: <strong>@${esc(data.venmo)}</strong></p>
      <p class="note">Please put your address and the month in the Venmo note, for example “${esc(address)}, ${new Date().toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} rent.”</p>
      <p class="note">Rent is late if not paid within 5 days of the 1st. A late fee of $10 per day applies after that.</p>
    </section>

    <section class="panel">
      <h4>Your lease</h4>
      ${dl([
        ["Tenant", esc(t.name)],
        ["Lease", t.leaseStart ? `${date(t.leaseStart)} to ${t.leaseEnd ? date(t.leaseEnd) : NA}` : NA],
        t.note && /month-to-month/i.test(t.note) ? ["Status", esc(t.note)] : null,
        ["Monthly rent", usd(u.rent)],
        ...extras.map(([k, v]) => [k, usd(v)]),
        ["Security deposit", usd(t.deposit)]
      ])}
    </section>

    <section class="panel">
      <h4>Your rent payments</h4>
      ${Object.keys(u.payments || {}).length ? months(u.payments) : `<p class="empty">Your payment history will appear here once it's recorded.</p>`}
    </section>

    <section class="panel">
      <h4>Maintenance and questions</h4>
      <p>For maintenance requests or anything about your home, call, text or email either of us. For an emergency such as a leak, no heat or a safety issue, please call right away.</p>
      <ul class="contacts">${contacts}</ul>
    </section>
  </div>
</div>`;
}
