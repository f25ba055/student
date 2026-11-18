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
  let orderNoFilter = "";
  let customerFilter = "";

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

  // 注文番号の入力を正規化する（全角数字・「#」・空白を許容）
  function normalizeOrderNo(value) {
    return String(value ?? "")
      .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
      .replace(/[#＃\s]/g, "");
  }

  // 注文者名の検索語を正規化する（前後の空白除去・英字の大小を区別しない）
  function normalizeCustomerQuery(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function filtersActive() {
    return Boolean(normalizeOrderNo(orderNoFilter) || normalizeCustomerQuery(customerFilter));
  }

  // 注文番号は完全一致、注文者名は部分一致。両方入力した場合は両方に一致する注文だけを表示する
  function filteredOrders() {
    const no = normalizeOrderNo(orderNoFilter);
    const name = normalizeCustomerQuery(customerFilter);
    return state.orders.filter(item =>
      (!no || String(item.id) === no) && (!name || item.customer.toLowerCase().includes(name)));
  }

  function ordersListHtml() {
    const rows = filteredOrders();
    const empty = filtersActive() && !rows.length ? "<p>条件に一致する注文はありません。</p>" : "";
    return empty || table(["注文", "注文者", "商品", "部数", "状態", "納期", "操作"], rows.map(item => [
      ...orderCells(item), esc(item.due),
      (item.status === "received" ? button("編集", "edit", item.id) : "") + button("見積へ", "quote", item.id)
    ]));
  }

  function orderCountText() {
    return filtersActive() ? `${filteredOrders().length} 件を表示中（全 ${state.orders.length} 件）` : "";
  }

  function renderOrders() {
    const order = state.orders.find(item => item.id === selection);
    return `<form class="panel" data-form="order"><h2>${order ? `注文 ${order.id} を編集` : "新規注文"}</h2><div class="grid">
      ${field("注文者", "customer", order?.customer, "text", "required maxlength=100")}
      ${select("商品", "product", shop.products, order?.product)}
      ${field("部数", "quantity", order?.quantity ?? 100, "number", "required min=1 max=100000 step=1")}
      ${select("用紙", "paper", shop.paper, order?.paper)}
      <label><input type="checkbox" name="returnSurplus" ${order?.returnSurplus ? "checked" : ""}>余剰を納品時に返却する</label>
      ${select("印刷面", "sides", { single: "片面", double: "両面" }, order?.double ? "double" : "single")}
      ${select("加工", "finish", shop.finish, order?.finish)}
      ${select("納期区分", "speed", { standard: "通常", rush: "特急" }, order?.rush ? "rush" : "standard")}
      ${field("希望納期", "due", order?.due, "date", "required")}
      ${select("納品方法", "delivery", shop.delivery, order?.delivery)}
      ${field("配送先", "address", order?.address, "text", "maxlength=200")}
      </div><div class="actions"><button>注文を保存</button>${order ? button("編集を閉じる", "clear", order.id) : ""}</div></form>
      <div class="panel" role="search"><div class="grid">
        <label>注文番号で絞り込み
          <input name="orderNo" type="search" inputmode="numeric" autocomplete="off" placeholder="例：103" value="${esc(orderNoFilter)}"></label>
        <label>注文者名で検索（一部でも可）
          <input name="customerQuery" type="search" autocomplete="off" placeholder="例：書店" value="${esc(customerFilter)}"></label></div>
        <p id="orderCount" aria-live="polite">${orderCountText()}</p></div>
      <div id="orderList">${ordersListHtml()}</div>`;
  }

  function conditionText(item) {
    return [
      shop.products[item.product]?.name, item.quantity + "部", item.double ? "両面" : "片面",
      shop.paper[item.paper]?.name, shop.finish[item.finish]?.name, item.rush ? "特急" : "通常"
    ].join(" / ");
  }

  function trialHistory(order) {
    const trials = order.quoteHistory ?? [];
    if (!trials.length) return "<p>保存した試算はありません。</p>";
    return table(["試算日時", "区分", "条件", "合計"], trials.slice().reverse().map(trial => [
      esc(new Date(trial.at).toLocaleString("ja-JP")), "試算（未確定）", esc(conditionText(trial)), money(trial.pricing.total)
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
    }<p class="summary">合計 ${money(pricing.total)}</p>${
      order.status === "received"
        ? button("試算を履歴に保存", "saveTrial", order.id) + button("見積を確定", "confirmQuote", order.id)
        : "<p>確定済みの見積を表示しています。</p>"
    }</section><section class="panel"><h2>確定前の試算履歴</h2>
      <p>試算した時点の条件と金額です。確定済みの見積とは別に保存しているため、確定額には影響しません。</p>${trialHistory(order)}</section>`;
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
    return form + table(["注文", "注文者", "商品", "部数", "状態", "原稿", "確認メモ", "操作"], candidates.map(item => [
      ...orderCells(item), item.proofFile ? `第${item.revision}版 ・ ${esc(item.proofFile)}` : "未入稿", esc(item.note),
      button(item.status === "quoted" ? "入稿" : "再入稿", "choose", item.id) +
      (item.status === "proof" ? button("承認", "approve", item.id) + button("差し戻す", "returnProof", item.id) : "")
    ]));
  }

  function renderWork() {
    const candidates = shop.manufacturingOrders(state.orders);
    candidates.forEach(shop.ensureLots);
    const nextLabel = { waiting: "印刷を開始", ready: "印刷を開始", printing: "加工へ進む", finishing: "検品完了" };
    const lotStatus = { waiting: "待機", ready: "製造待ち", printing: "印刷中", finishing: "加工中", paused: "作業中断", inspected: "検品済", delivered: "納品済" };
    const order = candidates.find(item => item.id === selection);
    const lotOptions = order ? Object.fromEntries(order.lots.map(lot => [lot.id, lot.label])) : {};
    const form = order ? `<form class="panel" data-form="work"><h2>注文 ${order.id} の製造管理</h2><div class="grid">
      ${field("担当者", "owner", order.workOwner, "text", "required maxlength=50")}
      ${field("追加部数", "additionalQuantity", "", "number", "min=1 max=100000 step=1")}
      ${select("中断対象ロット", "pauseLot", lotOptions, lotOptions[1] ? "1" : "")}
      ${field("中断理由", "pauseReason", "", "text", "maxlength=200")}
      ${field("再開予定", "resumeAt", "", "datetime-local")}
      </div><div class="actions"><button>担当を保存</button><button type="submit" name="addLot">追加分を登録</button><button type="submit" name="pauseLot">作業中断を記録</button><button type="submit" name="resumeLot">作業再開を記録</button></div></form>` : "";
    const lotRows = candidates.flatMap(item => (item.lots || []).map(lot => {
      const advance = nextLabel[lot.status] ? button(nextLabel[lot.status], "advanceLot", `${item.id}:${lot.id}`) : "";
      const revert = lot.status === "inspected" && item.status !== "delivered"
        ? button("加工中へ戻す", "revertLot", `${item.id}:${lot.id}`) : "";
      const pauseInfo = lot.status === "paused"
        ? `理由: ${esc(lot.pauseReason) || "未記入"}<br>再開予定: ${esc(lot.resumeAt) || "未設定"}`
        : (lot.pauseHistory?.length ? `直近の中断: ${esc(lot.pauseHistory.at(-1).reason)}` : "-");
      const ownerHistory = lot.ownerHistory?.map(entry => `${esc(entry.stage)}: ${esc(entry.owner)}`).join(" / ") || "履歴なし";
      const ownerInfo = `印刷: ${esc(lot.printOwner) || "未割当"}<br>加工: ${esc(lot.finishingOwner) || "未割当"}<br>履歴: ${ownerHistory}`;
      return [item.id, esc(item.customer), esc(lot.label), lot.quantity, lotStatus[lot.status] || lot.status,
        esc(item.workOwner) || "未割当", ownerInfo, pauseInfo, advance + revert + button("ロットを選択", "choose", item.id)];
    }));
    return form + table(["注文", "注文者", "分割", "部数", "ロット進捗", "担当", "担当履歴", "中断記録", "操作"], lotRows);
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

  // 入力欄を作り直さず一覧だけ差し替える（入力中のフォーカスを保つため）
  view.addEventListener("input", event => {
    const { name, value } = event.target;
    if (name === "orderNo") orderNoFilter = value;
    else if (name === "customerQuery") customerFilter = value;
    else return;
    document.querySelector("#orderList").innerHTML = ordersListHtml();
    document.querySelector("#orderCount").textContent = orderCountText();
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
        rush: data.get("speed") === "rush", due: data.get("due"), delivery: data.get("delivery"), address: data.get("address").trim(),
        returnSurplus: data.get("paper") === "brought" && data.get("returnSurplus") === "on"
      };
      if (!fields.customer || (fields.delivery === "ship" && !fields.address)) {
        notice.textContent = "注文者と、配送の場合は配送先を入力してください。";
        return;
      }
      if (order?.status === "received") {
        Object.assign(order, fields);
        shop.ensureLots(order);
      } else {
        const newOrder = { ...fields, id: state.nextId++, status: "received", proofFile: "", revision: 0, note: "", workOwner: "", quoteSnapshot: null };
        shop.ensureLots(newOrder);
        state.orders.push(newOrder);
      }
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
      order.machine = data.get("machine");
    }
    if (type === "work" && order) {
      const owner = data.get("owner").trim();
      if (!owner) { notice.textContent = "担当者を入力してください。"; return; }
      const previousOwner = order.workOwner;
      order.workOwner = owner;
      if (previousOwner !== owner) {
        for (const lot of order.lots || []) {
          if (lot.status === "printing") {
            lot.printOwner = owner;
            lot.ownerHistory.push({ stage: "印刷", owner, recordedAt: new Date().toISOString() });
          } else if (lot.status === "finishing" || lot.statusBeforePause === "finishing") {
            lot.finishingOwner = owner;
            lot.ownerHistory.push({ stage: "加工", owner, recordedAt: new Date().toISOString() });
          }
        }
      }
      if (event.submitter?.name === "addLot") {
        const quantity = Number(data.get("additionalQuantity"));
        if (!Number.isInteger(quantity) || quantity < 1) { notice.textContent = "追加部数を1以上で入力してください。"; return; }
        shop.ensureLots(order);
        const lotId = Math.max(...order.lots.map(lot => lot.id)) + 1;
        order.lots.push({ id: lotId, label: `追加分${lotId - 1}`, quantity, status: "waiting", pauseReason: "", resumeAt: "", pauseHistory: [], printOwner: "", finishingOwner: "", ownerHistory: [] });
        order.quantity = order.lots.reduce((sum, lot) => sum + Number(lot.quantity), 0);
      }
      const lotId = Number(data.get("pauseLot"));
      const lot = order.lots.find(item => item.id === lotId);
      if (event.submitter?.name === "pauseLot" && lot) {
        const reason = data.get("pauseReason").trim();
        const resumeAt = data.get("resumeAt");
        if (!reason || !resumeAt) { notice.textContent = "中断理由と再開予定を入力してください。"; return; }
        lot.statusBeforePause = lot.status;
        lot.status = "paused";
        lot.pauseReason = reason;
        lot.resumeAt = resumeAt;
        lot.pauseStartedAt = new Date().toISOString();
      }
      if (event.submitter?.name === "resumeLot" && lot) {
        if (lot.status !== "paused") { notice.textContent = "中断中のロットを選択してください。"; return; }
        lot.pauseHistory.push({
          reason: lot.pauseReason,
          resumeAt: lot.resumeAt,
          pausedAt: lot.pauseStartedAt,
          resumedAt: new Date().toISOString()
        });
        lot.status = lot.statusBeforePause || "ready";
        lot.statusBeforePause = "";
        lot.pauseReason = "";
        lot.resumeAt = "";
        lot.pauseStartedAt = "";
      }
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
    const orderId = action === "advanceLot" ? Number(id.split(":")[0]) : Number(id);
    const order = state.orders.find(item => item.id === orderId);
    if (!order) return;
    switch (action) {
      case "quote": page = "quotes"; selection = order.id; render(); view.focus(); return;
      case "edit":
      case "choose": selection = order.id; render(); view.querySelector("form input")?.focus(); return;
      case "clear": selection = null; render(); view.focus(); return;
      case "saveTrial":
        if (order.status !== "received") return;
        order.quoteHistory = [...(order.quoteHistory ?? []), {
          at: new Date().toISOString(), product: order.product, quantity: order.quantity, double: order.double,
          paper: order.paper, finish: order.finish, rush: order.rush, pricing: shop.quote(order, state.rates)
        }];
        break;
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
        order.status = { ready: "printing", printing: "finishing", finishing: "inspected" }[order.status];
        break;
      case "advanceLot": {
        const [orderId, lotId] = id.split(":").map(Number);
        const selectedOrder = state.orders.find(item => item.id === orderId);
        const lot = selectedOrder?.lots?.find(item => item.id === lotId);
        if (!lot) return;
        const previousStatus = lot.status;
        lot.status = { waiting: "ready", ready: "printing", printing: "finishing", finishing: "inspected" }[lot.status] || lot.status;
        if (previousStatus === "ready" && lot.status === "printing") {
          lot.printOwner = selectedOrder.workOwner;
          if (lot.printOwner) lot.ownerHistory.push({ stage: "印刷", owner: lot.printOwner, recordedAt: new Date().toISOString() });
        }
        if (previousStatus === "printing" && lot.status === "finishing") {
          lot.finishingOwner = selectedOrder.workOwner;
          if (lot.finishingOwner) lot.ownerHistory.push({ stage: "加工", owner: lot.finishingOwner, recordedAt: new Date().toISOString() });
        }
        if (lot.status === "inspected") selectedOrder.status = "inspected";
        break;
      }
      case "revertLot": {
        const [orderId, lotId] = id.split(":").map(Number);
        const selectedOrder = state.orders.find(item => item.id === orderId);
        const lot = selectedOrder?.lots?.find(item => item.id === lotId);
        if (!lot || selectedOrder.status === "delivered") return;
        lot.status = "finishing";
        selectedOrder.status = "finishing";
        break;
      }
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