(function() {
    'use strict';

    const DB_NAME = 'TableViewerDB';
    const DB_VERSION = 2;
    const STORE_NAME = 'tables';

    let db = null;
    let currentTableId = null;
    let sortField = null;
    let sortDirection = 'asc';
    let touchStartX = 0;
    let touchStartY = 0;
    let editingRowData = null;
    let longPressTimer = null;
    let isLongPress = false;

    const STATUS = {
        WHITE: 'white',
        GREEN: 'green',
        RED: 'red',
        YELLOW: 'yellow'
    };

    const REQUIRED_FIELDS = ['index', 'productName', 'barcode', 'quantity', 'price'];

    let isSwiping = false;

    document.addEventListener('DOMContentLoaded', async () => {
        await initDB();
        initEventListeners();
        renderTableList();
    });

    async function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                db = request.result;
                resolve();
            };

            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                if (!database.objectStoreNames.contains(STORE_NAME)) {
                    const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                    store.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
        });
    }

    async function getAllTables() {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function saveTable(table) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(table);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function deleteTable(id) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);

            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    function initEventListeners() {
        const backBtn = document.getElementById('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', showTableList);
        }

        const cancelEdit = document.getElementById('cancelEdit');
        if (cancelEdit) {
            cancelEdit.addEventListener('click', closeEditModal);
        }

        const confirmEditBtn = document.getElementById('confirmEdit');
        if (confirmEditBtn) {
            confirmEditBtn.addEventListener('click', confirmEdit);
        }

        const editActualQuantity = document.getElementById('editActualQuantity');
        if (editActualQuantity) {
            editActualQuantity.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') confirmEdit();
            });
        }

        const toggleViewBtn = document.getElementById('toggleViewBtn');
        if (toggleViewBtn) {
            toggleViewBtn.addEventListener('click', toggleTableView);
        }

        const importBtn = document.getElementById('importBtn');
        if (importBtn) {
            importBtn.addEventListener('click', () => {
                document.getElementById('importModal').classList.remove('hidden');
                document.getElementById('importText').focus();
            });
        }

        const cancelImport = document.getElementById('cancelImport');
        if (cancelImport) {
            cancelImport.addEventListener('click', () => {
                document.getElementById('importModal').classList.add('hidden');
                document.getElementById('importText').value = '';
            });
        }

        const confirmImport = document.getElementById('confirmImport');
        if (confirmImport) {
            confirmImport.addEventListener('click', handleTextImport);
        }
    }

    let isDateViewMode = false;

    function toggleTableView() {
        isDateViewMode = !isDateViewMode;
        
        const toggleFields = document.querySelectorAll('.toggle-field');
        const dateFields = document.querySelectorAll('.date-field');
        
        toggleFields.forEach(field => {
            field.style.display = isDateViewMode ? 'none' : '';
        });
        
        dateFields.forEach(field => {
            field.style.display = isDateViewMode ? '' : 'none';
        });
        
        const btn = document.getElementById('toggleViewBtn');
        btn.textContent = isDateViewMode ? '返回' : '切换';
    }

    async function handleTextImport() {
        const text = document.getElementById('importText').value.trim();
        if (!text) {
            showToast('请输入数据');
            return;
        }

        try {
            const result = parseTextData(text);
            
            if (!result.valid) {
                showToast('数据格式不正确');
                return;
            }

            const table = {
                id: Date.now().toString(),
                name: result.name,
                data: result.data,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await saveTable(table);
            currentTableId = null;

            document.getElementById('importModal').classList.add('hidden');
            document.getElementById('importText').value = '';
            await renderTableList();
            showToast('导入成功');

        } catch (error) {
            console.error('Import error:', error);
            showToast('导入失败: ' + error.message);
        }
    }

    function parseTextData(text) {
        const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l);
        if (lines.length < 3) {
            return { valid: false };
        }

        const tableName = lines[0];
        const headerLine = lines[1];
        const dataLines = lines.slice(2);

        const headers = headerLine.split(/[\t,]+/).map(h => h.trim());
        const normalizedHeaders = headers.map(h => normalizeFieldName(h));

        const required = [...REQUIRED_FIELDS];

        if (!required.every(field => normalizedHeaders.includes(field))) {
            return { valid: false, headers: normalizedHeaders };
        }

        const data = {
            headers: normalizedHeaders,
            originalHeaders: headers,
            rows: [],
            hasActualQuantity: normalizedHeaders.includes('actualQuantity'),
            hasDistributionStatus: normalizedHeaders.includes('distributionStatus')
        };

        for (let i = 0; i < dataLines.length; i++) {
            const values = dataLines[i].split(/[\t,]+/).map(v => v.trim());
            if (values.length === 0 || values.every(v => !v)) continue;

            const row = { id: i + 1 };
            
            for (let j = 0; j < normalizedHeaders.length; j++) {
                const header = normalizedHeaders[j];
                let value = values[j] || '';
                
                if (header === 'quantity' || header === 'price' || header === 'actualQuantity') {
                    value = parseFloat(value) || 0;
                }
                row[header] = value;
            }

            if (!row.actualQuantity && row.actualQuantity !== 0) {
                row.actualQuantity = null;
                row.status = STATUS.WHITE;
            } else {
                row.status = calculateStatus(row.actualQuantity, row.quantity);
            }

            data.rows.push(row);
        }

        return { valid: true, name: tableName, data };
    }

    function parseCSV(content) {
        const lines = content.trim().split(/\r?\n/);
        if (lines.length < 2) return [];

        const headers = parseCSVLine(lines[0]);
        const normalizedHeaders = headers.map(h => normalizeFieldName(h));

        const required = [...REQUIRED_FIELDS];
        const hasActualQuantity = normalizedHeaders.includes('actualQuantity');
        const hasDistributionStatus = normalizedHeaders.includes('distributionStatus');

        if (!required.every(field => normalizedHeaders.includes(field))) {
            return { headers: [], rows: [], valid: false };
        }

        const data = {
            headers: normalizedHeaders,
            originalHeaders: headers,
            rows: [],
            hasActualQuantity,
            hasDistributionStatus
        };

        for (let i = 1; i < lines.length; i++) {
            const values = parseCSVLine(lines[i]);
            if (values.length === 0) continue;

            const row = { id: i };
            normalizedHeaders.forEach((header, index) => {
                let value = values[index] || '';
                if (header === 'quantity' || header === 'price' || header === 'actualQuantity') {
                    value = parseFloat(value) || 0;
                }
                row[header] = value;
            });

            if (!row.actualQuantity && row.actualQuantity !== 0) {
                row.actualQuantity = null;
                row.status = STATUS.WHITE;
            } else {
                row.status = calculateStatus(row.actualQuantity, row.quantity);
            }

            data.rows.push(row);
        }

        return data;
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        result.push(current.trim());
        return result;
    }

    function normalizeFieldName(name) {
        const mapping = {
            '序号': 'index',
            '商品名称': 'productName',
            '四位': 'barcode',
            '条码后四位': 'barcode',
            '量': 'quantity',
            '数量': 'quantity',
            '箱': 'price',
            '价格': 'price',
            '实际数量': 'actualQuantity',
            '生产日期': 'productionDate',
            '日期': 'productionDate',
            '配货情况': 'distributionStatus'
        };

        const normalized = name.toLowerCase().replace(/[\s_]/g, '');
        for (const [key, value] of Object.entries(mapping)) {
            if (key.includes(normalized) || normalized.includes(key.toLowerCase()) || value === normalized) {
                return value;
            }
        }

        return name.toLowerCase().replace(/\s+/g, '');
    }

    function validateCSVData(data) {
        return data.headers && data.headers.length > 0 && data.valid !== false;
    }

    function calculateStatus(actualQuantity, quantity) {
        if (actualQuantity === null || actualQuantity === undefined) {
            return STATUS.WHITE;
        }
        if (actualQuantity === 0) {
            return STATUS.RED;
        }
        if (actualQuantity >= quantity) {
            return STATUS.GREEN;
        }
        return STATUS.YELLOW;
    }

    function showTableList() {
        document.getElementById('tableListView').classList.remove('hidden');
        document.getElementById('tableDetailView').classList.add('hidden');
        renderTableList();
    }

    async function showTableDetail(table) {
        if (!table) {
            const tables = await getAllTables();
            table = tables.find(t => t.id === currentTableId);
        }

        if (!table) {
            showToast('表格不存在');
            return;
        }

        currentTableId = table.id;
        document.getElementById('tableListView').classList.add('hidden');
        document.getElementById('tableDetailView').classList.remove('hidden');
        document.getElementById('currentTableName').textContent = table.name;

        sortField = null;
        sortDirection = 'asc';
        
        isDateViewMode = false;
        const btn = document.getElementById('toggleViewBtn');
        if (btn) {
            btn.textContent = '切换';
        }
        
        const toggleFields = document.querySelectorAll('.toggle-field');
        const dateFields = document.querySelectorAll('.date-field');
        if (toggleFields.length) {
            toggleFields.forEach(field => field.style.display = '');
        }
        if (dateFields.length) {
            dateFields.forEach(field => field.style.display = 'none');
        }

        renderTable(table);
    }

    async function renderTableList() {
        const tables = await getAllTables();
        const container = document.getElementById('tableList');

        if (tables.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #999;">
                    <p>暂无表格</p>
                    <p style="font-size: 0.9rem; margin-top: 10px;">点击右上角按钮新建表格</p>
                </div>
            `;
            return;
        }

        tables.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

        container.innerHTML = tables.map(table => {
            const isCompleted = checkTableCompleted(table);
            const date = new Date(table.updatedAt).toLocaleDateString('zh-CN');

            return `
                <div class="table-item-wrapper" data-id="${table.id}">
                    <div class="table-item ${isCompleted ? 'completed' : ''}">
                        <div class="table-item-info">
                            <div class="table-item-name">${escapeHtml(table.name)}</div>
                            <div class="table-item-date">${date}</div>
                        </div>
                        <div class="table-item-status ${isCompleted ? 'completed' : 'pending'}" title="${isCompleted ? '已完成标记' : '未完成标记'}"></div>
                        <button class="table-item-delete" title="删除">❌</button>
                    </div>
                </div>
            `;
        }).join('');

        setupTableListInteractions();
    }

    function setupTableListInteractions() {
        const container = document.getElementById('tableList');

        async function handleDelete(tableId, event) {
            event.stopPropagation();
            const tables = await getAllTables();
            const table = tables.find(t => t.id === tableId);
            if (table && confirm(`确定要删除表格"${table.name}"吗？`)) {
                await deleteTable(tableId);
                renderTableList();
                showToast('已删除');
            }
        }

        async function handleOpen(tableId) {
            currentTableId = tableId;
            const tables = await getAllTables();
            const table = tables.find(t => t.id === currentTableId);
            showTableDetail(table);
        }

        container.querySelectorAll('.table-item').forEach(item => {
            const wrapper = item.closest('.table-item-wrapper');
            const tableId = wrapper.dataset.id;
            const deleteBtn = item.querySelector('.table-item-delete');

            item.addEventListener('click', () => handleOpen(tableId));

            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => handleDelete(tableId, e));
            }
        });
    }

    function checkTableCompleted(table) {
        if (!table.data || !table.data.rows) return false;
        return table.data.rows.every(row => row.actualQuantity !== null && row.actualQuantity !== undefined);
    }

    function renderTable(table) {
        if (!table.data || !table.data.rows) {
            document.getElementById('tableBody').innerHTML = `
                <tr><td colspan="6" style="text-align: center; padding: 40px; color: #999;">暂无数据</td></tr>
            `;
            document.getElementById('tableRowCount').textContent = '共 0 条数据';
            return;
        }

        const rows = [...table.data.rows];

        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = rows.map(row => `
            <tr class="table-row ${row.status}" data-id="${row.id}" data-quantity="${row.quantity}" data-product="${escapeHtml(row.productName)}" data-price="${row.price.toFixed(1)}" data-date="${row.productionDate || ''}">
                <td data-field="index" class="text-right">${row.index}</td>
                <td data-field="productName" class="text-left">${escapeHtml(row.productName)}</td>
                <td data-field="barcode" class="text-center toggle-field">${row.barcode}</td>
                <td data-field="quantity" class="text-right">${row.quantity}</td>
                <td data-field="price" class="text-center toggle-field">${row.price.toFixed(1)}</td>
                <td data-field="actualQuantity" class="text-right toggle-field">${row.actualQuantity !== null ? row.actualQuantity : '-'}</td>
                <td data-field="productionDate" class="text-center date-field" style="display:none;">${formatDate(row.productionDate)}</td>
            </tr>
        `).join('');

        document.getElementById('tableRowCount').textContent = `共 ${rows.length} 条数据`;

        setupTableInteractions(table);
        setupSortableHeaders();
    }

    function formatDate(dateStr) {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return dateStr;
        const year = date.getFullYear().toString().slice(-2);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function sortRows(a, b) {
        let aVal = a[sortField];
        let bVal = b[sortField];

        const aNum = parseFloat(aVal);
        const bNum = parseFloat(bVal);

        if (!isNaN(aNum) && !isNaN(bNum) && sortField === 'index') {
            aVal = aNum;
            bVal = bNum;
        } else if (typeof aVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = String(bVal).toLowerCase();
        }

        if (sortDirection === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    }

    function setupSortableHeaders() {
        document.querySelectorAll('#dataTable th.sortable').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.field;
                if (field === 'index') {
                    sortField = field;
                    sortDirection = 'asc';
                } else {
                    if (sortField === field) {
                        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                    } else {
                        sortField = field;
                        sortDirection = 'asc';
                    }
                }
                
                if (isDateViewMode) {
                    isDateViewMode = false;
                    const btn = document.getElementById('toggleViewBtn');
                    if (btn) {
                        btn.textContent = '切换';
                    }
                    
                    const toggleFields = document.querySelectorAll('.toggle-field');
                    const dateFields = document.querySelectorAll('.date-field');
                    if (toggleFields.length) {
                        toggleFields.forEach(field => field.style.display = '');
                    }
                    if (dateFields.length) {
                        dateFields.forEach(field => field.style.display = 'none');
                    }
                }
                
                refreshCurrentTable();
            });
        });
    }

    async function setupTableInteractions(table) {
        const tbody = document.getElementById('tableBody');

        let touchStartX = 0;
        let touchCurrentX = 0;
        let activeRow = null;
        let lastTouchTime = 0;
        let lastTouchRowId = null;

        function handleRowMouseDown(e) {
            const row = e.target.closest('tr');
            if (!row) return;

            touchStartX = e.clientX;
            touchCurrentX = e.clientX;
            isSwiping = true;
            activeRow = row;
            row.classList.add('swiping');
        }

        function handleRowMouseMove(e) {
            if (!isSwiping || !activeRow) return;

            touchCurrentX = e.clientX;
            const diffX = touchCurrentX - touchStartX;

            if (Math.abs(diffX) < 60) {
                activeRow.style.transform = `translateX(${diffX}px)`;

                if (diffX < -20) {
                    activeRow.classList.add('swipe-green');
                    activeRow.classList.remove('swipe-red');
                } else if (diffX > 20) {
                    activeRow.classList.add('swipe-red');
                    activeRow.classList.remove('swipe-green');
                } else {
                    activeRow.classList.remove('swipe-green');
                    activeRow.classList.remove('swipe-red');
                }
            }
        }

        async function handleRowMouseUp(e) {
            if (!isSwiping || !activeRow) return;

            const diffX = touchCurrentX - touchStartX;
            const rowId = parseInt(activeRow.dataset.id);
            const quantity = parseInt(activeRow.dataset.quantity);

            activeRow.style.transition = 'transform 0.3s, background-color 0.3s';

            if (Math.abs(diffX) > 40) {
                if (diffX < -40) {
                    activeRow.style.transform = 'translateX(0)';
                    await setRowData(rowId, quantity, undefined, true);
                } else if (diffX > 40) {
                    activeRow.style.transform = 'translateX(0)';
                    await setRowData(rowId, 0, undefined, true);
                }
            } else {
                activeRow.style.transform = 'translateX(0)';
            }

            activeRow.classList.remove('swipe-green');
            activeRow.classList.remove('swipe-red');

            setTimeout(() => {
                if (activeRow) {
                    activeRow.style.transition = '';
                }
            }, 300);

            isSwiping = false;
            activeRow = null;
        }

        function handleRowMouseLeave(e) {
            if (!isSwiping || !activeRow) return;

            activeRow.style.transition = 'transform 0.3s, background-color 0.3s';
            activeRow.style.transform = 'translateX(0)';
            activeRow.classList.remove('swipe-green');
            activeRow.classList.remove('swipe-red');

            setTimeout(() => {
                if (activeRow) {
                    activeRow.style.transition = '';
                }
            }, 300);

            isSwiping = false;
            activeRow = null;
        }

        function handleRowTouchStart(e) {
            const row = e.target.closest('tr');
            if (!row) return;

            touchStartX = e.touches[0].clientX;
            touchCurrentX = e.touches[0].clientX;
            isSwiping = true;
            activeRow = row;
            row.classList.add('swiping');
        }

        function handleRowTouchMove(e) {
            if (!isSwiping || !activeRow) return;

            touchCurrentX = e.touches[0].clientX;
            const diffX = touchCurrentX - touchStartX;

            if (Math.abs(diffX) < 60) {
                activeRow.style.transform = `translateX(${diffX}px)`;

                if (diffX < -20) {
                    activeRow.classList.add('swipe-green');
                    activeRow.classList.remove('swipe-red');
                } else if (diffX > 20) {
                    activeRow.classList.add('swipe-red');
                    activeRow.classList.remove('swipe-green');
                } else {
                    activeRow.classList.remove('swipe-green');
                    activeRow.classList.remove('swipe-red');
                }
            }
        }

        async function handleRowTouchEnd(e) {
            if (!isSwiping || !activeRow) return;

            const diffX = touchCurrentX - touchStartX;
            const rowId = parseInt(activeRow.dataset.id);
            const quantity = parseInt(activeRow.dataset.quantity);
            const currentTime = new Date().getTime();

            if (Math.abs(diffX) < 10 && currentTime - lastTouchTime < 300 && lastTouchRowId === rowId) {
                activeRow.style.transform = 'translateX(0)';
                activeRow.classList.remove('swipe-green');
                activeRow.classList.remove('swipe-red');
                
                isSwiping = false;
                activeRow = null;
                
                setTimeout(() => {
                    openEditModal(rowId);
                }, 50);
                return;
            }

            lastTouchTime = currentTime;
            lastTouchRowId = rowId;

            activeRow.style.transition = 'transform 0.3s, background-color 0.3s';

            if (Math.abs(diffX) > 40) {
                if (diffX < -40) {
                    activeRow.style.transform = 'translateX(0)';
                    await setRowData(rowId, quantity, undefined, true);
                } else if (diffX > 40) {
                    activeRow.style.transform = 'translateX(0)';
                    await setRowData(rowId, 0, undefined, true);
                }
            } else {
                activeRow.style.transform = 'translateX(0)';
            }

            activeRow.classList.remove('swipe-green');
            activeRow.classList.remove('swipe-red');

            setTimeout(() => {
                if (activeRow) {
                    activeRow.style.transition = '';
                }
            }, 300);

            isSwiping = false;
            activeRow = null;
        }

        function handleRowTouchCancel(e) {
            if (!isSwiping || !activeRow) return;

            activeRow.style.transition = 'transform 0.3s, background-color 0.3s';
            activeRow.style.transform = 'translateX(0)';
            activeRow.classList.remove('swipe-green');
            activeRow.classList.remove('swipe-red');

            setTimeout(() => {
                if (activeRow) {
                    activeRow.style.transition = '';
                }
            }, 300);

            isSwiping = false;
            activeRow = null;
        }

        tbody.querySelectorAll('tr').forEach(row => {
            row.addEventListener('mousedown', handleRowMouseDown);
            row.addEventListener('mousemove', handleRowMouseMove);
            row.addEventListener('mouseup', handleRowMouseUp);
            row.addEventListener('mouseleave', handleRowMouseLeave);
            row.addEventListener('touchstart', handleRowTouchStart, { passive: true });
            row.addEventListener('touchmove', handleRowTouchMove, { passive: false });
            row.addEventListener('touchend', handleRowTouchEnd);
            row.addEventListener('touchcancel', handleRowTouchCancel);
            row.addEventListener('dblclick', handleRowDblClick);
        });
    }

    function handleRowDblClick(e) {
        const row = e.target.closest('tr');
        if (!row || isSwiping) return;

        const rowId = parseInt(row.dataset.id);
        openEditModal(rowId);
    }

    async function openEditModal(rowId) {
        const tables = await getAllTables();
        const table = tables.find(t => t.id === currentTableId);
        if (!table) return;

        const row = table.data.rows.find(r => r.id === rowId);
        if (!row) return;

        editingRowData = row;

        document.getElementById('editProductName').textContent = row.productName;
        document.getElementById('editQuantity').textContent = row.quantity;
        document.getElementById('editActualQuantity').value = row.actualQuantity !== null ? row.actualQuantity : '';
        document.getElementById('editProductionDate').value = row.productionDate || '';
        document.getElementById('editActualQuantity').focus();

        document.getElementById('editModal').classList.remove('hidden');
    }

    function closeEditModal() {
        document.getElementById('editModal').classList.add('hidden');
        editingRowData = null;
    }

    async function confirmEdit() {
        if (!editingRowData) return;

        const input = document.getElementById('editActualQuantity');
        const value = input.value.trim();

        let actualQuantity = null;
        if (value !== '') {
            actualQuantity = parseFloat(value);
            if (isNaN(actualQuantity) || actualQuantity < 0) {
                showToast('请输入有效的数字');
                return;
            }
        }

        const dateInput = document.getElementById('editProductionDate');
        const productionDate = dateInput.value.trim();

        await setRowData(editingRowData.id, actualQuantity, productionDate, true);
        closeEditModal();
    }

    async function setRowData(rowId, actualQuantity, productionDate, shouldSwitchView = false) {
        const tables = await getAllTables();
        const table = tables.find(t => t.id === currentTableId);
        if (!table) return;

        const row = table.data.rows.find(r => r.id === rowId);
        if (!row) return;

        if (actualQuantity !== null) {
            row.actualQuantity = actualQuantity;
        }
        
        if (productionDate !== undefined && productionDate !== null && productionDate !== '') {
            row.productionDate = productionDate;
        }

        row.status = calculateStatus(row.actualQuantity, row.quantity);

        table.updatedAt = new Date().toISOString();
        await saveTable(table);

        if (shouldSwitchView && isDateViewMode) {
            isDateViewMode = false;
            const btn = document.getElementById('toggleViewBtn');
            if (btn) {
                btn.textContent = '切换';
            }
            
            const toggleFields = document.querySelectorAll('.toggle-field');
            const dateFields = document.querySelectorAll('.date-field');
            if (toggleFields.length) {
                toggleFields.forEach(field => field.style.display = '');
            }
            if (dateFields.length) {
                dateFields.forEach(field => field.style.display = 'none');
            }
        }

        renderTable(table);

        if (checkTableCompleted(table)) {
            showToast('当前表格已完成');
        }
    }

    function generateCSV(table) {
        if (!table.data || !table.data.rows) return '';

        const headerMapping = {
            '序号': 'index',
            '商品名称': 'productName',
            '条码后四位': 'barcode',
            '数量': 'quantity',
            '价格': 'price',
            '实际数量': 'actualQuantity',
            '配货情况': 'distributionStatus'
        };

        const headers = table.data.originalHeaders || table.data.headers;
        let csv = headers.map(h => `"${h}"`).join(',') + '\n';

        table.data.rows.forEach(row => {
            const values = headers.map(header => {
                const fieldName = headerMapping[header] || header;
                let value = row[fieldName];
                if (header === '实际数量' || header === 'actualQuantity') {
                    value = value !== null ? value : '';
                }
                if (header === '价格' || header === 'price') {
                    value = value !== undefined ? parseFloat(value).toFixed(1) : '0.0';
                }
                return `"${value}"`;
            });
            csv += values.join(',') + '\n';
        });

        return csv;
    }

    async function refreshCurrentTable() {
        const tables = await getAllTables();
        const table = tables.find(t => t.id === currentTableId);
        if (table) {
            renderTableWithSort(table);
        }
    }

    function renderTableWithSort(table) {
        if (!table.data || !table.data.rows) {
            document.getElementById('tableBody').innerHTML = `
                <tr><td colspan="6" style="text-align: center; padding: 40px; color: #999;">暂无数据</td></tr>
            `;
            document.getElementById('tableRowCount').textContent = '共 0 条数据';
            return;
        }

        const rows = [...table.data.rows];

        if (sortField) {
            rows.sort((a, b) => sortRows(a, b));
        }

        const tbody = document.getElementById('tableBody');
        tbody.innerHTML = rows.map(row => `
            <tr class="table-row ${row.status}" data-id="${row.id}" data-quantity="${row.quantity}" data-product="${escapeHtml(row.productName)}" data-price="${row.price.toFixed(1)}" data-date="${row.productionDate || ''}">
                <td data-field="index" class="text-right">${row.index}</td>
                <td data-field="productName" class="text-left">${escapeHtml(row.productName)}</td>
                <td data-field="barcode" class="text-center toggle-field">${row.barcode}</td>
                <td data-field="quantity" class="text-right">${row.quantity}</td>
                <td data-field="price" class="text-center toggle-field">${row.price.toFixed(1)}</td>
                <td data-field="actualQuantity" class="text-right toggle-field">${row.actualQuantity !== null ? row.actualQuantity : '-'}</td>
                <td data-field="productionDate" class="text-center date-field" style="display:none;">${formatDate(row.productionDate)}</td>
            </tr>
        `).join('');

        document.getElementById('tableRowCount').textContent = `共 ${rows.length} 条数据`;

        setupTableInteractions(table);
        setupSortableHeaders();
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showToast(message) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 2000);
    }

    window.addEventListener('beforeunload', () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
        }
    });
})();
