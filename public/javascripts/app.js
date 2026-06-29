let state = {
    options: { branches: [], routes: [], categories: [], people: [] },
    expenses: [],
    auditLogs: [],
    summary: null
};
let selectedFiles = [];
let optionsInitialized = false;
let receiptUpdateExpenseId = null;
let receiptUpdateButton = null;
let datePickers = {};
let appliedFilters = {
    month: getCurrentMonth(),
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
    const payload = await request(`/api/bootstrap?${filterQueryString()}`);
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
    optionize($("branch"), state.options.branches, "");
    optionize($("route"), state.options.routes, "-- Chọn chiều vận chuyển --");
    optionize($("category"), state.options.categories, "-- Chọn danh mục --");
    optionize($("spentBy"), state.options.people, "-- Chọn người chi --");
    optionize($("filterBranch"), state.options.branches, "Tất cả chi nhánh");
    optionize($("filterRoute"), state.options.routes, "Tất cả chiều");
    optionize($("filterCategory"), state.options.categories, "Tất cả danh mục");
    optionize($("filterPerson"), state.options.people, "Tất cả người chi");
}

async function init() {
    $("date").valueAsDate = new Date();
    $("filterMonth").value = appliedFilters.month;
    setupDatePickers();
    if (!datePickers.month) $("filterMonth").addEventListener("change", applyMonthFilter);
    ["filterDateFrom", "filterDateTo"].forEach(id => $(id).addEventListener("input", syncDateFilters));
    ["filterBranch", "filterRoute", "filterCategory", "filterPerson"]
        .forEach(id => $(id).addEventListener("change", applyExpenseFilters));
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
        window.location.href = `/api/expenses.csv?${filterQueryString()}`;
    };
    $("expenseRows").addEventListener("click", handleTableClick);
    $("receiptUpdateInput").addEventListener("change", uploadAdditionalReceipts);
    setupUpload();

    try {
        await loadData();
    } catch (error) {
        alert(error.message);
    }
}

function filterQueryString() {
    const params = new URLSearchParams();
    params.set("month", appliedFilters.month || getCurrentMonth());
    if (appliedFilters.dateFrom) params.set("dateFrom", appliedFilters.dateFrom);
    if (appliedFilters.dateTo) params.set("dateTo", appliedFilters.dateTo);
    return params.toString();
}

function setupDatePickers() {
    if (typeof flatpickr !== "function") return;

    const locale = flatpickr.l10ns && flatpickr.l10ns.vn ? flatpickr.l10ns.vn : "default";
    const commonDateOptions = {
        altInput: true,
        altFormat: "d/m/Y",
        dateFormat: "Y-m-d",
        allowInput: true,
        locale,
        disableMobile: true
    };

    if (typeof monthSelectPlugin === "function") {
        datePickers.month = flatpickr($("filterMonth"), {
            altInput: true,
            altFormat: "F Y",
            dateFormat: "Y-m",
            defaultDate: appliedFilters.month,
            locale,
            disableMobile: true,
            plugins: [
                new monthSelectPlugin({
                    shorthand: false,
                    dateFormat: "Y-m",
                    altFormat: "F Y"
                })
            ],
            onChange: function(selectedDates, value) {
                if (!value || value === appliedFilters.month) return;
                appliedFilters.month = value;
                applyMonthFilter();
            }
        });
    }

    datePickers.from = flatpickr($("filterDateFrom"), {
        ...commonDateOptions,
        onChange: function() {
            syncDateFilters();
        }
    });
    datePickers.to = flatpickr($("filterDateTo"), {
        ...commonDateOptions,
        onChange: function() {
            syncDateFilters();
        }
    });
}

async function saveBudget() {
    const password = prompt("Nhập mật khẩu điều chỉnh ngân sách");
    if (password === null) return;

    const button = $("saveBudgetBtn");
    button.disabled = true;
    try {
        await request(`/api/budgets/${encodeURIComponent(appliedFilters.month || getCurrentMonth())}`, {
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
    if (!$("branch").value || !$("route").value || !$("category").value || !$("spentBy").value) {
        return alert("Vui lòng chọn đủ chi nhánh, chiều, danh mục và người chi");
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
    const { month, branch, route, category, person, dateFrom, dateTo, query } = appliedFilters;
    const hasDateRange = dateFrom || dateTo;
    return state.expenses.filter(expense =>
        (hasDateRange || !month || expense.date.slice(0, 7) === month) &&
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
    if (datePickers.from) datePickers.from.set("maxDate", dateTo.value || null);
    if (datePickers.to) datePickers.to.set("minDate", dateFrom.value || null);
}

async function applyExpenseFilters() {
    const button = $("applyFilters");
    if (button.disabled) return;

    setButtonLoading(button, true, "Đang lọc...");
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 250)));

    appliedFilters = {
        month: $("filterMonth").value || getCurrentMonth(),
        branch: $("filterBranch").value,
        route: $("filterRoute").value,
        category: $("filterCategory").value,
        person: $("filterPerson").value,
        dateFrom: $("filterDateFrom").value,
        dateTo: $("filterDateTo").value,
        query: $("search").value.trim().toLocaleLowerCase("vi")
    };
    try {
        await loadData();
    } catch (error) {
        alert(error.message);
    } finally {
        setButtonLoading(button, false);
    }
}

async function applyMonthFilter() {
    appliedFilters.month = $("filterMonth").value || getCurrentMonth();
    clearSecondaryFilters();
    try {
        await loadData();
    } catch (error) {
        alert(error.message);
    }
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
    $("filterMonth").value = getCurrentMonth();
    if (datePickers.month) datePickers.month.setDate(getCurrentMonth(), false, "Y-m");
    appliedFilters.month = getCurrentMonth();
    clearSecondaryFilters();
    loadData().catch(error => alert(error.message));
}

function clearSecondaryFilters() {
    ["filterBranch", "filterRoute", "filterCategory", "filterPerson", "filterDateFrom", "filterDateTo", "search"]
        .forEach(id => {
            $(id).value = "";
        });
    $("filterDateFrom").removeAttribute("max");
    $("filterDateTo").removeAttribute("min");
    if (datePickers.from) datePickers.from.clear();
    if (datePickers.to) datePickers.to.clear();
    appliedFilters = {
        month: appliedFilters.month || getCurrentMonth(),
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
    const companySpent = summary.spent["Công ty chi trả"] || 0;
    $("hnBalance").textContent = fmt(summary.balance.HN);
    $("hcmBalance").textContent = fmt(summary.balance.HCM);
    $("sideHn").textContent = fmt(summary.balance.HN);
    $("sideHcm").textContent = fmt(summary.balance.HCM);
    $("sideCompany").textContent = fmt(companySpent);
    $("hnSpent").textContent = "Đã chi: " + fmt(summary.spent.HN);
    $("hcmSpent").textContent = "Đã chi: " + fmt(summary.spent.HCM);
    $("companySpent").textContent = fmt(companySpent);
    $("monthSpent").textContent = fmt(summary.totalSpent);
    $("totalBudget").textContent = "Ngân sách: " + fmt(summary.totalBudget);
    $("missingImages").textContent = summary.missingReceipts;
    renderTable();
    renderAuditLogs();
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
            `<span class="receiptItem">` +
            `<a class="receiptLink" href="${escapeHtml(receipt.url)}" target="_blank" rel="noopener">` +
            `${receipt.type.startsWith("image/") ? "Ảnh" : "PDF"} ${index + 1}</a>` +
            `<button type="button" class="removeReceipt" title="Xóa chứng từ" aria-label="Xóa chứng từ" ` +
            `data-delete-receipt-id="${escapeHtml(receipt.id)}" ` +
            `data-expense-id="${escapeHtml(expense.id)}">×</button></span>`
        ).join("");
        const canAddReceipt = (expense.receipts || []).length < 2;
        const addReceiptButton = canAddReceipt
            ? `<button type="button" class="addReceipt" data-add-receipt-id="${escapeHtml(expense.id)}">` +
              `${receipts ? "Thêm chứng từ" : "Bổ sung chứng từ"}</button>`
            : "";
        return `<tr>
            <td>${escapeHtml(expense.date)}</td>
            <td><span class="badge">${escapeHtml(expense.branch)}</span></td>
            <td>${escapeHtml(expense.route)}</td>
            <td>${escapeHtml(expense.category)}</td>
            <td>${escapeHtml(expense.spentBy)}</td>
            <td class="money">${fmt(expense.amount)}
                <button type="button" class="editAmount" data-edit-amount-id="${escapeHtml(expense.id)}">
                    Sửa tiền
                </button>
            </td>
            <td>${escapeHtml(expense.note)}</td>
            <td><div class="imgBtns">${receipts}${addReceiptButton}</div></td>
            <td><button class="delete" data-delete-id="${escapeHtml(expense.id)}">Xóa</button></td>
        </tr>`;
    }).join("");
}

async function handleTableClick(event) {
    const editAmountButton = event.target.closest("[data-edit-amount-id]");
    if (editAmountButton) {
        await editExpenseAmount(editAmountButton);
        return;
    }

    const removeReceiptButton = event.target.closest("[data-delete-receipt-id]");
    if (removeReceiptButton) {
        await removeReceipt(removeReceiptButton);
        return;
    }

    const addReceiptButton = event.target.closest("[data-add-receipt-id]");
    if (addReceiptButton) {
        receiptUpdateExpenseId = addReceiptButton.dataset.addReceiptId;
        receiptUpdateButton = addReceiptButton;
        const input = $("receiptUpdateInput");
        input.value = "";
        input.click();
        return;
    }

    const button = event.target.closest("[data-delete-id]");
    if (!button || !confirm("Xóa khoản chi này?")) return;

    const credentials = askOperatorCredentials("xóa");
    if (!credentials) return;

    button.disabled = true;
    try {
        await request(`/api/expenses/${encodeURIComponent(button.dataset.deleteId)}`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credentials)
        });
        await loadData();
    } catch (error) {
        button.disabled = false;
        alert(error.message);
    }
}

function askOperatorCredentials(action) {
    const actor = prompt(`Nhập tên người ${action}`);
    if (actor === null) return null;

    const cleanActor = actor.trim();
    if (!cleanActor) {
        alert("Vui lòng nhập người thao tác");
        return null;
    }

    const password = prompt("Nhập mật khẩu");
    if (password === null) return null;

    return { actor: cleanActor, password };
}

async function editExpenseAmount(button) {
    const expense = state.expenses.find(item => item.id === button.dataset.editAmountId);
    if (!expense) return alert("Không tìm thấy khoản chi");

    const rawAmount = prompt("Nhập số tiền mới", String(expense.amount));
    if (rawAmount === null) return;

    const amount = valNum(rawAmount);
    if (!amount) return alert("Số tiền phải lớn hơn 0");
    if (amount === Number(expense.amount)) return;

    const credentials = askOperatorCredentials("chỉnh sửa");
    if (!credentials) return;

    setButtonLoading(button, true, "Đang lưu...");
    try {
        await request(`/api/expenses/${encodeURIComponent(expense.id)}/amount`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...credentials, amount })
        });
        await loadData();
    } catch (error) {
        setButtonLoading(button, false);
        alert(error.message);
    }
}

async function removeReceipt(button) {
    if (!confirm("Xóa chứng từ này?")) return;

    const expenseId = button.dataset.expenseId;
    const receiptId = button.dataset.deleteReceiptId;
    setButtonLoading(button, true, "");
    try {
        await request(
            `/api/expenses/${encodeURIComponent(expenseId)}/receipts/${encodeURIComponent(receiptId)}`,
            { method: "DELETE" }
        );
        await loadData();
    } catch (error) {
        setButtonLoading(button, false);
        alert(error.message);
    }
}

async function uploadAdditionalReceipts(event) {
    const files = [...event.target.files];
    if (!files.length || !receiptUpdateExpenseId) return;

    const allowedTypes = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf"];
    const validFiles = files.filter(file => allowedTypes.includes(file.type) && file.size <= 5 * 1024 * 1024);
    if (validFiles.length !== files.length) {
        alert("Chỉ nhận ảnh JPG, PNG, GIF, WEBP hoặc PDF, tối đa 5 MB mỗi file.");
        return;
    }

    const expense = state.expenses.find(item => item.id === receiptUpdateExpenseId);
    const availableSlots = 2 - ((expense && expense.receipts) || []).length;
    if (validFiles.length > availableSlots) {
        alert(`Khoản chi này chỉ còn có thể thêm ${availableSlots} chứng từ.`);
        return;
    }

    const button = receiptUpdateButton;
    setButtonLoading(button, true, "Đang tải...");
    try {
        const receipts = await Promise.all(validFiles.map(fileToDataURL));
        await request(`/api/expenses/${encodeURIComponent(receiptUpdateExpenseId)}/receipts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ receipts })
        });
        await loadData();
    } catch (error) {
        setButtonLoading(button, false);
        alert(error.message);
    } finally {
        receiptUpdateExpenseId = null;
        receiptUpdateButton = null;
        event.target.value = "";
    }
}

function renderReports() {
    makeReport("branchReport", state.summary.reports.branch);
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

function renderAuditLogs() {
    const rows = $("auditRows");
    const logs = state.auditLogs || [];
    if (!logs.length) {
        rows.innerHTML = '<tr><td colspan="5">Chưa có lịch sử thao tác</td></tr>';
        return;
    }

    rows.innerHTML = logs.map(log => {
        const before = log.before || {};
        const after = log.after || {};
        const action = log.action === "delete_expense" ? "Xóa khoản chi" : "Sửa số tiền";
        const expenseLabel = [
            before.date || after.date,
            before.branch || after.branch,
            before.route || after.route,
            before.category || after.category
        ].filter(Boolean).join(" · ");
        const change = log.action === "update_amount"
            ? `${fmt(before.amount)} → ${fmt(after.amount)}`
            : fmt(before.amount);

        return `<tr>
            <td>${escapeHtml(formatDateTime(log.createdAt))}</td>
            <td>${escapeHtml(log.actor)}</td>
            <td>${escapeHtml(action)}</td>
            <td>${escapeHtml(expenseLabel || log.expenseId)}</td>
            <td class="money">${escapeHtml(change)}</td>
        </tr>`;
    }).join("");
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "";
    return date.toLocaleString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
    });
}

init();
