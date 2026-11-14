// Turns a portfolio data file (portals/<id>.json) into the portal's HTML.
// All figures are calculated here at build time; the result is then encrypted by build.mjs.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = n => (n < 0 ? "−" : "") + "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
const pct = (n, d = 1) => (n < 0 ? "−" : "") + Math.abs(n).toFixed(d) + "%";
const sum = obj => Object.values(obj || {}).reduce((a, b) => a + (Number(b) || 0), 0);
const date = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthLabel = ym => new Date(ym + "-15T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
const signed = n => `<span class="${n < 0 ? "neg" : ""}">${usd(n)}</span>`;
const STATUS = { paid: "Paid", late: "Paid late", due: "Due", unpaid: "Unpaid" };

function calc(p) {
  const debt = (p.loan?.payment || 0) + (p.loan?.escrow || 0);
  const expenses = sum(p.expenses);
  const cashFlow = p.rent - debt - expenses;
  const invested = p.purchasePrice - (p.loan?.original || 0) + (p.closingCosts || 0);
  const balance = p.loan?.balance || 0;
  const equity = p.estimatedValue - balance;
  return {
    debt, expenses, cashFlow, invested, balance, equity,
    annualCashFlow: cashFlow * 12,
    cashOnCash: invested > 0 ? (cashFlow * 12 / invested) * 100 : null,
    ltv: p.estimatedValue ? (balance / p.estimatedValue) * 100 : 0,
    appreciation: p.estimatedValue - p.purchasePrice,
    appreciationPct: ((p.estimatedValue - p.purchasePrice) / p.purchasePrice) * 100
  };
}

const dl = rows => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

function property(p) {
  const c = calc(p);
  const l = p.loan || {};
  const maturityYear = l.start ? Number(l.start.slice(0, 4)) + l.termYears : null;
  const pay = Object.entries(p.payments || {}).sort(([a], [b]) => a.localeCompare(b));
  const maint = [...(p.maintenance || [])].sort((a, b) => b.date.localeCompare(a.date));
  const maintTotal = maint.reduce((a, m) => a + m.cost, 0);

  return `
<details class="property">
  <summary>
    <span class="p-name"><strong>${esc(p.name)}</strong><span>${esc(p.address)} · ${esc(p.type)}</span></span>
    <span class="p-flow"><span>Cash flow / mo</span>${signed(c.cashFlow)}</span>
  </summary>
  <div class="p-body">
    <section class="panel">
      <h4>Purchase and value</h4>
      ${dl([
        ["Purchase price", usd(p.purchasePrice)],
        ["Purchased", date(p.purchaseDate)],
        ["Closing costs", usd(p.closingCosts || 0)],
        ["Estimated value", usd(p.estimatedValue)],
        ["Appreciation", `${signed(c.appreciation)} <span class="sub">(${pct(c.appreciationPct)})</span>`],
        ["Equity", usd(c.equity)]
      ])}
    </section>
    <section class="panel">
      <h4>Financing</h4>
      ${l.lender ? dl([
        ["Lender", esc(l.lender)],
        ["Original loan", usd(l.original)],
        ["Current balance", usd(l.balance)],
        ["Interest rate", pct(l.rate, 2) + " fixed"],
        ["Term", `${l.termYears} years, matures ${maturityYear}`],
        ["Monthly payment", usd(l.payment) + (l.escrow ? ` + ${usd(l.escrow)} escrow` : "")],
        ["Loan to value", pct(c.ltv)]
      ]) : `<p class="empty">No loan. Owned outright.</p>`}
    </section>
    <section class="panel">
      <h4>Monthly cash flow</h4>
      <dl class="facts ledger">
        <div><dt>Rent</dt><dd>${usd(p.rent)}</dd></div>
        <div><dt>Mortgage${l.escrow ? " and escrow" : ""}</dt><dd>${usd(-c.debt)}</dd></div>
        ${Object.entries(p.expenses || {}).filter(([, v]) => v).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${usd(-v)}</dd></div>`).join("")}
        <div class="total"><dt>Cash flow after debt</dt><dd>${signed(c.cashFlow)}</dd></div>
        <div><dt>Per year</dt><dd>${signed(c.annualCashFlow)}</dd></div>
        ${c.cashOnCash !== null ? `<div><dt>Cash-on-cash return</dt><dd>${pct(c.cashOnCash)}</dd></div>` : ""}
      </dl>
    </section>
    <section class="panel">
      <h4>Tenant and lease</h4>
      ${p.tenant ? dl([
        ["Tenant", esc(p.tenant.name)],
        ["Lease", `${date(p.tenant.leaseStart)} to ${date(p.tenant.leaseEnd)}`],
        p.tenant.note ? ["Status", esc(p.tenant.note)] : null,
        ["Monthly rent", usd(p.rent)],
        ["Security deposit", usd(p.tenant.deposit || 0)]
      ]) : `<p class="empty">Vacant.</p>`}
    </section>
    <section class="panel wide">
      <h4>Rent payments</h4>
      <ol class="months">
        ${pay.map(([m, s]) => `<li><span class="m">${monthLabel(m)}</span><span class="chip ${esc(s)}">${STATUS[s] || esc(s)}</span></li>`).join("")}
      </ol>
    </section>
    <section class="panel wide">
      <h4>Maintenance history</h4>
      ${maint.length ? `<div class="scroll"><table class="maint">
        <thead><tr><th>Date</th><th>Work</th><th class="num">Cost</th></tr></thead>
        <tbody>${maint.map(m => `<tr><td>${date(m.date)}</td><td>${esc(m.item)}</td><td class="num">${usd(m.cost)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${usd(maintTotal)}</td></tr></tfoot>
      </table></div>` : `<p class="empty">No maintenance recorded.</p>`}
    </section>
  </div>
</details>`;
}

export function renderPortfolio(data, title) {
  const ps = data.properties.map(p => ({ p, c: calc(p) }));
  const t = k => ps.reduce((a, { p, c }) => a + (k in c ? c[k] : p[k]), 0);
  const value = t("estimatedValue"), balance = t("balance"), equity = t("equity"), flow = t("cashFlow");
  const rent = ps.reduce((a, { p }) => a + p.rent, 0), debt = t("debt"), exp = t("expenses");

  return `
<div class="portal">
  <div class="intro">
    <p class="eyebrow">${esc(title)} · Executive Portal</p>
    <h1>Portfolio</h1>
    <p>Figures as of ${esc(data.asOf)}. Select a property for financing, tenant, rent and maintenance details.</p>
    ${data.sample ? `<p class="sample-note">Sample data. These properties and figures are examples to show the layout.</p>` : ""}
  </div>

  <div class="tiles">
    <div><span>Properties</span><strong>${ps.length}</strong></div>
    <div><span>Estimated value</span><strong>${usd(value)}</strong></div>
    <div><span>Loan balances</span><strong>${usd(balance)}</strong></div>
    <div><span>Equity</span><strong>${usd(equity)}</strong></div>
    <div class="key"><span>Cash flow after debt</span><strong>${signed(flow)}<small> / mo</small></strong></div>
  </div>

  <section class="block">
    <h3>Monthly cash flow by property</h3>
    <div class="scroll">
      <table class="ledger-table">
        <thead><tr><th>Property</th><th class="num">Rent</th><th class="num">Debt service</th><th class="num">Expenses</th><th class="num">Cash flow</th><th class="num">Est. value</th><th class="num">Equity</th><th class="num">LTV</th></tr></thead>
        <tbody>${ps.map(({ p, c }) => `<tr><td>${esc(p.name)}</td><td class="num">${usd(p.rent)}</td><td class="num">${usd(-c.debt)}</td><td class="num">${usd(-c.expenses)}</td><td class="num strong">${signed(c.cashFlow)}</td><td class="num">${usd(p.estimatedValue)}</td><td class="num">${usd(c.equity)}</td><td class="num">${pct(c.ltv, 0)}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>Total</td><td class="num">${usd(rent)}</td><td class="num">${usd(-debt)}</td><td class="num">${usd(-exp)}</td><td class="num strong">${signed(flow)}</td><td class="num">${usd(value)}</td><td class="num">${usd(equity)}</td><td class="num">${pct(balance / value * 100, 0)}</td></tr></tfoot>
      </table>
    </div>
  </section>

  <section class="block">
    <h3>Properties</h3>
    <div class="properties">${ps.map(({ p }) => property(p)).join("")}</div>
  </section>
</div>`;
}
