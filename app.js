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
  let showZeroItems = state.showZeroItems === true;
  let bulkRateValidation = null;
  let bulkRateText = "";
  const roleSelect = document.querySelector("#role");
  let currentRole = ["staff", "pricing", "admin"].includes(state.currentRole) ? state.currentRole : "staff";
  const canChangeRates = () => currentRole === "pricing" || currentRole === "admin";

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

  function renderOrders() {
    const order = state.orders.find(item => item.id === selection);
    return `<form class="panel" data-form="order"><h2>${order ? `注文 ${order.id} を編集` : "新規注文"}</h2><div class="grid">
      ${field("注文者", "customer", order?.customer, "text", "required maxlength=100")}
      ${select("商品", "product", shop.products, order?.product)}
      ${field("部数", "quantity", order?.quantity ?? 100, "number", "required min=1 max=100000 step=1")}
      ${select("用紙", "paper", shop.paper, order?.paper)}
      ${select("印刷面", "sides", { single: "片面", double: "両面" }, order?.double ? "double" : "single")}
      ${select("加工", "finish", shop.finish, order?.finish)}
      ${select("納期区分", "speed", { standard: "通常", rush: "特急" }, order?.rush ? "rush" : "standard")}
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
    const blocks = !order ? "" : `<section class="panel quote-document"><div class="quote-heading"><div><h2>見積書</h2><p class="quote-order-number">注文番号：<strong>${order.id}</strong></p></div><p>注文者：${esc(order.customer)}</p></div>${
      `<label class="zero-items-toggle"><input type="checkbox" data-setting="showZeroItems" ${showZeroItems ? "checked" : ""}>0円の項目を表示</label>` +
      table(["項目", "金額"], [
        ["印刷代", pricing.printing], ["用紙代", pricing.paperCost],
        ["加工費", pricing.finishing], ["特急料金", pricing.rush],
        ["数量割引", pricing.discount ? -pricing.discount : 0]
      ].filter(([, amount]) => showZeroItems || amount !== 0).map(([label, amount]) => [label, money(amount)]))
    }<p class="summary">合計 ${money(pricing.total)}</p>${
      order.status === "received" ? button("見積を確定", "confirmQuote", order.id) : "<p>確定済みの見積を表示しています。</p>"
    }<div class="actions quote-actions">${button("見積書を印刷", "printQuote", order.id)}</div></section>`;
    return blocks + `<div class="quote-list">` + table(["注文", "注文者", "商品", "部数", "状態", "操作"], state.orders.map(item =>
      [...orderCells(item), button("見積を見る", "quote", item.id)]
    )) + `</div>`;
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
    const nextLabel = { ready: "印刷を開始", printing: "加工へ進む", finishing: "検品完了" };
    const order = candidates.find(item => item.id === selection);
    const form = order ? `<form class="panel" data-form="owner"><h2>注文 ${order.id} の製造担当</h2><div class="grid">
      ${field("担当者", "owner", order.workOwner, "text", "required maxlength=50")}</div>
      <div class="actions"><button>担当を保存</button></div></form>` : "";
    return form + table(["注文", "注文者", "商品", "部数", "状態", "希望納期", "担当", "操作"], candidates.map(item => [
      ...orderCells(item), esc(item.due), esc(item.workOwner) || "未割当", button("担当を設定", "choose", item.id) +
      (nextLabel[item.status] ? button(nextLabel[item.status], "advance", item.id) : "")
    ]));
  }

  function renderDelivery() {
    const candidates = state.orders.filter(order => ["inspected", "delivered"].includes(order.status));
    return table(["注文", "注文者", "商品", "部数", "状態", "納品方法", "希望納期", "配送先", "操作"], candidates.map(item => [
      ...orderCells(item), shop.delivery[item.delivery], esc(item.due), esc(item.address),
      item.status === "inspected" ? button("納品完了", "deliver", item.id) : ""
    ]));
  }

  function renderRates() {
    if (!canChangeRates()) {
      return `<section class="panel"><h2>商品別の印刷単価</h2><p>この画面は料金担当または管理者だけが変更できます。</p><p>料金設定に関する相談先：<strong>経理部</strong></p></section>`
        + table(["用紙", "1部あたり"], Object.values(shop.paper).map(item => [esc(item.name), money(item.unit)]))
        + table(["加工", "1注文あたり"], Object.values(shop.finish).map(item => [esc(item.name), money(item.fee)]));
    }
    const preview = bulkRateValidation ? renderBulkRateValidation(bulkRateValidation) : "";
    return `<form class="panel" data-form="rates"><h2>商品別の印刷単価</h2>
      <p>片面1部あたりの単価です。確定済みの見積には確定時点の金額を表示します。</p>
      <p>料金設定に関する相談先：<strong>経理部</strong></p>
      <div class="grid">${Object.entries(shop.products).map(([key, product]) =>
        field(product.name + "（円）", key, state.rates[key], "number", "required min=0 max=100000 step=1")).join("")}</div>
      <div class="actions"><button>単価を保存</button></div></form>`
      + `<section class="panel"><h2>仕入先価格表の一括登録</h2>
        <p>商品名または商品キーと金額を、カンマ、タブ、またはスペースで区切って1行ずつ入力してください。例：チラシ,12</p>
        <label>価格表<textarea id="bulk-rates" rows="7" placeholder="チラシ,12&#10;ポスター,150&#10;カード,18">${esc(bulkRateText)}</textarea></label>
        <div class="actions">${button("検証結果を表示", "validateBulkRates", "")}${button("検証済みを登録", "applyBulkRates", "")}</div>
        ${preview}</section>`
      + table(["用紙", "1部あたり"], Object.values(shop.paper).map(item => [esc(item.name), money(item.unit)]))
      + table(["加工", "1注文あたり"], Object.values(shop.finish).map(item => [esc(item.name), money(item.fee)]));
  }

  function splitBulkRateLine(line) {
    const normalized = line.trim();
    const separator = normalized.match(/,|、|\t|\s+/);
    if (!separator) return [normalized, ""];
    const index = separator.index;
    return [normalized.slice(0, index).trim(), normalized.slice(index + separator[0].length).trim()];
  }

  function validateBulkRates(text) {
    const rows = [];
    const seen = new Set();
    text.split(/\r?\n/).forEach((line, index) => {
      const source = line.trim();
      if (!source) return;
      if (/^(商品(名|キー)?|商品名\s*[,、\t\s]+金額|商品,?単価)$/i.test(source)) return;
      const [name, rawAmount] = splitBulkRateLine(source);
      const amountText = rawAmount.replace(/[,\s円￥]/g, "").replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
      const product = Object.entries(shop.products).find(([key, item]) => key === name || item.name === name);
      const errors = [];
      if (!product) errors.push("商品名または商品キーが不正です");
      if (!/^\d+$/.test(amountText)) errors.push("金額は整数で入力してください");
      const amount = Number(amountText);
      if (/^\d+$/.test(amountText) && (amount < 0 || amount > 100000)) errors.push("金額は0～100000円の範囲で入力してください");
      if (product && seen.has(product[0])) errors.push("商品が重複しています");
      if (product) seen.add(product[0]);
      rows.push({ line: index + 1, name, amount: /^\d+$/.test(amountText) ? amount : null, key: product?.[0] ?? "", valid: errors.length === 0, errors });
    });
    return { rows, validCount: rows.filter(row => row.valid).length, invalidCount: rows.filter(row => !row.valid).length };
  }

  function renderBulkRateValidation(result) {
    if (!result.rows.length) return `<p class="validation-summary">検証対象の行がありません。商品名と金額を入力してください。</p>`;
    const status = result.invalidCount === 0
      ? `<p class="validation-success">検証OK：${result.validCount}件は登録できます。</p>`
      : `<p class="validation-error">検証エラー：${result.invalidCount}件があります。エラーのない場合のみ登録できます。</p>`;
    const rows = result.rows.map(row =>
      `<tr><td>${row.line}</td><td>${esc(row.name)}</td><td>${row.valid ? money(row.amount) : "-"}</td><td>${row.valid ? "OK" : esc(row.errors.join("／"))}</td></tr>`
    );
    return status + table(["行", "商品", "金額", "検証結果"], rows);
  }

  const renderers = { orders: renderOrders, quotes: renderQuotes, proof: renderProof, work: renderWork, delivery: renderDelivery, rates: renderRates };
  function render() {
    if (page === "rates" && !canChangeRates()) page = "orders";
    nav.innerHTML = Object.entries(views)
      .filter(([key]) => key !== "rates" || canChangeRates())
      .map(([key, name]) =>
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

  view.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.target);
    const type = event.target.dataset.form;
    const order = state.orders.find(item => item.id === selection);
    if (type === "order") {
      const fields = {
        customer: data.get("customer").trim(), product: data.get("product"), quantity: Number(data.get("quantity")),
        paper: data.get("paper"), double: data.get("sides") === "double", finish: data.get("finish"),
        rush: data.get("speed") === "rush", due: data.get("due"), delivery: data.get("delivery"), address: data.get("address").trim()
      };
      if (!fields.customer || (fields.delivery === "ship" && !fields.address)) {
        notice.textContent = "注文者と、配送の場合は配送先を入力してください。";
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
      if (!canChangeRates()) {
        notice.textContent = "料金担当または管理者だけが単価を変更できます。";
        return;
      }
      for (const product of Object.keys(shop.products)) state.rates[product] = Number(data.get(product));
    }
    selection = null;
    update("保存しました。");
  });

  view.addEventListener("change", event => {
    const setting = event.target.closest("input[data-setting]");
    if (!setting) return;
    showZeroItems = setting.checked;
    state.showZeroItems = showZeroItems;
    update(showZeroItems ? "0円の項目を表示します。" : "0円の項目を非表示にしました。");
  });

  view.addEventListener("input", event => {
    if (event.target.id === "bulk-rates") bulkRateText = event.target.value;
  });

  view.addEventListener("click", event => {
    const control = event.target.closest("button[data-action]");
    if (!control) return;
    const { action, id } = control.dataset;
    if (action === "validateBulkRates") {
      if (!canChangeRates()) return;
      bulkRateText = document.querySelector("#bulk-rates")?.value ?? "";
      bulkRateValidation = validateBulkRates(bulkRateText);
      render();
      notice.textContent = "価格表を検証しました。登録前に検証結果を確認してください。";
      return;
    }
    if (action === "applyBulkRates") {
      if (!canChangeRates()) {
        notice.textContent = "料金担当または管理者だけが単価を変更できます。";
        return;
      }
      const currentText = document.querySelector("#bulk-rates")?.value ?? "";
      bulkRateText = currentText;
      const currentValidation = validateBulkRates(currentText);
      bulkRateValidation = currentValidation;
      if (!bulkRateValidation.rows.length) {
        notice.textContent = "先に検証結果を表示してください。";
        render();
        return;
      }
      if (bulkRateValidation.invalidCount > 0 || bulkRateValidation.validCount === 0) {
        notice.textContent = "検証エラーがあります。修正して再度検証してください。";
        render();
        return;
      }
      bulkRateValidation.rows.forEach(row => { state.rates[row.key] = row.amount; });
      bulkRateValidation = null;
      bulkRateText = "";
      update("検証済みの価格表を登録しました。");
      return;
    }
    const order = state.orders.find(item => item.id === Number(id));
    if (!order) return;
    switch (action) {
      case "quote": page = "quotes"; selection = order.id; render(); view.focus(); return;
      case "printQuote": window.print(); return;
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
    state.currentRole = currentRole;
    showZeroItems = false;
    state.showZeroItems = false;
    bulkRateValidation = null;
    bulkRateText = "";
    selection = null;
    update("サンプルに戻しました。");
  });

  roleSelect.value = currentRole;
  roleSelect.addEventListener("change", () => {
    currentRole = roleSelect.value;
    state.currentRole = currentRole;
    selection = null;
    update("操作ロールを変更しました。");
  });

  render();
})();
