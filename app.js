let lockerSettings = {};
let packages = [];

const defaultSettings = {
    '丰巢': 18,
    '蜜罐': 72,
    '和驿智能柜': 24
};

function init() {
    loadFromStorage();
    renderSettings();
    renderPackages();
}

function loadFromStorage() {
    const savedSettings = localStorage.getItem('lockerSettings');
    const savedPackages = localStorage.getItem('packages');
    
    if (savedSettings) {
        lockerSettings = JSON.parse(savedSettings);
    } else {
        lockerSettings = { ...defaultSettings };
    }
    
    if (savedPackages) {
        packages = JSON.parse(savedPackages);
    }
}

function saveToStorage() {
    localStorage.setItem('lockerSettings', JSON.stringify(lockerSettings));
    localStorage.setItem('packages', JSON.stringify(packages));
}

function openSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.add('show');
}

function closeSettings() {
    const modal = document.getElementById('settingsModal');
    modal.classList.remove('show');
}

function addLockerSetting() {
    const nameInput = document.getElementById('lockerName');
    const hoursInput = document.getElementById('freeHours');
    
    const name = nameInput.value.trim();
    const hours = parseInt(hoursInput.value);
    
    if (!name || !hours || hours < 1) {
        alert('请输入有效的快递柜名称和免费时长');
        return;
    }
    
    lockerSettings[name] = hours;
    saveToStorage();
    renderSettings();
    
    nameInput.value = '';
    hoursInput.value = '';
}

function deleteLockerSetting(name) {
    if (confirm(`确定要删除快递柜"${name}"的设置吗？`)) {
        delete lockerSettings[name];
        saveToStorage();
        renderSettings();
    }
}

function renderSettings() {
    const settingsList = document.getElementById('settingsList');
    settingsList.innerHTML = '';
    
    const sortedSettings = Object.entries(lockerSettings).sort((a, b) => a[0].localeCompare(b[0]));
    
    sortedSettings.forEach(([name, hours]) => {
        const item = document.createElement('div');
        item.className = 'setting-item';
        item.innerHTML = `
            <span class="locker-name">${name}</span>
            <span class="free-hours">${hours}小时免费</span>
            <button class="delete-btn" onclick="deleteLockerSetting('${name}')">删除</button>
        `;
        settingsList.appendChild(item);
    });
}

function parsePackageData(text) {
    const lines = text.trim().split('\n');
    const parsedPackages = [];
    
    let currentPackage = null;
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const timeMatch = line.match(/(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{1,2})/);
        const lockerMatch = line.match(/【(.+?)】/);
        const codeMatch = line.match(/取件码(\d+)/);
        const hoursMatch = line.match(/(\d+)小时/);
        
        if (timeMatch) {
            if (currentPackage) {
                parsedPackages.push(currentPackage);
            }
            
            const currentYear = new Date().getFullYear();
            const month = parseInt(timeMatch[1]);
            const day = parseInt(timeMatch[2]);
            const hour = parseInt(timeMatch[3]);
            const minute = parseInt(timeMatch[4]);
            
            currentPackage = {
                id: Date.now() + Math.random(),
                date: new Date(currentYear, month - 1, day, hour, minute),
                lockerName: '',
                code: '',
                freeHours: 0,
                originalText: line
            };
        }
        
        if (currentPackage) {
            if (lockerMatch) {
                currentPackage.lockerName = lockerMatch[1];
            }
            
            if (codeMatch) {
                currentPackage.code = codeMatch[1];
            }
            
            if (hoursMatch) {
                currentPackage.freeHours = parseInt(hoursMatch[1]);
            }
            
            currentPackage.originalText += '\n' + line;
        }
    }
    
    if (currentPackage) {
        parsedPackages.push(currentPackage);
    }
    
    return parsedPackages;
}

function calculateTimeInfo(packageData) {
    const now = new Date();
    const storedTime = new Date(packageData.date);
    const diffMs = now - storedTime;
    const diffHours = diffMs / (1000 * 60 * 60);
    
    let freeHours = packageData.freeHours;
    if (!freeHours && lockerSettings[packageData.lockerName]) {
        freeHours = lockerSettings[packageData.lockerName];
    }
    
    const remainingHours = freeHours - diffHours;
    const isOverdue = diffHours > freeHours;
    
    return {
        storedTime: storedTime,
        storedHours: diffHours,
        freeHours: freeHours,
        remainingHours: remainingHours,
        isOverdue: isOverdue
    };
}

function formatTime(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

function formatDuration(hours) {
    const absHours = Math.abs(hours);
    const h = Math.floor(absHours);
    const m = Math.round((absHours - h) * 60);
    return `${h}小时${m}分钟`;
}

function importData() {
    const importText = document.getElementById('importData').value.trim();
    
    if (!importText) {
        alert('请输入要导入的数据');
        return;
    }
    
    const newPackages = parsePackageData(importText);
    
    if (newPackages.length === 0) {
        alert('未能解析出有效的快递信息，请检查格式');
        return;
    }
    
    packages = [...packages, ...newPackages];
    saveToStorage();
    renderPackages();
    
    document.getElementById('importData').value = '';
    alert(`成功导入 ${newPackages.length} 条快递信息`);
}

function clearAllData() {
    if (confirm('确定要清空所有快递数据吗？此操作不可恢复！')) {
        packages = [];
        saveToStorage();
        renderPackages();
    }
}

function deletePackage(id) {
    if (confirm('确定要删除这条快递信息吗？')) {
        packages = packages.filter(p => p.id !== id);
        saveToStorage();
        renderPackages();
    }
}

function renderPackages() {
    const container = document.getElementById('lockerGroups');
    container.innerHTML = '';
    
    if (packages.length === 0) {
        container.innerHTML = '<div class="empty-state">暂无快递信息，请在上方导入数据</div>';
        return;
    }
    
    const groupedPackages = {};
    
    packages.forEach(pkg => {
        if (!groupedPackages[pkg.lockerName]) {
            groupedPackages[pkg.lockerName] = [];
        }
        groupedPackages[pkg.lockerName].push(pkg);
    });
    
    Object.keys(groupedPackages).sort().forEach(lockerName => {
        const group = document.createElement('div');
        group.className = 'locker-group';
        
        const lockerPackages = groupedPackages[lockerName];
        const lockerFreeHours = lockerSettings[lockerName] || 0;
        
        let headerHtml = `
            <div class="locker-header">${lockerName}</div>
            <div class="locker-info">
                免费存放时长：${lockerFreeHours}小时 | 共 ${lockerPackages.length} 个包裹
            </div>
            <div class="package-list">
        `;
        
        lockerPackages.forEach(pkg => {
            const timeInfo = calculateTimeInfo(pkg);
            const statusClass = timeInfo.isOverdue ? 'overdue' : (timeInfo.remainingHours < 2 ? 'warning' : '');
            
            headerHtml += `
                <div class="package-item ${statusClass}">
                    <div class="package-header">
                        <span class="package-code">${pkg.code}</span>
                        <span class="package-time">${formatTime(timeInfo.storedTime)}</span>
                    </div>
                    <div class="package-status">
                        <div class="status-info">
                            <div class="status-item">
                                <span class="status-label">${timeInfo.isOverdue ? '已超时' : '剩余'}</span>
                                <span class="status-value ${timeInfo.isOverdue ? 'overdue-time' : (timeInfo.remainingHours < 2 ? 'warning-time' : '')}">
                                    ${formatDuration(timeInfo.remainingHours)}
                                </span>
                            </div>
                            <div class="status-item">
                                <span class="status-value">${timeInfo.isOverdue ? '⚠️ 已超时' : (timeInfo.remainingHours < 2 ? '⏰ 即将超时' : '✅ 正常')}</span>
                            </div>
                        </div>
                        <button class="delete-btn" onclick="deletePackage(${pkg.id})">删除</button>
                    </div>
                </div>
            `;
        });
        
        headerHtml += '</div>';
        group.innerHTML = headerHtml;
        container.appendChild(group);
    });
}

window.onload = init;
