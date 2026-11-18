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
  let statusFilter = "";
  let groupFilter = "";
  let draft = null;   // 過去注文の仕様を引き継いだ新規受付（#4）
  let estimate = null; // 注文を登録しない概算の結果（#5）
  let newestFirst = false; // 新しい注文から表示する試験表示（#28）。既定は従来の順（古い順）
  let formDirty = false;   // 注文フォームに入力途中の変更があるか（#30）

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Array.isArray(saved.orders) && saved.rates && Number.isInteger(saved.nextId)) {
        // 旧データに無い設定項目を既定値で補う
        saved.proofFees = { ...shop.defaultProofFees(), ...(saved.proofFees ?? {}) };
        saved.quoteValidDays ??= shop.defaultQuoteValidDays;
        return saved;
      }
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

  // 配送のときだけ表示する入力欄（店頭受取では非表示）
  function shipField(label, name, value, visible, attributes = "") {
    return `<label class="ship-only" ${visible ? "" : "hidden"}>${label}<input name="${name}" type="text" value="${esc(value)}" ${attributes}></label>`;
  }

  function textarea(label, name, value, attributes = "") {
    return `<label class="wide">${label}<textarea name="${name}" ${attributes}>${esc(value)}</textarea></label>`;
  }

  // 名前・番号の照合用：全角/半角・全角スペース/半角スペース・大小の違いを無視する
  function normalizeName(value) {
    return String(value ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  }

  function dueText(order) {
    return order.due || "未定（仮受付）";
  }

  // 同じ注文者の、この注文より前に登録された注文のうち直近のものの納期
  function previousDue(order) {
    const key = normalizeName(order.customer);
    const prev = state.orders.filter(item => item.id < order.id && normalizeName(item.customer) === key)
      .sort((a, b) => b.id - a.id)[0];
    return prev ? `${esc(dueText(prev))}（注文 ${prev.id}）` : "-";
  }

  // 加工の候補：その商品の過去の注文で多く使われた加工を先頭に並べる（同数なら既定の順）
  function finishOptions(product, selected) {
    const used = key => state.orders.filter(item => item.product === product && item.finish === key).length;
    return Object.keys(shop.finish)
      .map((key, index) => ({ key, index, count: used(key) }))
      .sort((a, b) => b.count - a.count || a.index - b.index)
      .map(({ key }) => `<option value="${key}" ${key === selected ? "selected" : ""}>${esc(shop.finish[key].name)}</option>`).join("");
  }

  const dateText = iso => String(iso).replaceAll("-", "/");

  // 今日から days 日後の日付（YYYY-MM-DD、端末のローカル日付）
  function datePlusDays(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  }

  function customerTypeLabel(order) {
    return shop.customerTypes[order.customerType] ?? "未設定";
  }

  function fullAddress(order) {
    return [order.address, order.building].filter(Boolean).join(" ");
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

  function filtersActive() {
    return Boolean(normalizeOrderNo(orderNoFilter) || normalizeName(customerFilter) || statusFilter || normalizeName(groupFilter));
  }

  // 注文番号・状態・相談番号は完全一致、注文者名は部分一致（空白・全半角の違いは無視）。
  // 複数入力した場合は、すべてに一致する注文だけを表示する
  function filteredOrders() {
    const no = normalizeOrderNo(orderNoFilter);
    const name = normalizeName(customerFilter);
    const group = normalizeName(groupFilter);
    return state.orders.filter(item =>
      (!no || String(item.id) === no) && (!name || normalizeName(item.customer).includes(name)) &&
      (!statusFilter || item.status === statusFilter) && (!group || normalizeName(item.group) === group));
  }

  function ordersListHtml() {
    const found = filteredOrders();
    const rows = newestFirst ? found.slice().sort((a, b) => b.id - a.id) : found; // 既定は従来の順
    const empty = filtersActive() && !rows.length ? "<p>条件に一致する注文はありません。</p>" : "";
    return empty || table(["注文", "注文者", "区分", "受付経路", "相談番号", "商品", "サイズ", "部数", "状態", "納期", "同じ注文者の前回納期", "備考", "操作"], rows.map(item => {
      const [id, customer, product, ...rest] = orderCells(item);
      return [
        id, customer, esc(customerTypeLabel(item)), esc(shop.channels[item.channel] ?? "未設定"),
        item.group ? button(esc(item.group), "filterGroup", item.id) : "-", product, esc(item.size ?? "未設定"),
        ...rest, esc(dueText(item)), previousDue(item),
        item.remarks ? `<span class="memo">${esc(item.remarks)}</span>` : "-",
        (item.status === "received" ? button("編集", "edit", item.id) : "") + button("見積へ", "quote", item.id) +
          button("複製して受付", "duplicate", item.id)
      ];
    }));
  }

  // 件数と合計部数（絞り込み中は、その結果の合計）
  function orderCountText() {
    const rows = filteredOrders();
    const total = rows.reduce((sum, item) => sum + Number(item.quantity), 0);
    const count = filtersActive() ? `${rows.length} 件を表示中（全 ${state.orders.length} 件）` : `全 ${state.orders.length} 件`;
    return `${count} ・ 合計 ${new Intl.NumberFormat("ja-JP").format(total)} 部`;
  }

  function renderOrders() {
    const order = state.orders.find(item => item.id === selection);
    // 初期値：編集中は注文の値、複製中は引き継いだ仕様。注文者・納期・納品方法は引き継がず毎回入力する
    const base = order ?? draft;
    const isShip = order?.delivery === "ship";
    const title = order ? `注文 ${order.id} を編集` : draft ? `新規注文（注文 ${draft.from} の仕様を引き継ぎ）` : "新規注文";
    const customerTypeSelect = `<label>注文者区分<select name="customerType" required><option value="">選択してください</option>${
      Object.entries(shop.customerTypes).map(([key, name]) =>
        `<option value="${key}" ${key === order?.customerType ? "selected" : ""}>${esc(name)}</option>`).join("")
    }</select></label>`;
    const channelSelect = `<label>受付経路<select name="channel" required><option value="">選択してください</option>${
      Object.entries(shop.channels).map(([key, name]) =>
        `<option value="${key}" ${key === order?.channel ? "selected" : ""}>${esc(name)}</option>`).join("")
    }</select></label>`;
    const sizeSelect = `<label>サイズ<select name="size" required><option value="">選択してください</option>${
      Object.entries(shop.sizes).map(([key, name]) =>
        `<option value="${key}" ${key === base?.size ? "selected" : ""}>${esc(name)}</option>`).join("")
    }</select></label>`;
    const finishSelect = `<label>加工<select name="finish">${
      finishOptions(base?.product ?? Object.keys(shop.products)[0], base?.finish)}</select></label>`;
    const customerNames = [...new Set(state.orders.map(item => item.customer))].sort((a, b) => a.localeCompare(b, "ja"));
    const tentative = Boolean(order?.tentative);
    const statusOptions = `<option value="">すべての状態</option>${Object.entries(shop.status).map(([key, name]) =>
      `<option value="${key}" ${key === statusFilter ? "selected" : ""}>${esc(name)}</option>`).join("")}`;
    return `<form class="panel" data-form="order"><h2>${title}</h2>${
      draft && !order ? "<p>注文者・区分・希望納期・納品方法は引き継いでいません。内容を確認して入力してください。</p>" : ""
    }<div class="grid">
      ${field("注文者", "customer", order?.customer, "text", 'required maxlength=100 list="customerList" autocomplete="off"')}
      ${customerTypeSelect}
      ${channelSelect}
      ${field("相談番号（同じ相談の注文には同じ番号）", "group", order?.group, "text", "maxlength=30")}
      ${field("連絡先（電話番号）", "phone", order?.phone, "tel", 'maxlength=20 inputmode="tel" autocomplete="off" placeholder="例：03-1234-5678"')}
      ${select("商品", "product", shop.products, base?.product)}
      ${sizeSelect}
      ${field("部数", "quantity", base?.quantity ?? 100, "number", "required min=1 max=100000 step=1")}
      ${select("用紙", "paper", shop.paper, base?.paper)}
      <label><input type="checkbox" name="returnSurplus" ${base?.returnSurplus ? "checked" : ""}>余剰を納品時に返却する</label>
      ${select("印刷面", "sides", { single: "片面", double: "両面" }, base?.double ? "double" : "single")}
      ${finishSelect}
      <label><input type="checkbox" name="proofRequired" ${base?.proofRequired ? "checked" : ""}>校正見本あり（校正料金の対象）</label>
      ${select("納期区分", "speed", { standard: "通常", rush: "特急" }, order?.rush ? "rush" : "standard")}
      ${field("希望納期", "due", order?.due, "date", tentative ? "disabled" : "required")}
      <label><input type="checkbox" name="dueTbd" ${tentative ? "checked" : ""}>納期未定（仮受付）</label>
      ${select("納品方法", "delivery", shop.delivery, order?.delivery)}
      ${shipField("送り先の担当者名", "recipient", order?.recipient, isShip, "maxlength=50")}
      ${shipField("配送先住所（番地まで）", "address", order?.address, isShip, "maxlength=200")}
      ${shipField("建物名・部屋番号", "building", order?.building, isShip, "maxlength=100")}
      ${textarea("備考（例：午前中は連絡不可）", "remarks", order?.remarks, "maxlength=500")}
      </div><div class="actions"><button>注文を保存</button>${order ? button("編集を閉じる", "clear", order.id) : ""}${
        draft && !order ? button("複製をやめる", "clear", draft.from) : ""}</div></form>
      <div class="panel" role="search"><div class="grid">
        <label>注文番号で絞り込み
          <input name="orderNo" type="search" inputmode="numeric" autocomplete="off" placeholder="例：103" value="${esc(orderNoFilter)}"></label>
        <label>注文者名で検索（一部でも可）
          <input name="customerQuery" type="search" autocomplete="off" placeholder="例：書店" value="${esc(customerFilter)}"></label>
        <label>状態で絞り込み<select name="statusQuery">${statusOptions}</select></label>
        <label>相談番号で絞り込み
          <input name="groupQuery" type="search" autocomplete="off" value="${esc(groupFilter)}"></label>
        <label><input type="checkbox" name="newestFirst" ${newestFirst ? "checked" : ""}>新しい注文から表示（試験）</label></div>
        <p id="orderCount" aria-live="polite">${orderCountText()}</p></div>
      <div id="orderList">${ordersListHtml()}</div>
      <datalist id="customerList">${customerNames.map(name => `<option value="${esc(name)}"></option>`).join("")}</datalist>`;
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

  const numberText = value => new Intl.NumberFormat("ja-JP").format(value);

  // 印刷代の行ラベル：片面単価が基準であることと、部数・両面の倍率を併記する
  function printingLabel(pricing, spec) {
    const quantity = pricing.quantity ?? spec?.quantity;
    const sides = pricing.sides ?? (spec?.double ? 2 : 1);
    const unit = pricing.unit ?? (quantity ? pricing.printing / (quantity * sides) : null);
    if (unit == null || !quantity) return "印刷代";
    return `印刷代（片面単価 ${numberText(unit)} 円 × ${numberText(quantity)} 部${sides === 2 ? " × 両面 2" : ""}）`;
  }

  function breakdownTable(pricing, spec) {
    return table(["項目", "金額"], [
      [printingLabel(pricing, spec), money(pricing.printing)], ["用紙代", money(pricing.paperCost)],
      ["加工費", money(pricing.finishing)], ["特急料金", money(pricing.rush)], ["校正料金", money(pricing.proofFee ?? 0)],
      ["数量割引", money(pricing.discount ? -pricing.discount : 0)]
    ]);
  }

  // 部数違いの見積を横に並べる
  function comparisonTable(a, b) {
    const row = (label, pick) => [label, money(pick(a.pricing)), money(pick(b.pricing))];
    return table(["項目", `${numberText(a.quantity)} 部`, `${numberText(b.quantity)} 部`], [
      row("印刷代", p => p.printing), row("用紙代", p => p.paperCost), row("加工費", p => p.finishing),
      row("特急料金", p => p.rush), row("校正料金", p => p.proofFee ?? 0),
      row("数量割引", p => (p.discount ? -p.discount : 0)), row("合計", p => p.total)
    ]);
  }

  // 注文を登録せずに金額だけ計算する（電話での価格問い合わせ用）。比較部数を入れると2つの見積を並べる
  function estimatePanel() {
    const input = estimate?.input;
    const compare = estimate?.compare;
    const body = !estimate ? "" : compare
      ? `${comparisonTable({ quantity: input.quantity, pricing: estimate.pricing }, compare)}
        <p class="summary">概算合計 ${numberText(input.quantity)} 部：${money(estimate.pricing.total)} ／ ${numberText(compare.quantity)} 部：${money(compare.pricing.total)}</p>`
      : `${breakdownTable(estimate.pricing, input)}<p class="summary">概算合計 ${money(estimate.pricing.total)}</p>`;
    const result = estimate ? `<section class="panel" id="estimateResult" tabindex="-1" aria-live="polite">
      <h2>概算結果（注文未登録・確定前）</h2><p>${esc(conditionText(input))}</p>${body}
      <p>この金額は概算で、注文には登録されていません。</p></section>` : "";
    return `<form class="panel" data-form="estimate"><h2>概算を出す（注文を登録しません）</h2>
      <p>条件を入れて計算するだけで、注文は作られません。比較する部数を入れると、2つの見積を並べて表示します。</p><div class="grid">
      ${select("商品", "product", shop.products, input?.product)}
      ${field("部数", "quantity", input?.quantity ?? 100, "number", "required min=1 max=100000 step=1")}
      ${field("比較する部数（任意）", "compareQuantity", compare?.quantity ?? "", "number", "min=1 max=100000 step=1")}
      ${select("用紙", "paper", shop.paper, input?.paper)}
      ${select("印刷面", "sides", { single: "片面", double: "両面" }, input?.double ? "double" : "single")}
      <label>加工<select name="finish">${finishOptions(input?.product ?? Object.keys(shop.products)[0], input?.finish)}</select></label>
      ${select("納期区分", "speed", { standard: "通常", rush: "特急" }, input?.rush ? "rush" : "standard")}
      </div><div class="actions"><button>概算を計算</button></div></form>` + result;
  }

  function renderQuotes() {
    const order = state.orders.find(item => item.id === selection);
    const pricing = order ? order.quoteSnapshot ?? shop.quote(order, state.rates, state.proofFees) : null;
    let sheet = "";
    if (order) {
      const draftQuote = order.status === "received";
      const confirmedStamp = draftQuote ? "" : order.quoteConfirmedAt
        ? `<span class="stamp">確定時刻 ${esc(new Date(order.quoteConfirmedAt).toLocaleString("ja-JP"))}</span>`
        : '<span class="stamp">確定時刻の記録なし</span>';
      const actions = !draftQuote ? ""
        : order.tentative ? button("試算を履歴に保存", "saveTrial", order.id) +
          "<p>希望納期が未定（仮受付）のため、見積はまだ確定できません。注文を編集して納期を確定してください。</p>"
        : button("試算を履歴に保存", "saveTrial", order.id) + button("見積を確定", "confirmQuote", order.id);
      sheet = `<section class="panel quote-sheet"><h2>注文 ${order.id} ・ ${esc(order.customer)}</h2>
        <p class="quote-state ${draftQuote ? "unconfirmed" : "confirmed"}">${
          draftQuote ? "【未確定】この見積は確定前の試算です。金額は変わることがあります。" : "確定済みの見積を表示しています。"}</p>
        <p class="quote-meta">部数 <strong>${numberText(order.quantity)} 部</strong> ・ 希望納期 <strong>${esc(dueText(order))}</strong> ・ サイズ ${esc(order.size ?? "未設定")}</p>
        ${breakdownTable(pricing, order)}
        <p class="summary">合計 ${money(pricing.total)} ${confirmedStamp}</p>${
          order.quoteExpiresAt ? `<p>見積の有効期限：${esc(dateText(order.quoteExpiresAt))}</p>` : ""}
        <div class="actions no-print">${button("この見積を印刷", "printQuote", order.id)}${actions}</div></section>
        <section class="panel"><h2>確定前の試算履歴</h2>
        <p>試算した時点の条件と金額です。確定済みの見積とは別に保存しているため、確定額には影響しません。</p>${trialHistory(order)}</section>`;
    }
    return estimatePanel() + sheet + table(["注文", "注文者", "商品", "部数", "状態", "操作"], state.orders.map(item =>
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
      const pauseInfo = lot.status === "paused"
        ? `理由: ${esc(lot.pauseReason) || "未記入"}<br>再開予定: ${esc(lot.resumeAt) || "未設定"}`
        : (lot.pauseHistory?.length ? `直近の中断: ${esc(lot.pauseHistory.at(-1).reason)}` : "-");
      return [item.id, esc(item.customer), esc(lot.label), lot.quantity, lotStatus[lot.status] || lot.status,
        esc(item.workOwner) || "未割当", pauseInfo, advance + button("ロットを選択", "choose", item.id)];
    }));
    return form + table(["注文", "注文者", "分割", "部数", "ロット進捗", "担当", "中断記録", "操作"], lotRows);
  }

  function renderDelivery() {
    const candidates = state.orders.filter(order => ["inspected", "delivered"].includes(order.status));
    return table(["注文", "注文者", "商品", "部数", "状態", "納品方法", "持ち込み用紙", "余剰用紙", "希望納期", "送り先の担当者", "配送先", "連絡先", "備考", "操作"], candidates.map(item => [
      ...orderCells(item), shop.delivery[item.delivery], item.paper === "brought" ? "あり" : "なし",
      item.paper === "brought" ? (item.returnSurplus ? "返却する" : "返却しない") : "-",
      esc(dueText(item)), esc(item.recipient), esc(fullAddress(item)), esc(item.phone),
      item.remarks ? `<span class="memo">${esc(item.remarks)}</span>` : "-",
      item.status === "inspected" ? button("納品完了", "deliver", item.id) : ""
    ]));
  }

  function renderRates() {
    return `<form class="panel" data-form="rates"><h2>商品別の印刷単価</h2>
      <p>片面1部あたりの単価です。確定済みの見積には確定時点の金額を表示します。</p>
      <div class="grid">${Object.entries(shop.products).map(([key, product]) =>
        field(product.name + "（円）", key, state.rates[key], "number", "required min=0 max=100000 step=1")).join("")}</div>
      <h3>校正料金（校正見本ありの注文に、見積で別項目として加算）</h3>
      <p>対象商品と単価が決まるまでは 0 円のままにしてください。</p>
      <div class="grid">${Object.entries(shop.products).map(([key, product]) =>
        field(product.name + " 校正（円）", "proof_" + key, state.proofFees[key] ?? 0, "number", "required min=0 max=100000 step=1")).join("")}</div>
      <h3>見積の有効期限</h3>
      <div class="grid">${field("確定日からの有効日数", "quoteValidDays", state.quoteValidDays, "number", "required min=1 max=365 step=1")}</div>
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
    formDirty = false;
  }

  nav.addEventListener("click", event => {
    const next = event.target.closest("button")?.dataset.page;
    if (!(next in views)) return;
    page = next;
    selection = null;
    draft = null;
    estimate = null;
    notice.textContent = "";
    render();
    nav.querySelector('[aria-current="page"]').focus();
  });

  // 入力欄を作り直さず一覧だけ差し替える（入力中のフォーカスを保つため）
  view.addEventListener("input", event => {
    const { name, value } = event.target;
    if (event.target.form?.dataset.form === "order") formDirty = true; // 入力途中の変更を検知（#30）
    if (name === "newestFirst") newestFirst = event.target.checked;
    else if (name === "orderNo") orderNoFilter = value;
    else if (name === "customerQuery") customerFilter = value;
    else if (name === "statusQuery") statusFilter = value;
    else if (name === "groupQuery") groupFilter = value;
    else return;
    document.querySelector("#orderList").innerHTML = ordersListHtml();
    document.querySelector("#orderCount").textContent = orderCountText();
  });

  // 納品方法が「配送」のときだけ、送り先・住所の入力欄を表示する
  view.addEventListener("change", event => {
    const form = event.target.form;
    if (form?.dataset.form === "order") formDirty = true;
    if (event.target.name === "product" && form?.querySelector('[name="finish"]')) {
      // 商品を選んだら、その商品でよく使う加工を候補の先頭に並べ替える（選択中の加工は維持）
      const finishField = form.querySelector('[name="finish"]');
      finishField.innerHTML = finishOptions(event.target.value, finishField.value);
      return;
    }
    if (event.target.name === "dueTbd") {
      // 納期未定（仮受付）のときは希望納期を入力不要にする
      const due = event.target.form.querySelector('[name="due"]');
      due.disabled = event.target.checked;
      due.required = !event.target.checked;
      if (event.target.checked) due.value = "";
      return;
    }
    if (event.target.name !== "delivery") return;
    const ship = event.target.value === "ship";
    view.querySelectorAll(".ship-only").forEach(label => { label.hidden = !ship; });
  });

  view.addEventListener("submit", event => {
    event.preventDefault();
    const data = new FormData(event.target);
    const type = event.target.dataset.form;
    const order = state.orders.find(item => item.id === selection);
    let message = "保存しました。";
    if (type === "estimate") {
      const input = {
        product: data.get("product"), quantity: Number(data.get("quantity")), paper: data.get("paper"),
        double: data.get("sides") === "double", finish: data.get("finish"), rush: data.get("speed") === "rush"
      };
      if (!(input.product in shop.products) || !(input.paper in shop.paper) || !(input.finish in shop.finish)
        || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 100000) {
        notice.textContent = "概算の条件（部数は1〜100000の整数）を確認してください。";
        return;
      }
      const compareText = String(data.get("compareQuantity") ?? "").trim();
      const compareQuantity = compareText === "" ? null : Number(compareText);
      if (compareQuantity !== null && (!Number.isInteger(compareQuantity) || compareQuantity < 1 || compareQuantity > 100000)) {
        notice.textContent = "比較する部数は1〜100000の整数で入力してください。";
        return;
      }
      // 注文にも保存データにも書き込まない
      estimate = {
        input, pricing: shop.quote(input, state.rates, state.proofFees),
        compare: compareQuantity === null ? null
          : { quantity: compareQuantity, pricing: shop.quote({ ...input, quantity: compareQuantity }, state.rates, state.proofFees) }
      };
      render();
      notice.textContent = "概算を計算しました。注文は登録していません。";
      view.querySelector("#estimateResult")?.focus();
      return;
    }
    if (type === "order") {
      const ship = data.get("delivery") === "ship";
      const tentative = data.get("dueTbd") === "on";
      const fields = {
        customer: data.get("customer").trim(), customerType: data.get("customerType"), phone: shop.normalizePhone(data.get("phone")),
        channel: data.get("channel"), group: data.get("group").trim(), remarks: data.get("remarks").trim(),
        product: data.get("product"), quantity: Number(data.get("quantity")),
        paper: data.get("paper"), double: data.get("sides") === "double", finish: data.get("finish"),
        rush: data.get("speed") === "rush", tentative, due: tentative ? "" : (data.get("due") ?? ""), delivery: data.get("delivery"),
        recipient: ship ? data.get("recipient").trim() : "", address: ship ? data.get("address").trim() : "",
        building: ship ? data.get("building").trim() : "",
        returnSurplus: data.get("paper") === "brought" && data.get("returnSurplus") === "on",
        size: data.get("size"), proofRequired: data.get("proofRequired") === "on"
      };
      const problem = !fields.customer ? "注文者を入力してください。"
        : !(fields.customerType in shop.customerTypes) ? "注文者区分（法人／個人）を選択してください。"
        : !(fields.channel in shop.channels) ? "受付経路（電話・店頭・メール）を選択してください。"
        : !(fields.size in shop.sizes) ? "サイズ（A4／A5）を選択してください。"
        : !fields.tentative && !fields.due ? "希望納期を入力するか、「納期未定（仮受付）」にチェックしてください。"
        : ship && !fields.address ? "配送の場合は配送先住所（番地まで）を入力してください。"
        : !shop.isValidPhone(fields.phone) ? "電話番号は数字10〜11桁（ハイフン可）で入力してください。" : "";
      if (problem) {
        notice.textContent = problem;
        return;
      }
      draft = null;
      orderNoFilter = customerFilter = statusFilter = groupFilter = ""; // 保存した注文が絞り込みで隠れないようにする
      if (order?.status === "received") {
        Object.assign(order, fields);
        message = `注文 ${order.id} を更新しました。${fields.tentative ? "（納期未定の仮受付）" : ""}`;
      } else {
        const id = state.nextId++;
        state.orders.push({ ...fields, id, status: "received", proofFile: "", revision: 0, note: "", workOwner: "", quoteSnapshot: null, quoteHistory: [] });
        message = `注文を登録しました。注文番号は ${id} です。${fields.tentative ? "（納期未定の仮受付）" : ""}`;
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
      order.workOwner = owner;
      if (event.submitter?.name === "addLot") {
        const quantity = Number(data.get("additionalQuantity"));
        if (!Number.isInteger(quantity) || quantity < 1) { notice.textContent = "追加部数を1以上で入力してください。"; return; }
        shop.ensureLots(order);
        const lotId = Math.max(...order.lots.map(lot => lot.id)) + 1;
        order.lots.push({ id: lotId, label: `追加分${lotId - 1}`, quantity, status: "waiting", pauseReason: "", resumeAt: "", pauseHistory: [] });
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
      const days = Number(data.get("quoteValidDays"));
      if (!Number.isInteger(days) || days < 1 || days > 365) { notice.textContent = "見積の有効日数は1〜365の整数で入力してください。"; return; }
      for (const product of Object.keys(shop.products)) {
        state.rates[product] = Number(data.get(product));
        state.proofFees[product] = Number(data.get("proof_" + product));
      }
      state.quoteValidDays = days;
    }
    selection = null;
    update(message);
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
      case "choose": selection = order.id; draft = null; render(); view.querySelector("form input")?.focus(); return;
      case "clear":
        // 入力途中の変更があるときだけ確認する（変更がなければそのまま閉じる）
        if (formDirty && !window.confirm("入力中の内容は保存されていません。破棄して閉じますか？")) return;
        selection = null; draft = null; render(); view.focus(); return;
      case "duplicate":
        // 商品・部数・用紙・印刷面・加工だけを引き継ぐ。注文者・納期などは毎回確認して入力する
        draft = {
          from: order.id, product: order.product, quantity: order.quantity, paper: order.paper,
          double: order.double, finish: order.finish, returnSurplus: order.returnSurplus,
          size: order.size, proofRequired: order.proofRequired
        };
        page = "orders"; selection = null;
        render();
        notice.textContent = `注文 ${order.id} の仕様を引き継ぎました。注文者と希望納期を確認して入力してください。`;
        view.querySelector('[name="customer"]')?.focus();
        return;
      case "saveTrial":
        if (order.status !== "received") return;
        order.quoteHistory = [...(order.quoteHistory ?? []), {
          at: new Date().toISOString(), product: order.product, quantity: order.quantity, double: order.double,
          paper: order.paper, finish: order.finish, rush: order.rush, proofRequired: order.proofRequired,
          pricing: shop.quote(order, state.rates, state.proofFees)
        }];
        break;
      case "filterGroup": {
        // 同じ相談番号の注文をまとめて表示する
        groupFilter = order.group; orderNoFilter = customerFilter = statusFilter = "";
        page = "orders"; selection = null;
        render();
        notice.textContent = `相談番号「${order.group}」の注文を表示しています。`;
        return;
      }
      case "confirmQuote":
        if (order.tentative || !order.due) {
          notice.textContent = "希望納期が未定（仮受付）のため、見積を確定できません。注文を編集して納期を確定してください。";
          return;
        }
        order.quoteSnapshot = shop.quote(order, state.rates, state.proofFees);
        order.quoteConfirmedAt = new Date().toISOString();                        // 確定時刻（#31）
        order.quoteExpiresAt = datePlusDays(state.quoteValidDays);                // 有効期限：確定日から既定14日（#25）
        order.status = "quoted";
        break;
      case "printQuote": {
        // 見積の紙面だけを印刷する。印刷用スタイルはこのボタンを押したときだけ有効にし、他の画面の印刷は変えない
        document.body.classList.add("print-quote");
        window.addEventListener("afterprint", () => document.body.classList.remove("print-quote"), { once: true });
        window.print();
        return;
      }
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
        lot.status = { waiting: "ready", ready: "printing", printing: "finishing", finishing: "inspected" }[lot.status] || lot.status;
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
    draft = null;
    estimate = null;
    update("サンプルに戻しました。");
  });

  render();
})();