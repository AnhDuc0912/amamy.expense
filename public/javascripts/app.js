let state = {
    options: { branches: [], routes: [], categories: [], people: [] },
    expenses: [],
    summary: null
};
let selectedFiles = [];
let optionsInitialized = false;
let appliedFilters = {
    branch: "",
    route: "",
    category: "",
    person: "",
    dateFrom: "",
    dateTo: "",
    query: ""
};

const $ = id => document.getElementById(id);
const fmt = n => (Number(n) || 0).toLocaleString("vi-VN") + " đ";
const valNum = v => Number(String(v || "").replace(/[^0-9]/g, "")) || 0;
const escapeHtml = value => String(value == null ? "" : value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function getCurrentMonth() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

async function request(url, options) {
    const response = await fetch(url, options);
    if (response.status === 204) return null;

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Không thể kết nối máy chủ");
    return payload;
}

function optionize(el, items, first) {
    el.innerHTML = (first ? `<option value="">${escapeHtml(first)}</option>` : "") +
        items.map(item => `<option>${escapeHtml(item)}</option>`).join("");
}

async function loadData() {
    const payload = await request(`/api/bootstrap?month=${getCurrentMonth()}`);
    state = payload;
    if (!optionsInitialized) {
        populateOptions();
        optionsInitialized = true;
    }
    $("budgetHN").value = state.summary.budget.HN || "";
    $("budgetHCM").value = state.summary.budget.HCM || "";
    render();
}

function populateOptions() {
    optionize($("route"), state.options.routes, "-- Chọn chiều vận chuyển --");
    optionize($("category"), state.options.categories, "-- Chọn danh mục --");
    optionize($("spentBy"), state.options.people, "-- Chọn người chi --");
    optionize($("filterRoute"), state.options.routes, "Tất cả chiều");
    optionize($("filterCategory"), state.options.categories, "Tất cả danh mục");
    optionize($("filterPerson"), state.options.people, "Tất cả người chi");
}

async function init() {
    $("date").valueAsDate = new Date();
    ["filterDateFrom", "filterDateTo"].forEach(id => $(id).addEventListener("input", syncDateFilters));
    $("applyFilters").onclick = applyExpenseFilters;
    $("clearFilters").onclick = clearExpenseFilters;
    $("search").addEventListener("keydown", event => {
        if (event.key === "Enter") applyExpenseFilters();
    });
    $("saveBudgetBtn").onclick = saveBudget;
    $("expenseForm").onsubmit = addExpense;
    $("expenseForm").onreset = () => setTimeout(() => {
        selectedFiles = [];
        $("date").valueAsDate = new Date();
        renderPreview();
    }, 0);
    $("exportBtn").onclick = () => {
        window.location.href = "/api/expenses.csv";
    };
    $("expenseRows").addEventListener("click", handleTableClick);
    setupUpload();

    try {
        await loadData();
    } catch (error) {
        alert(error.message);
    }
}

async function saveBudget() {
    const password = prompt("Nhập mật khẩu điều chỉnh ngân sách");
    if (password === null) return;

    const button = $("saveBudgetBtn");
    button.disabled = true;
    try {
        await request(`/api/budgets/${getCurrentMonth()}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                HN: valNum($("budgetHN").value),
                HCM: valNum($("budgetHCM").value),
                password
            })
        });
        await loadData();
        alert("Đã lưu quỹ");
    } catch (error) {
        alert(error.message);
    } finally {
        button.disabled = false;
    }
}

function setupUpload() {
    const dropZone = $("dropZone");
    const input = $("receipts");
    dropZone.onclick = () => input.click();
    input.onchange = event => addFiles([...event.target.files]);
    ["dragenter", "dragover"].forEach(name => dropZone.addEventListener(name, event => {
        event.preventDefault();
        dropZone.classList.add("drag");
    }));
    ["dragleave", "drop"].forEach(name => dropZone.addEventListener(name, event => {
        event.preventDefault();
        dropZone.classList.remove("drag");
    }));
    dropZone.addEventListener("drop", event => addFiles([...event.dataTransfer.files]));
}

function addFiles(files) {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    const validFiles = files.filter(file => allowedTypes.includes(file.type) && file.size <= 5 * 1024 * 1024);

    if (validFiles.length !== files.length) {
        alert("Chỉ nhận ảnh JPG, PNG, GIF, WEBP hoặc PDF, tối đa 5 MB mỗi file.");
    }
    selectedFiles = [...selectedFiles, ...validFiles].slice(0, 2);
    renderPreview();
}

function renderPreview() {
    const preview = $("preview");
    preview.innerHTML = "";
    selectedFiles.forEach((file, index) => {
        const item = document.createElement("div");
        item.className = "thumb";
        if (file.type.startsWith("image/")) {
            const image = document.createElement("img");
            image.src = URL.createObjectURL(file);
            image.onload = () => URL.revokeObjectURL(image.src);
            item.appendChild(image);
        } else {
            item.insertAdjacentHTML("beforeend", "<div>PDF</div>");
        }
        item.insertAdjacentHTML(
            "beforeend",
            `<span>${escapeHtml(file.name)}<br><small>${(file.size / 1024 / 1024).toFixed(1)} MB</small></span>`
        );
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.textContent = "×";
        removeButton.onclick = event => {
            event.stopPropagation();
            selectedFiles.splice(index, 1);
            renderPreview();
        };
        item.appendChild(removeButton);
        preview.appendChild(item);
    });
}

function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, type: file.type, data: reader.result });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function addExpense(event) {
    event.preventDefault();
    if (!$("route").value || !$("category").value || !$("spentBy").value) {
        return alert("Vui lòng chọn đủ chiều, danh mục và người chi");
    }

    const submitButton = event.submitter;
    if (submitButton) submitButton.disabled = true;
    try {
        const receipts = await Promise.all(selectedFiles.map(fileToDataURL));
        await request("/api/expenses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                branch: $("branch").value,
                route: $("route").value,
                category: $("category").value,
                spentBy: $("spentBy").value,
                amount: valNum($("amount").value),
                date: $("date").value,
                note: $("note").value.trim(),
                receipts
            })
        });
        event.target.reset();
        selectedFiles = [];
        renderPreview();
        await loadData();
    } catch (error) {
        alert(error.message);
    } finally {
        if (submitButton) submitButton.disabled = false;
    }
}

function filteredExpenses() {
    const { branch, route, category, person, dateFrom, dateTo, query } = appliedFilters;
    return state.expenses.filter(expense =>
        (!branch || expense.branch === branch) &&
        (!route || expense.route === route) &&
        (!category || expense.category === category) &&
        (!person || expense.spentBy === person) &&
        (!dateFrom || expense.date >= dateFrom) &&
        (!dateTo || expense.date <= dateTo) &&
        (!query || (expense.note || "").toLocaleLowerCase("vi").includes(query))
    );
}

function syncDateFilters() {
    const dateFrom = $("filterDateFrom");
    const dateTo = $("filterDateTo");
    dateTo.min = dateFrom.value;
    dateFrom.max = dateTo.value;
}

async function applyExpenseFilters() {
    const button = $("applyFilters");
    if (button.disabled) return;

    setButtonLoading(button, true, "Đang lọc...");
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 250)));

    appliedFilters = {
        branch: $("filterBranch").value,
        route: $("filterRoute").value,
        category: $("filterCategory").value,
        person: $("filterPerson").value,
        dateFrom: $("filterDateFrom").value,
        dateTo: $("filterDateTo").value,
        query: $("search").value.trim().toLocaleLowerCase("vi")
    };
    renderTable();
    setButtonLoading(button, false);
}

function setButtonLoading(button, loading, loadingText) {
    if (loading) {
        button.dataset.label = button.textContent;
        button.disabled = true;
        button.classList.add("isLoading");
        button.innerHTML = `<span class="buttonSpinner" aria-hidden="true"></span>${loadingText}`;
        return;
    }

    button.disabled = false;
    button.classList.remove("isLoading");
    button.textContent = button.dataset.label || "Áp dụng";
}

function clearExpenseFilters() {
    ["filterBranch", "filterRoute", "filterCategory", "filterPerson", "filterDateFrom", "filterDateTo", "search"]
        .forEach(id => {
            $(id).value = "";
        });
    $("filterDateFrom").removeAttribute("max");
    $("filterDateTo").removeAttribute("min");
    appliedFilters = {
        branch: "",
        route: "",
        category: "",
        person: "",
        dateFrom: "",
        dateTo: "",
        query: ""
    };
    renderTable();
}

function render() {
    const summary = state.summary;
    $("hnBalance").textContent = fmt(summary.balance.HN);
    $("hcmBalance").textContent = fmt(summary.balance.HCM);
    $("sideHn").textContent = fmt(summary.balance.HN);
    $("sideHcm").textContent = fmt(summary.balance.HCM);
    $("hnSpent").textContent = "Đã chi: " + fmt(summary.spent.HN);
    $("hcmSpent").textContent = "Đã chi: " + fmt(summary.spent.HCM);
    $("monthSpent").textContent = fmt(summary.totalSpent);
    $("totalBudget").textContent = "Ngân sách: " + fmt(summary.totalBudget);
    $("missingImages").textContent = summary.missingReceipts;
    renderTable();
    renderReports();
}

function renderTable() {
    const rows = $("expenseRows");
    const expenses = filteredExpenses();
    $("expenseCount").textContent = `${expenses.length} khoản chi`;
    if (!expenses.length) {
        rows.innerHTML = '<tr><td colspan="9">Chưa có khoản chi</td></tr>';
        return;
    }

    rows.innerHTML = expenses.map(expense => {
        const receipts = (expense.receipts || []).map((receipt, index) =>
            `<a class="receiptLink" href="${escapeHtml(receipt.url)}" target="_blank" rel="noopener">` +
            `${receipt.type.startsWith("image/") ? "Ảnh" : "PDF"} ${index + 1}</a>`
        ).join("");
        return `<tr>
            <td>${escapeHtml(expense.date)}</td>
            <td><span class="badge">${escapeHtml(expense.branch)}</span></td>
            <td>${escapeHtml(expense.route)}</td>
            <td>${escapeHtml(expense.category)}</td>
            <td>${escapeHtml(expense.spentBy)}</td>
            <td class="money">${fmt(expense.amount)}</td>
            <td>${escapeHtml(expense.note)}</td>
            <td><div class="imgBtns">${receipts || "-"}</div></td>
            <td><button class="delete" data-delete-id="${escapeHtml(expense.id)}">Xóa</button></td>
        </tr>`;
    }).join("");
}

async function handleTableClick(event) {
    const button = event.target.closest("[data-delete-id]");
    if (!button || !confirm("Xóa khoản chi này?")) return;

    button.disabled = true;
    try {
        await request(`/api/expenses/${encodeURIComponent(button.dataset.deleteId)}`, { method: "DELETE" });
        await loadData();
    } catch (error) {
        button.disabled = false;
        alert(error.message);
    }
}

function renderReports() {
    makeReport("routeReport", state.summary.reports.route);
    makeReport("categoryReport", state.summary.reports.category);
    makeReport("personReport", state.summary.reports.person);
}

function makeReport(id, report) {
    const entries = Object.entries(report).sort((a, b) => b[1] - a[1]);
    $(id).innerHTML = entries.length
        ? entries.map(([name, value]) =>
            `<div class="reportRow"><span>${escapeHtml(name)}</span><b>${fmt(value)}</b></div>`
        ).join("")
        : "<p class='hint'>Chưa có dữ liệu tháng này</p>";
}

init();
