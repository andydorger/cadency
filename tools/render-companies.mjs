// Renders the Cadency executive portal from a companies data file (portals/cadency.json):
// a portfolio summary first, then one block per portfolio company.
// Figures may be null (not yet provided): they show as a dash and totals that depend on them stay blank.

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const has = v => typeof v === "number" && Number.isFinite(v);
const NA = `<span class="na">—</span>`;
const money = n => {
  if (!has(n)) return NA;
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2).replace(/\.?0+$/, "")}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  return `${s}$${Math.round(a).toLocaleString("en-US")}`;
};
const pct = (n, d = 0) => has(n) ? `${n.toFixed(d)}%` : NA;
const mult = n => has(n) ? `${n.toFixed(1)}x` : NA;
const num = n => has(n) ? Math.round(n).toLocaleString("en-US") : NA;
const date = iso => iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : NA;
const total = xs => xs.length && xs.every(has) ? xs.reduce((a, b) => a + b, 0) : null;
const initials = name => String(name).split(/\s+/).filter(w => /^[A-Za-z0-9]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join("");
const slug = name => "co-" + String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const dl = rows => `<dl class="facts">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const metrics = items => `<dl class="pb-metrics">${items.filter(Boolean).map(([k, v, cls]) =>
  `<div${cls ? ` class="${cls}"` : ""}><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;

function calc(co) {
  const last = (co.financials || []).at(-1) || {};
  const revenue = has(last.revenue) ? last.revenue : null;
  const ebitda = has(last.ebitda) ? last.ebitda : null;
  const value = has(co.value) ? co.value : null;
  const invested = has(co.invested) ? co.invested : null;
  const share = has(co.ownership) ? co.ownership / 100 : null;
  const debt = co.debt && has(co.debt.amount) ? co.debt.amount : 0;
  const equity = has(value) ? value - debt : null;
  return {
    revenue, ebitda,
    margin: has(revenue) && has(ebitda) && revenue ? ebitda / revenue * 100 : null,
    equity,
    ourValue: has(equity) && has(share) ? equity * share : null,
    moic: has(equity) && has(share) && has(invested) && invested ? equity * share / invested : null,
    year: last.year
  };
}

function company(co) {
  const c = calc(co);
  const fin = co.financials || [];
  const lead = co.leadership || [];
  const updates = [...(co.updates || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const docs = co.documents || [];
  return `
<article class="pblock co-block" id="${slug(co.name)}">
  <header class="pb-head">
    <div class="co-band">
      <span class="co-mark" aria-hidden="true">${esc(co.initials || initials(co.name))}</span>
      <span class="co-tags">${[co.industry, co.location].filter(Boolean).map(t => `<span>${esc(t)}</span>`).join("")}</span>
    </div>
    <div class="pb-title">
      <h2>${esc(co.name)}</h2>
      <p>${esc(co.tagline || "")}</p>
    </div>
  </header>
  ${metrics([
    [`Revenue${c.year ? ` (${c.year})` : ""}`, money(c.revenue)], [`EBITDA${c.year ? ` (${c.year})` : ""}`, money(c.ebitda)],
    ["EBITDA margin", pct(c.margin)], ["Employees", num(co.employees)],
    ["Ownership", pct(co.ownership)], ["Invested", money(co.invested)], ["Our value", money(c.ourValue)], ["MOIC", mult(c.moic), "key"]
  ])}
  <div class="p-body">
    <section class="panel">
      <h4>Overview</h4>
      ${co.description ? `<p class="co-desc">${esc(co.description)}</p>` : ""}
      ${dl([
        ["Headquarters", co.location ? esc(co.location) : NA],
        ["Founded", co.founded ? esc(co.founded) : NA],
        ["Acquired", date(co.acquired)],
        ["Website", co.website ? `<a class="ext" href="${esc(co.website)}" target="_blank" rel="noopener">${esc(co.website.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</a>` : NA]
      ])}
    </section>
    <section class="panel">
      <h4>Leadership and board</h4>
      ${lead.length ? dl(lead.map(l => [l.role, esc(l.name)])) : `<p class="empty">Leadership not yet added.</p>`}
    </section>
    <section class="panel">
      <h4>Financials</h4>
      ${fin.length ? `<div class="scroll"><table class="maint">
        <thead><tr><th>Year</th><th class="num">Revenue</th><th class="num">EBITDA</th><th class="num">Margin</th></tr></thead>
        <tbody>${fin.map(f => `<tr><td>${esc(f.year)}</td><td class="num">${money(f.revenue)}</td><td class="num">${money(f.ebitda)}</td><td class="num">${has(f.revenue) && has(f.ebitda) && f.revenue ? pct(f.ebitda / f.revenue * 100) : NA}</td></tr>`).join("")}</tbody>
      </table></div>` : `<p class="empty">Financials not yet added.</p>`}
    </section>
    <section class="panel">
      <h4>Capital structure</h4>
      ${dl([
        ["Enterprise value", money(co.value)],
        ["Cadency ownership", pct(co.ownership)],
        ["Equity invested", money(co.invested)],
        ["Debt", money(co.debt && co.debt.amount)],
        ["Equity value", money(c.equity)],
        co.debt && co.debt.lender ? ["Lender", esc(co.debt.lender)] : null,
        co.debt && co.debt.terms ? ["Terms", esc(co.debt.terms)] : null
      ])}
    </section>
    <section class="panel wide">
      <h4>Recent updates</h4>
      ${updates.length ? `<ul class="co-updates">${updates.map(u => `<li><span class="when">${date(u.date)}</span><span>${esc(u.text)}</span></li>`).join("")}</ul>` : `<p class="empty">No updates yet.</p>`}
    </section>
    <section class="panel wide">
      <h4>Documents</h4>
      ${docs.length ? `<ul class="co-docs">${docs.map(d => `<li>${d.url ? `<a class="ext" href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.name)}</a>` : esc(d.name)}${d.note ? ` <span class="sub">${esc(d.note)}</span>` : ""}</li>`).join("")}</ul>` : `<p class="empty">No documents yet.</p>`}
    </section>
  </div>
</article>`;
}

export function renderCompanies(data, title) {
  const cos = data.companies || [];
  const cs = cos.map(co => ({ co, c: calc(co) }));
  const T = f => total(cs.map(f));
  const revenue = T(x => x.c.revenue), ebitda = T(x => x.c.ebitda), invested = T(x => x.co.invested);
  const ourValue = T(x => x.c.ourValue), employees = T(x => x.co.employees);
  const moic = has(ourValue) && has(invested) && invested ? ourValue / invested : null;
  const COLORS = ["#c49a52", "#3aa48a", "#c4664a", "#6f8fc4", "#a77bc4", "#8a9a5b"];

  // Share of portfolio value: one donut, one slice per company.
  let donut = "";
  if (has(ourValue) && ourValue > 0) {
    let at = 0;
    const arcs = cs.map(({ co, c }, i) => {
      const part = c.ourValue / ourValue * 100;
      const arc = `<circle cx="21" cy="21" r="15.915" stroke="${COLORS[i % COLORS.length]}" stroke-dasharray="${part.toFixed(2)} ${(100 - part).toFixed(2)}" stroke-dashoffset="${(25 - at).toFixed(2)}"/>`;
      at += part; return arc;
    }).join("");
    donut = `<div class="eb co-share">
      <h4>Share of portfolio value</h4>
      <div class="co-share-row">
        <figure class="pie"><svg viewBox="0 0 42 42" role="img" aria-label="Share of portfolio value by company">${arcs}
          <text x="21" y="20.5" class="pie-pct">${cs.length}</text><text x="21" y="25.5" class="pie-sub" style="letter-spacing:.06em">companies</text></svg></figure>
        <ul class="co-legend">${cs.map(({ co, c }, i) => `<li><i style="background:${COLORS[i % COLORS.length]}"></i><button type="button" data-scroll="${slug(co.name)}">${esc(co.name)}</button><span>${money(c.ourValue)} · ${pct(c.ourValue / ourValue * 100)}</span></li>`).join("")}</ul>
      </div>
    </div>`;
  }

  return `
<div class="portal">
  <div class="intro">
    <p class="eyebrow">${esc(title)} · Executive Portal</p>
    <h1>Portfolio companies</h1>
    ${data.sample ? `<p class="sample-note">Placeholder companies and sample figures, to show the layout. Real company details replace these.</p>` : ""}
  </div>

  <section class="pblock pb-portfolio" aria-labelledby="co-summary-title">
    <header class="pb-head">
      <div class="pb-title">
        <h2 id="co-summary-title">Portfolio summary</h2>
        <p>${cs.length} operating ${cs.length === 1 ? "company" : "companies"}${data.asOf ? ` · as of ${esc(data.asOf)}` : ""}</p>
      </div>
    </header>
    ${metrics([
      ["Companies", String(cs.length)], ["Revenue (latest year)", money(revenue)], ["EBITDA (latest year)", money(ebitda)],
      ["EBITDA margin", has(revenue) && has(ebitda) && revenue ? pct(ebitda / revenue * 100) : NA], ["Employees", num(employees)],
      ["Equity invested", money(invested)], ["Value of our stakes", money(ourValue)], ["Gross MOIC", mult(moic), "key"],
      ["Value created", has(ourValue) && has(invested) ? money(ourValue - invested) : NA], ["Sectors", String(new Set(cs.map(({ co }) => co.industry).filter(Boolean)).size)]
    ])}
    ${donut}
    <p class="footnote">Revenue and EBITDA are each company's latest full year. Value of our stakes is each company's enterprise value, less its debt, times Cadency's ownership; gross MOIC (multiple on invested capital) is that value divided by equity invested.</p>
  </section>

  ${cs.map(({ co }) => company(co)).join("")}
</div>`;
}
