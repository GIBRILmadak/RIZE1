/* ========================================
   ANALYTICS MENSUELLES
   ======================================== */

window.analyticsCharts = window.analyticsCharts || {};

function getAnalyticsDomIds(containerId) {
    const safeId = String(containerId || 'analytics-dashboard').replace(/[^a-zA-Z0-9_-]/g, '');
    return {
        containerId: containerId || 'analytics-dashboard',
        safeId,
        selectId: `month-select-${safeId}`,
        canvasId: `analytics-month-chart-${safeId}`,
        messageId: `analytics-message-${safeId}`
    };
}

function cleanupAnalytics(containerId = 'analytics-dashboard') {
    const { safeId, containerId: dashId } = getAnalyticsDomIds(containerId);
    const chart = window.analyticsCharts[safeId];
    if (chart) {
        chart.destroy();
        delete window.analyticsCharts[safeId];
    }

    const dashboard = document.getElementById(dashId);
    if (dashboard) {
        dashboard.innerHTML = '';
    }
}

function getMonthInfo(dateObj) {
    return {
        year: dateObj.getFullYear(),
        monthIndex: dateObj.getMonth()
    };
}

function getMonthRange(year, monthIndex) {
    const start = new Date(year, monthIndex, 1);
    const end = new Date(year, monthIndex + 1, 0);

    const startStr = start.toISOString().split('T')[0];
    const endStr = end.toISOString().split('T')[0];
    const daysInMonth = end.getDate();

    return { startStr, endStr, daysInMonth };
}

function formatMonthLabel(year, monthIndex) {
    const date = new Date(year, monthIndex, 1);
    return new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(date);
}

function monthKey(year, monthIndex) {
    const month = String(monthIndex + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function buildMonthList(createdAt) {
    const createdDate = createdAt ? new Date(createdAt) : new Date();
    const now = new Date();

    const start = new Date(createdDate.getFullYear(), createdDate.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 1);

    const months = [];
    const cursor = new Date(start);

    while (cursor <= end) {
        const year = cursor.getFullYear();
        const monthIndex = cursor.getMonth();
        months.push({
            year,
            monthIndex,
            key: monthKey(year, monthIndex),
            label: formatMonthLabel(year, monthIndex)
        });
        cursor.setMonth(cursor.getMonth() + 1);
    }

    return months;
}

async function getMonthlyMetrics(userId, year, monthIndex) {
    try {
        const { startStr, endStr } = getMonthRange(year, monthIndex);
        const { data, error } = await supabase
            .from('daily_metrics')
            .select('date, success_count, failure_count, pause_count')
            .eq('user_id', userId)
            .gte('date', startStr)
            .lte('date', endStr)
            .order('date', { ascending: true });

        if (error) throw error;

        return { success: true, metrics: data || [] };
    } catch (error) {
        console.error('Erreur récupération métriques mensuelles:', error);
        return { success: false, error: error.message };
    }
}

async function getMonthlyLiveHours(userId, year, monthIndex) {
    try {
        const monthStart = new Date(year, monthIndex, 1, 0, 0, 0, 0);
        const monthEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
        const endIso = monthEnd.toISOString();
        const startIso = monthStart.toISOString();

        const { data, error } = await supabase
            .from('streaming_sessions')
            .select('started_at, ended_at')
            .eq('user_id', userId)
            .lte('started_at', endIso)
            .or(`ended_at.gte.${startIso},ended_at.is.null`);

        if (error) throw error;

        const durations = Array(monthEnd.getDate()).fill(0);
        (data || []).forEach((session) => {
            if (!session.started_at) return;
            const start = new Date(session.started_at);
            const end = session.ended_at ? new Date(session.ended_at) : new Date();
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;

            const clampedStart = start < monthStart ? monthStart : start;
            const clampedEnd = end > monthEnd ? monthEnd : end;
            if (clampedEnd <= clampedStart) return;

            let cursor = new Date(clampedStart);
            while (cursor < clampedEnd) {
                const dayIndex = cursor.getDate() - 1;
                if (dayIndex < 0 || dayIndex >= durations.length) break;
                const dayEnd = new Date(cursor);
                dayEnd.setHours(23, 59, 59, 999);
                const segmentEnd = clampedEnd < dayEnd ? clampedEnd : dayEnd;
                const durationMs = segmentEnd - cursor;
                if (durationMs > 0) durations[dayIndex] += durationMs;
                cursor = new Date(dayEnd.getTime() + 1);
            }
        });

        const liveHours = durations.map(ms => ms > 0 ? Math.ceil(ms / 3600000) : 0);
        return { success: true, liveHours };
    } catch (error) {
        console.error('Erreur récupération heures live:', error);
        return { success: false, error: error.message };
    }
}

function buildSeries(metrics, daysInMonth, liveHours = []) {
    const success = Array(daysInMonth).fill(0);
    const failure = Array(daysInMonth).fill(0);
    const pause = Array(daysInMonth).fill(0);
    const live = Array(daysInMonth).fill(0);

    metrics.forEach((m) => {
        if (!m.date) return;
        const parts = m.date.split('-');
        if (parts.length !== 3) return;
        const day = parseInt(parts[2], 10);
        if (!day || day < 1 || day > daysInMonth) return;
        const idx = day - 1;
        success[idx] += m.success_count || 0;
        failure[idx] += m.failure_count || 0;
        pause[idx] += m.pause_count || 0;
    });

    if (Array.isArray(liveHours) && liveHours.length) {
        for (let i = 0; i < daysInMonth; i++) {
            live[i] = Number(liveHours[i]) || 0;
        }
    }

    return { success, failure, pause, live };
}

function renderDashboardShell(months, selectedKey, containerId = 'analytics-dashboard') {
    const { containerId: dashId, selectId, canvasId, messageId } = getAnalyticsDomIds(containerId);
    const dashboard = document.getElementById(dashId);
    if (!dashboard) return;

    const options = months.map((m) => {
        const selected = m.key === selectedKey ? 'selected' : '';
        return `<option value="${m.key}" ${selected}>${m.label}</option>`;
    }).join('');

    dashboard.innerHTML = `
        <div class="analytics-header" style="text-align: center; margin-bottom: 2rem;">
            <h1 style="font-size: 2.2rem; font-weight: 800; margin-bottom: 0.4rem;">Analytics Mensuelles</h1>
            <p style="color: var(--text-secondary);">Succès, échecs, pauses et lives (heures) par jour</p>
        </div>
        <div class="analytics-controls" style="display: flex; justify-content: center; gap: 1rem; align-items: center; margin-bottom: 2rem; flex-wrap: wrap;">
            <label for="${selectId}" style="color: var(--text-secondary); font-weight: 600;">Mois</label>
            <select id="${selectId}" style="background: rgba(255,255,255,0.06); color: var(--text-primary); border: 1px solid var(--border-color); padding: 0.5rem 0.75rem; border-radius: 8px;">
                ${options}
            </select>
        </div>
        <div class="chart-container" style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border-color);">
            <canvas id="${canvasId}" height="320"></canvas>
        </div>
        <div id="${messageId}" style="text-align: center; margin-top: 1rem; color: var(--text-secondary);"></div>
    `;
}

function renderMonthlyChart({ year, monthIndex, daysInMonth, series, containerId }) {
    const { safeId, canvasId } = getAnalyticsDomIds(containerId);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;

    const labels = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const maxValue = Math.max(
        ...series.success,
        ...series.failure,
        ...series.pause,
        ...series.live,
        0
    );
    const isProfileDashboard = containerId === 'profile-analytics';
    const yMax = isProfileDashboard ? Math.max(10, maxValue) : Math.max(daysInMonth, maxValue);

    if (window.analyticsCharts[safeId]) {
        window.analyticsCharts[safeId].destroy();
    }

    window.analyticsCharts[safeId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Succès',
                    data: series.success,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.12)',
                    tension: 0.3
                },
                {
                    label: 'Échecs',
                    data: series.failure,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    tension: 0.3
                },
                {
                    label: 'Pauses',
                    data: series.pause,
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.12)',
                    tension: 0.3
                },
                {
                    label: 'Live (heures)',
                    data: series.live,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.12)',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    labels: {
                        color: '#ffffff'
                    }
                },
                title: {
                    display: true,
                    text: formatMonthLabel(year, monthIndex),
                    color: '#ffffff',
                    font: {
                        size: 16,
                        weight: '700'
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: yMax,
                    ticks: {
                        color: '#ffffff',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255,255,255,0.08)'
                    }
                },
                x: {
                    ticks: {
                        color: '#ffffff'
                    },
                    grid: {
                        color: 'rgba(255,255,255,0.08)'
                    }
                }
            }
        }
    });
}

async function renderMonth(userId, year, monthIndex, containerId = 'analytics-dashboard') {
    const { messageId } = getAnalyticsDomIds(containerId);
    const message = document.getElementById(messageId);
    if (message) {
        message.textContent = 'Chargement des données...';
    }

    const { daysInMonth } = getMonthRange(year, monthIndex);
    const metricsResult = await getMonthlyMetrics(userId, year, monthIndex);
    const liveResult = await getMonthlyLiveHours(userId, year, monthIndex);

    if (!metricsResult.success) {
        if (message) {
            message.textContent = 'Erreur lors du chargement des données.';
        }
        return;
    }

    const liveHours = liveResult.success ? liveResult.liveHours : Array(daysInMonth).fill(0);
    const series = buildSeries(metricsResult.metrics, daysInMonth, liveHours);

    renderMonthlyChart({ year, monthIndex, daysInMonth, series, containerId });

    const total = series.success.reduce((a, b) => a + b, 0)
        + series.failure.reduce((a, b) => a + b, 0)
        + series.pause.reduce((a, b) => a + b, 0)
        + series.live.reduce((a, b) => a + b, 0);

    if (message) {
        message.textContent = total === 0 ? 'Aucune donnée pour ce mois.' : '';
    }
}

async function renderAnalyticsDashboard(user, options = {}) {
    if (!user) return;

    const userId = user.id;
    const containerId = options.containerId || 'analytics-dashboard';
    const months = buildMonthList(user.created_at);
    const nowInfo = getMonthInfo(new Date());
    const currentKey = monthKey(nowInfo.year, nowInfo.monthIndex);

    renderDashboardShell(months, currentKey, containerId);

    const { selectId } = getAnalyticsDomIds(containerId);
    const select = document.getElementById(selectId);
    if (!select) return;

    const getSelectedMonth = () => {
        const [yearStr, monthStr] = select.value.split('-');
        const year = parseInt(yearStr, 10);
        const monthIndex = parseInt(monthStr, 10) - 1;
        return { year, monthIndex };
    };

    select.addEventListener('change', () => {
        const { year, monthIndex } = getSelectedMonth();
        renderMonth(userId, year, monthIndex, containerId);
    });

    const { year, monthIndex } = getSelectedMonth();
    await renderMonth(userId, year, monthIndex, containerId);
}

async function renderProfileAnalytics(userId) {
    if (!userId) return;
    const container = document.getElementById('profile-analytics');
    if (!container) return;

    const user = typeof getUser === 'function' ? getUser(userId) : null;
    const userData = user || { id: userId };

    await renderAnalyticsDashboard(userData, { containerId: 'profile-analytics' });
}

window.cleanupAnalytics = cleanupAnalytics;
window.renderAnalyticsDashboard = renderAnalyticsDashboard;
window.renderProfileAnalytics = renderProfileAnalytics;
