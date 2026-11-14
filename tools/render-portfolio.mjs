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
const STATUS = { paid: "Paid", late: "Paid late", due: "Due", unpaid: "Unpaid" };
const total = xs => xs.every(has) && xs.length ? xs.reduce((a, b) => a + b, 0) : null;

function calc(p) {
  const loan = p.loan;
  const noLoan = loan === false;
  const debt = noLoan ? 0 : (loan && has(loan.payment) ? loan.payment + (loan.escrow || 0) : null);
  const expList = Object.values(p.expenses || {});
  const expenses = p.expenses && expList.length && expList.every(v => v === 0 || has(v)) ? expList.reduce((a, b) => a + b, 0) : null;
  const cashFlow = all(p.rent, debt, expenses) ? p.rent - debt - expenses : null;
  const balance = noLoan ? 0 : (loan && has(loan.balance) ? loan.balance : null);
  const original = noLoan ? 0 : (loan && has(loan.original) ? loan.original : null);
  const invested = all(p.purchasePrice, original) ? p.purchasePrice - original + (p.closingCosts || 0) : null;
  const equity = all(p.estimatedValue, balance) ? p.estimatedValue - balance : null;
  return {
    debt, expenses, cashFlow, balance, equity,
    annualCashFlow: has(cashFlow) ? cashFlow * 12 : null,
    cashOnCash: has(cashFlow) && has(invested) && invested > 0 ? (cashFlow * 12 / invested) * 100 : null,
    ltv: has(balance) && has(p.estimatedValue) && p.estimatedValue ? (balance / p.estimatedValue) * 100 : null,
    appreciation: all(p.estimatedValue, p.purchasePrice) ? p.estimatedValue - p.purchasePrice : null,
    appreciationPct: all(p.estimatedValue, p.purchasePrice) ? ((p.estimatedValue - p.purchasePrice) / p.purchasePrice) * 100 : null
  };
}

const dl = rows => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const awaiting = what => `<p class="empty">${what} not yet provided.</p>`;

function property(p) {
  const c = calc(p);
  const l = p.loan;
  const maturityYear = l && l.start && has(l.termYears) ? Number(l.start.slice(0, 4)) + l.termYears : null;
  const pay = Object.entries(p.payments || {}).sort(([a], [b]) => a.localeCompare(b));
  const maint = [...(p.maintenance || [])].sort((a, b) => b.date.localeCompare(a.date));
  const maintTotal = total(maint.map(m => m.cost));
  const subtitle = [p.address, p.type].filter(Boolean).map(esc).join(" · ");

  let financing;
  if (l === false) financing = `<p class="empty">No mortgage. Owned outright.</p>`;
  else if (!l) financing = awaiting("Loan details");
  else financing = dl([
    ["Lender", l.lender ? esc(l.lender) : NA],
    ["Original loan", usd(l.original)],
    ["Current balance", usd(l.balance)],
    ["Interest rate", has(l.rate) ? pct(l.rate, 2) + (l.rateType ? " " + esc(l.rateType) : "") : NA],
    ["Term", has(l.termYears) ? `${l.termYears} years${maturityYear ? `, matures ${maturityYear}` : ""}` : NA],
    ["Monthly payment", has(l.payment) ? usd(l.payment) + (l.escrow ? ` + ${usd(l.escrow)} escrow` : "") : NA],
    ["Loan to value", pct(c.ltv)]
  ]);

  const expRows = Object.entries(p.expenses || {}).filter(([, v]) => v !== 0);
  const cashflow = (has(p.rent) || expRows.length || has(c.debt)) ? `
      <dl class="facts ledger">
        <div><dt>Rent</dt><dd>${usd(p.rent)}</dd></div>
        <div><dt>Mortgage${l && l.escrow ? " and escrow" : ""}</dt><dd>${neg(c.debt)}</dd></div>
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
        ["Estimated value", usd(p.estimatedValue)],
        ["Appreciation", has(c.appreciation) ? `${signed(c.appreciation)} <span class="sub">(${pct(c.appreciationPct)})</span>` : NA],
        ["Equity", usd(c.equity)]
      ])}
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
      <h4>Tenant and lease</h4>
      ${p.vacant ? `<p class="empty">Vacant.</p>` : p.tenant ? dl([
        ["Tenant", esc(p.tenant.name)],
        ["Lease", p.tenant.leaseStart ? `${date(p.tenant.leaseStart)} to ${date(p.tenant.leaseEnd)}` : NA],
        p.tenant.note ? ["Status", esc(p.tenant.note)] : null,
        ["Monthly rent", usd(p.rent)],
        ["Security deposit", usd(p.tenant.deposit)]
      ]) : awaiting("Tenant details")}
    </section>
    <section class="panel wide">
      <h4>Rent payments</h4>
      ${pay.length ? `<ol class="months">
        ${pay.map(([m, s]) => `<li><span class="m">${monthLabel(m)}</span><span class="chip ${esc(s)}">${STATUS[s] || esc(s)}</span></li>`).join("")}
      </ol>` : awaiting("Rent payment history")}
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
  const value = T(x => x.p.estimatedValue), balance = T(x => x.c.balance), equity = T(x => x.c.equity), flow = T(x => x.c.cashFlow);
  const rent = T(x => x.p.rent), debt = T(x => x.c.debt), exp = T(x => x.c.expenses);
  const ltv = has(balance) && has(value) && value ? balance / value * 100 : null;
  const incomplete = ps.some(({ c }) => !has(c.cashFlow) || !has(c.equity));

  return `
<div class="portal">
  <div class="intro">
    <p class="eyebrow">${esc(title)} · Executive Portal</p>
    <h1>Portfolio</h1>
    <p>${data.asOf ? `Figures as of ${esc(data.asOf)}. ` : ""}Select a property for financing, tenant, rent and maintenance details.</p>
    ${data.sample ? `<p class="sample-note">Sample data. These properties and figures are examples to show the layout.</p>` : ""}
    ${!data.sample && incomplete ? `<p class="sample-note">Some figures have not been entered yet and show as a dash. Totals appear once every property's figures are in.</p>` : ""}
  </div>

  <div class="tiles">
    <div><span>Properties</span><strong>${ps.length}</strong></div>
    <div><span>Estimated value</span><strong>${usd(value)}</strong></div>
    <div><span>Loan balances</span><strong>${usd(balance)}</strong></div>
    <div><span>Equity</span><strong>${usd(equity)}</strong></div>
    <div class="key"><span>Cash flow after debt</span><strong>${signed(flow)}${has(flow) ? "<small> / mo</small>" : ""}</strong></div>
  </div>

  <section class="block">
    <h3>Monthly cash flow by property</h3>
    <div class="scroll">
      <table class="ledger-table">
        <thead><tr><th>Property</th><th class="num">Rent</th><th class="num">Debt service</th><th class="num">Expenses</th><th class="num">Cash flow</th><th class="num">Est. value</th><th class="num">Equity</th><th class="num">LTV</th></tr></thead>
        <tbody>${ps.map(({ p, c }) => `<tr><td>${esc(p.name)}</td><td class="num">${usd(p.rent)}</td><td class="num">${neg(c.debt)}</td><td class="num">${neg(c.expenses)}</td><td class="num strong">${signed(c.cashFlow)}</td><td class="num">${usd(p.estimatedValue)}</td><td class="num">${usd(c.equity)}</td><td class="num">${pct(c.ltv, 0)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${usd(rent)}</td><td class="num">${neg(debt)}</td><td class="num">${neg(exp)}</td><td class="num strong">${signed(flow)}</td><td class="num">${usd(value)}</td><td class="num">${usd(equity)}</td><td class="num">${pct(ltv, 0)}</td></tr></tfoot>
      </table>
    </div>
  </section>

  <section class="block">
    <h3>Properties</h3>
    <div class="properties">${ps.map(({ p }) => property(p)).join("")}</div>
  </section>
</div>`;
}
