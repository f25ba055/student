(() => {
  "use strict";

  const shop = PrintShop;
  const storageKey = "printshop-classroom-v1";
  const views = { orders: "注文受付", quotes: "見積", proof: "入稿確認", work: "製造進行", delivery: "納品", rates: "商品・料金設定" };
  const nav = document.querySelector("#nav");
  const view = document.querySelector("#view");
  const notice = document.querySelector("#notice");
  const money = value => new Intl.NumberFormat("ja-JP").format(value) + " 円";
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  let state = load();
  let page = "orders";
  let selection = null;
  let broughtOnly = false;

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Array.isArray(saved.orders) && saved.rates && Number.isInteger(saved.nextId)) return saved;
    } catch (error) {
      console.warn("保存データを読み込めませんでした", error);
    }
    return shop.seed();
  }

  function update(message) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
      render();
      notice.textContent = message;
    } catch (error) {
      render();
      notice.textContent = "画面には反映しましたが、ブラウザに保存できませんでした。";
    }
  }

  function field(label, name, value = "", type = "text", attributes = "") {
    return `<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${attributes}></label>`;
  }

  function select(label, name, values, selected) {
    const options = Object.entries(values).map(([key, item]) =>
      `<option value="${key}" ${key === selected ? "selected" : ""}>${esc(item.name ?? item)}</option>`
    ).join("");
    return `<label>${label}<select name="${name}">${options}</select></label>`;
  }

  function button(label, action, id) {
    return `<button type="button" data-action="${action}" data-id="${id}">${label}</button>`;
  }

  function table(headers, rows) {
    if (!rows.length) return "<p>対象の注文はありません。</p>";
    return `<div class="table"><table><thead><tr>${headers.map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead><tbody>${
      rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join("")}</tr>`).join("")
    }</tbody></table></div>`;
  }

  function orderCells(order) {
    return [order.id, esc(order.customer), esc(shop.products[order.product].name), order.quantity, shop.status[order.status]];
  }

  function updatePaperCostPreview() {
    const preview = view.querySelector("[data-paper-cost-preview]");
    if (!preview) return;
    const paper = view.querySelector('[name="paper"]').value;
    const quantity = Number(view.querySelector('[name="quantity"]').value);
    preview.textContent = money(shop.paper[paper].unit * (Number.isFinite(quantity) ? quantity : 0));
  }

  function renderOrders() {
    const order = state.orders.find(item => item.id === selection);
    const paper = order?.paper ?? Object.keys(shop.paper)[0];
    const quantity = order?.quantity ?? 100;
    return `<form class="panel" data-form="order"><h2>${order ? `注文 ${order.id} を編集` : "新規注文"}</h2><div class="grid">
      ${field("注文者", "customer", order?.customer, "text", "required maxlength=100")}
      ${select("商品", "product", shop.products, order?.product)}
      ${field("部数", "quantity", quantity, "number", "required min=1 max=100000 step=1")}
      ${select("用紙", "paper", shop.paper, order?.paper)}
      <p>用紙代（見積）: <output data-paper-cost-preview aria-live="polite">${money(shop.paper[paper].unit * quantity)}</output></p>
      <label><input type="checkbox" name="returnSurplus" ${order?.returnSurplus ? "checked" : ""}>余剰を納品時に返却する</label>
      ${select("印刷面", "sides", { single: "片面", double: "両面" }, order?.double ? "double" : "single")}
      ${select("加工", "finish", shop.finish, order?.finish)}
      ${select("納期区分", "speed", { standard: "通常", rush: "特急" }, order?.rush ? "rush" : "standard")}
      ${field("入力原稿締め切り", "proofDue", order?.proofDue, "date", "required")}
      ${field("希望納期", "due", order?.due, "date", "required")}
      ${select("納品方法", "delivery", shop.delivery, order?.delivery)}
      ${field("配送先", "address", order?.address, "text", "maxlength=200")}
      </div><div class="actions"><button>注文を保存</button>${order ? button("編集を閉じる", "clear", order.id) : ""}</div></form>`
      + table(["注文", "注文者", "商品", "部数", "状態", "納期", "操作"], state.orders.map(item => [
        ...orderCells(item), esc(item.due),
        (item.status === "received" ? button("編集", "edit", item.id) : "") + button("見積へ", "quote", item.id)
      ]));
  }

  function renderQuotes() {
    const order = state.orders.find(item => item.id === selection);
    const pricing = order ? order.quoteSnapshot ?? shop.quote(order, state.rates) : null;
    const blocks = !order ? "" : `<section class="panel"><h2>注文 ${order.id} ・ ${esc(order.customer)}</h2>${
      table(["項目", "金額"], [
        ["印刷代", money(pricing.printing)], ["用紙代", money(pricing.paperCost)],
        ["加工費", money(pricing.finishing)], ["特急料金", money(pricing.rush)], ["数量割引", money(pricing.discount ? -pricing.discount : 0)]
      ])
    }${order.paper === "brought" ? "<p>持ち込み用紙の場合も、加工料金・特急料金は通常どおりかかります。</p>" : ""}<p class="summary">合計 ${money(pricing.total)}</p>${
      order.status === "received" ? button("見積を確定", "confirmQuote", order.id) : "<p>確定済みの見積を表示しています。</p>"
    }</section>`;
    return blocks + table(["注文", "注文者", "商品", "部数", "状態", "操作"], state.orders.map(item =>
      [...orderCells(item), button("見積を見る", "quote", item.id)]
    ));
  }

  function renderProof() {
    const candidates = state.orders.filter(order => ["quoted", "proof", "returned"].includes(order.status));
    const order = candidates.find(item => item.id === selection);
    const form = order ? `<form class="panel" data-form="proof"><h2>注文 ${order.id} の入稿</h2><div class="grid">
      ${field("原稿ファイル名", "file", "", "text", "required maxlength=150")}
      </div><div class="actions"><button>入稿を記録</button></div></form>` : "";
    return form + table(["注文", "注文者", "商品", "部数", "状態", "入力原稿締め切り", "原稿", "確認メモ", "操作"], candidates.map(item => [
      ...orderCells(item), esc(item.proofDue), item.proofFile ? `第${item.revision}版 ・ ${esc(item.proofFile)}` : "未入稿", esc(item.note),
      button(item.status === "quoted" ? "入稿" : "再入稿", "choose", item.id) +
      (item.status === "proof" ? button("承認", "approve", item.id) + button("差し戻す", "returnProof", item.id) : "")
    ]));
  }

  function renderWork() {
    const manufacturingOrders = shop.manufacturingOrders(state.orders);
    const candidates = broughtOnly
      ? manufacturingOrders.filter(item => item.paper === "brought")
      : manufacturingOrders;
    const nextLabel = { ready: "印刷を開始", printing: "加工へ進む", finishing: "検品完了" };
    const order = candidates.find(item => item.id === selection);
    const form = order ? `<form class="panel" data-form="owner"><h2>注文 ${order.id} の製造担当</h2><div class="grid">
      ${field("担当者", "owner", order.workOwner, "text", "required maxlength=50")}</div>
      <div class="actions"><button>担当を保存</button></div></form>` : "";
    return `<label>表示対象<select id="work-paper-filter">
      <option value="all" ${broughtOnly ? "" : "selected"}>すべての用紙</option>
      <option value="brought" ${broughtOnly ? "selected" : ""}>持ち込み用紙のみ</option>
    </select></label>` + form + table(["注文", "注文者", "商品", "部数", "状態", "希望納期", "担当", "持ち込み用紙受取", "操作"], candidates.map(item => [
      ...orderCells(item), esc(item.due), esc(item.workOwner) || "未割当",
      item.paper !== "brought" ? "-" : item.status === "ready"
        ? `<input type="checkbox" data-action="receipt" data-id="${item.id}" aria-label="注文 ${item.id} の持ち込み用紙受取済み" ${item.broughtPaperReceived ? "checked" : ""}>`
        : item.broughtPaperReceived ? "受取済み" : "未確認",
      button("担当を設定", "choose", item.id) +
      (nextLabel[item.status] ? button(nextLabel[item.status], "advance", item.id) : "")
    ]));
  }

  function renderDelivery() {
    const candidates = state.orders.filter(order => ["inspected", "delivered"].includes(order.status));
    return table(["注文", "注文者", "商品", "部数", "状態", "納品方法", "持ち込み用紙", "余剰用紙", "希望納期", "配送先", "操作"], candidates.map(item => [
      ...orderCells(item), shop.delivery[item.delivery], item.paper === "brought" ? "あり" : "なし",
      item.paper === "brought" ? (item.returnSurplus ? "返却する" : "返却しない") : "-",
      esc(item.due), esc(item.address),
      item.status === "inspected" ? button("納品完了", "deliver", item.id) : ""
    ]));
  }

  function renderRates() {
    return `<form class="panel" data-form="rates"><h2>商品別の印刷単価</h2>
      <p>片面1部あたりの単価です。確定済みの見積には確定時点の金額を表示します。</p>
      <div class="grid">${Object.entries(shop.products).map(([key, product]) =>
        field(product.name + "（円）", key, state.rates[key], "number", "required min=0 max=100000 step=1")).join("")}</div>
      <div class="actions"><button>単価を保存</button></div></form>`
      + table(["用紙", "1部あたり"], Object.values(shop.paper).map(item => [esc(item.name), money(item.unit)]))
      + table(["加工", "1注文あたり"], Object.values(shop.finish).map(item => [esc(item.name), money(item.fee)]));
  }

  const renderers = { orders: renderOrders, quotes: renderQuotes, proof: renderProof, work: renderWork, delivery: renderDelivery, rates: renderRates };
  function render() {
    nav.innerHTML = Object.entries(views).map(([key, name]) =>
      `<button type="button" data-page="${key}" ${key === page ? 'aria-current="page"' : ""}>${name}</button>`
    ).join("");
    view.innerHTML = `<h1>${views[page]}</h1>` + renderers[page]();
  }

  nav.addEventListener("click", event => {
    const next = event.target.closest("button")?.dataset.page;
    if (!(next in views)) return;
    page = next;
    selection = null;
    notice.textContent = "";
    render();
    nav.querySelector('[aria-current="page"]').focus();
  });

  view.addEventListener("change", event => {
    if (event.target.name === "paper") {
      updatePaperCostPreview();
      return;
    }
    if (event.target.id === "work-paper-filter") {
      broughtOnly = event.target.value === "brought";
      render();
      view.querySelector("#work-paper-filter").focus();
      return;
    }
    if (event.target.dataset.action !== "receipt") return;
    const order = state.orders.find(item => item.id === Number(event.target.dataset.id));
    if (!order || order.paper !== "brought" || order.status !== "ready") return;
    order.broughtPaperReceived = event.target.checked;
    update("持ち込み用紙の受け取りを更新しました。");
    view.querySelector(`input[data-action="receipt"][data-id="${order.id}"]`)?.focus();
  });

  view.addEventListener("input", event => {
    if (event.target.name === "quantity") updatePaperCostPreview();
  });

  view.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.target);
    const type = event.target.dataset.form;
    const order = state.orders.find(item => item.id === selection);
    if (type === "order") {
      const fields = {
        customer: data.get("customer").trim(), product: data.get("product"), quantity: Number(data.get("quantity")),
        paper: data.get("paper"), double: data.get("sides") === "double", finish: data.get("finish"),
        rush: data.get("speed") === "rush", proofDue: data.get("proofDue"), due: data.get("due"), delivery: data.get("delivery"), address: data.get("address").trim(),
        returnSurplus: data.get("paper") === "brought" && data.get("returnSurplus") === "on",
        broughtPaperReceived: data.get("paper") === "brought" && order?.broughtPaperReceived === true
      };
      if (!fields.customer || !fields.proofDue || (fields.delivery === "ship" && !fields.address)) {
        notice.textContent = "注文者、入力原稿締め切りと、配送の場合は配送先を入力してください。";
        return;
      }
      if (order?.status === "received") Object.assign(order, fields);
      else state.orders.push({ ...fields, id: state.nextId++, status: "received", proofFile: "", revision: 0, note: "", workOwner: "", quoteSnapshot: null });
    }
    if (type === "proof" && order) {
      const file = data.get("file").trim();
      if (!file) { notice.textContent = "原稿ファイル名を入力してください。"; return; }
      Object.assign(order, { proofFile: file, revision: order.revision + 1, status: "proof" });
    }
    if (type === "owner" && order) {
      const owner = data.get("owner").trim();
      if (!owner) { notice.textContent = "担当者を入力してください。"; return; }
      order.workOwner = owner;
    }
    if (type === "rates") {
      for (const product of Object.keys(shop.products)) state.rates[product] = Number(data.get(product));
    }
    selection = null;
    update("保存しました。");
  });

  view.addEventListener("click", event => {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const { action, id } = control.dataset;
    const order = state.orders.find(item => item.id === Number(id));
    if (!order) return;
    switch (action) {
      case "quote": page = "quotes"; selection = order.id; render(); view.focus(); return;
      case "edit":
      case "choose": selection = order.id; render(); view.querySelector("form input")?.focus(); return;
      case "clear": selection = null; render(); view.focus(); return;
      case "confirmQuote":
        order.quoteSnapshot = shop.quote(order, state.rates);
        order.status = "quoted";
        break;
      case "approve": order.status = "ready"; break;
      case "returnProof": {
        const note = window.prompt("差し戻し理由を入力してください");
        if (!note?.trim()) return;
        Object.assign(order, { status: "returned", note: note.trim() });
        break;
      }
      case "advance":
        if (order.status === "ready" && order.paper === "brought" && !order.broughtPaperReceived) {
          notice.textContent = "持ち込み用紙の受け取りを確認してから印刷を開始してください。";
          return;
        }
        order.status = { ready: "printing", printing: "finishing", finishing: "inspected" }[order.status];
        break;
      case "deliver": order.status = "delivered"; break;
      default: return;
    }
    if (page !== "quotes") selection = null;
    update("注文 " + order.id + " を更新しました。");
  });

  document.querySelector("#reset").addEventListener("click", () => {
    if (!window.confirm("このブラウザの注文と料金をサンプルに戻しますか？")) return;
    state = shop.seed();
    selection = null;
    update("サンプルに戻しました。");
  });

  render();
})();
