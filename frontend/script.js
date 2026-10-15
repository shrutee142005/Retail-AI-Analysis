"use strict";

const API_BASE = "http://127.0.0.1:5000";

let forecasts = [];
let customers = [];
let segments = [];
let segmentTotalOverall = 0;
let revenueChart = null;
let segmentChart = null;
let totalCustomerCount = 0;

const $ = id => document.getElementById(id);

function money(value) {
    return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0
    }).format(Number(value) || 0);
}

function number(value) {
    return Number(value || 0).toLocaleString("en-IN");
}

function safeText(value) {
    return String(value ?? "—").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function setStatus(message, state) {
    const connection = $("connection");
    const sidebarStatus = $("sidebarStatus");

    if (connection) connection.textContent = message;

    if (sidebarStatus) {
        sidebarStatus.textContent = state === "online"
            ? "API Connected"
            : state === "offline"
                ? "API Disconnected"
                : "Connecting...";
    }

    ["connectionDot", "sidebarStatusDot"].forEach(id => {
        const dot = $(id);

        if (dot) {
            dot.classList.remove("online", "offline");

            if (state === "online") dot.classList.add("online");
            if (state === "offline") dot.classList.add("offline");
        }
    });
}

async function getJSON(endpoint) {
    const response = await fetch(`${API_BASE}${endpoint}`);

    if (!response.ok) {
        throw new Error(`${endpoint} returned HTTP ${response.status}`);
    }

    return response.json();
}

function findValue(row, candidates) {
    for (const key of candidates) {
        if (row[key] !== undefined && row[key] !== null) {
            return row[key];
        }
    }

    const key = Object.keys(row).find(k =>
        candidates.some(candidate =>
            k.toLowerCase() === candidate.toLowerCase()
        )
    );

    return key ? row[key] : null;
}

function forecastDate(row) {
    return findValue(row, [
        "Month", "month", "Date", "date",
        "forecast_month", "forecast_date",
        "ds", "Period", "period"
    ]) ?? "Unknown";
}

function forecastRevenue(row) {
    const value = findValue(row, [
        "predicted_revenue", "Predicted_Revenue",
        "forecast_revenue", "Forecast_Revenue",
        "revenue", "Revenue", "yhat", "prediction"
    ]);

    return Number(value) || 0;
}

function monthLabel(value) {
    const text = String(value);
    const match = text.match(/^(\d{4})-(\d{2})/);

    if (match) {
        const date = new Date(
            Number(match[1]),
            Number(match[2]) - 1,
            1
        );

        return date.toLocaleDateString("en-IN", {
            month: "short",
            year: "numeric"
        });
    }

    const date = new Date(text);

    return Number.isNaN(date.getTime())
        ? text
        : date.toLocaleDateString("en-IN", {
            month: "short",
            year: "numeric"
        });
}

// ---------- LOAD DASHBOARD ----------

async function loadDashboard() {
    const refresh = $("refreshBtn");

    if (refresh) {
        refresh.disabled = true;
        refresh.textContent = "Loading...";
    }

    setStatus("Connecting to Flask API...", "loading");

    try {
        const results = await Promise.allSettled([
            getJSON("/api/customers"),
            getJSON("/api/forecast"),
            getJSON("/api/segments")
        ]);

        const customerResult = results[0];
        const forecastResult = results[1];
        const segmentResult = results[2];

        const errors = [];

        // Customer API
        if (customerResult.status === "fulfilled") {
            const data = customerResult.value;

            customers = Array.isArray(data.customers)
                ? data.customers
                : [];

            totalCustomerCount = Number(
                data.total_customers ?? customers.length
            );

            $("customers").textContent = number(totalCustomerCount);

            renderCustomers();
        } else {
            errors.push("customer data");

            console.error(
                "Customer API error:",
                customerResult.reason
            );
        }

        // Revenue forecast API
        if (forecastResult.status === "fulfilled") {
            const data = forecastResult.value;

            forecasts = (
                Array.isArray(data.forecast)
                    ? data.forecast
                    : []
            )
                .map(row => ({
                    date: String(forecastDate(row)),
                    revenue: forecastRevenue(row)
                }))
                .sort((a, b) => a.date.localeCompare(b.date));

            $("months").textContent = forecasts.length;

            populateMonthFilter();
            renderForecast();
        } else {
            errors.push("forecast data");

            console.error(
                "Forecast API error:",
                forecastResult.reason
            );

            $("forecastTable").innerHTML =
                '<tr><td colspan="3" class="empty-state">Forecast API data could not be loaded.</td></tr>';

            $("selectedSummary").textContent =
                "Forecast unavailable.";

            $("revenueChartMessage").textContent =
                "Could not load forecast data.";
        }

        // Customer segmentation API
        if (segmentResult.status === "fulfilled") {
            const data = segmentResult.value;

            segments = Array.isArray(data.segments)
                ? data.segments
                : [];

            renderSegments(data);
        } else {
            errors.push("segmentation data");

            console.error(
                "Segments API error:",
                segmentResult.reason
            );

            $("segmentTable").innerHTML =
                '<tr><td colspan="7" class="empty-state">Segment data could not be loaded. Check /api/segments.</td></tr>';

            $("segmentChartMessage").textContent =
                "Could not load segment data. Check the Flask API.";
        }

        // Update API connection status
        if (errors.length === 0) {
            setStatus(
                "All dashboard data loaded successfully.",
                "online"
            );
        } else {
            setStatus(
                `Some data could not load: ${errors.join(", ")}.`,
                "offline"
            );
        }

        // IMPORTANT FIX:
        // Call insights only after API data has been processed.
        renderInsights();
        renderClusterRecommendations();

    } catch (error) {
        console.error("Dashboard error:", error);

        setStatus(
            "Unable to connect to Flask API. Check that the server is running.",
            "offline"
        );
    } finally {
        if (refresh) {
            refresh.disabled = false;
            refresh.textContent = "↻ Refresh Data";
        }
    }
}

// ---------- REVENUE FORECAST ----------

function populateMonthFilter() {
    const select = $("monthFilter");

    if (!select) return;

    const previous = select.value || "all";

    select.innerHTML =
        '<option value="all">All Months</option>';

    forecasts.forEach(item => {
        const option = document.createElement("option");

        option.value = item.date;
        option.textContent = monthLabel(item.date);

        select.appendChild(option);
    });

    select.value = forecasts.some(
        item => item.date === previous
    )
        ? previous
        : "all";
}

function visibleForecasts() {
    const selected = $("monthFilter")?.value || "all";

    return selected === "all"
        ? forecasts
        : forecasts.filter(item => item.date === selected);
}

function renderForecast() {
    const rows = visibleForecasts();

    const highest = rows.length
        ? rows.reduce((a, b) =>
            a.revenue > b.revenue ? a : b
        )
        : null;

    const lowest = rows.length
        ? rows.reduce((a, b) =>
            a.revenue < b.revenue ? a : b
        )
        : null;

    $("highest").textContent = highest
        ? money(highest.revenue)
        : "—";

    $("highestMonth").textContent = highest
        ? monthLabel(highest.date)
        : "No data";

    $("lowest").textContent = lowest
        ? money(lowest.revenue)
        : "—";

    $("lowestMonth").textContent = lowest
        ? monthLabel(lowest.date)
        : "No data";

    const sum = rows.reduce(
        (total, item) => total + item.revenue,
        0
    );

    $("selectedSummary").textContent = rows.length === 1
        ? `${monthLabel(rows[0].date)} · Predicted revenue: ${money(rows[0].revenue)}`
        : `${rows.length} months · Combined predicted revenue: ${money(sum)}`;

    renderForecastTable(rows);
    renderRevenueChart(rows);
    renderInsights();
}

function renderForecastTable(rows) {
    const body = $("forecastTable");

    if (!rows.length) {
        body.innerHTML =
            '<tr><td colspan="3" class="empty-state">No forecast records available.</td></tr>';

        return;
    }

    body.innerHTML = rows.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td>${safeText(monthLabel(item.date))}</td>
            <td><strong>${money(item.revenue)}</strong></td>
        </tr>
    `).join("");
}

function renderRevenueChart(rows) {
    const canvas = $("revenueChart");

    if (!canvas) return;

    if (typeof Chart === "undefined") {
        $("revenueChartMessage").textContent =
            "Chart.js load nahi hua. Internet connection check karke page refresh karo.";

        return;
    }

    $("revenueChartMessage").textContent = "";

    if (revenueChart) {
        revenueChart.destroy();
    }

    revenueChart = new Chart(canvas, {
        type: "line",

        data: {
            labels: rows.map(item => monthLabel(item.date)),

            datasets: [{
                label: "Predicted Revenue",
                data: rows.map(item => item.revenue),
                borderColor: "#7052e8",
                backgroundColor: "rgba(112, 82, 232, 0.12)",
                borderWidth: 3,
                pointRadius: 5,
                pointHoverRadius: 7,
                pointBackgroundColor: "#7052e8",
                fill: true,
                tension: 0.35
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            interaction: {
                intersect: false,
                mode: "index"
            },

            plugins: {
                legend: {
                    display: false
                },

                tooltip: {
                    callbacks: {
                        label: context =>
                            `Revenue: ${money(context.parsed.y)}`
                    }
                }
            },

            scales: {
                y: {
                    beginAtZero: true,

                    ticks: {
                        callback: value => money(value)
                    },

                    grid: {
                        color: "#edf0f6"
                    }
                },

                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// ---------- CUSTOMER RECORDS ----------

function renderCustomers() {
    const head = $("customerTableHead");
    const body = $("customerTable");

    const query = ($("customerSearch")?.value || "")
        .trim()
        .toLowerCase();

    if (!customers.length) {
        head.innerHTML = "";

        body.innerHTML =
            '<tr><td class="empty-state">No customer records available.</td></tr>';

        $("customerSummary").textContent =
            "No records loaded.";

        return;
    }

    const filtered = customers.filter(customer =>
        Object.values(customer).some(value =>
            String(value ?? "")
                .toLowerCase()
                .includes(query)
        )
    );

    const columns = Object.keys(customers[0]);

    head.innerHTML = `<tr>${columns.map(column =>
        `<th>${safeText(column.replaceAll("_", " "))}</th>`
    ).join("")}</tr>`;

    if (!filtered.length) {
        body.innerHTML =
            `<tr><td colspan="${columns.length}" class="empty-state">No matching records.</td></tr>`;
    } else {
        body.innerHTML = filtered.map(customer => `
            <tr>
                ${columns.map(column =>
                    `<td>${safeText(customer[column])}</td>`
                ).join("")}
            </tr>
        `).join("");
    }

    $("customerSummary").textContent =
        `Showing ${filtered.length} of ${customers.length} records returned by API · ${number(totalCustomerCount)} total customers in database`;
}

// ---------- CUSTOMER SEGMENTATION ----------

function renderSegments(data) {
    segmentTotalOverall = Number(data.total_customers) ||
        segments.reduce(
            (sum, item) =>
                sum + Number(item.customer_count || 0),
            0
        );

    updateSegmentView();
}

function updateSegmentView() {
    const selectedCluster =
        $("segmentFilter")?.value || "all";

    const visibleSegments = selectedCluster === "all"
        ? segments
        : segments.filter(
            item => String(item.Cluster) === selectedCluster
        );

    const visibleTotal = visibleSegments.reduce(
        (sum, item) =>
            sum + Number(item.customer_count || 0),
        0
    );

    $("segmentTotalCustomers").textContent =
        number(visibleTotal);

    $("segmentTotalGroups").textContent =
        visibleSegments.length;

    if (!visibleSegments.length) {
        $("largestSegment").textContent = "—";
        $("largestSegmentCount").textContent =
            "No segment selected";

        $("largestSegmentShare").textContent = "—";

        $("segmentTable").innerHTML =
            '<tr><td colspan="7" class="empty-state">No matching segment found.</td></tr>';

        if (segmentChart) {
            segmentChart.destroy();
            segmentChart = null;
        }

        return;
    }

    const largest = visibleSegments.reduce((a, b) =>
        Number(a.customer_count) >
        Number(b.customer_count) ? a : b
    );

    $("largestSegment").textContent =
        `Cluster ${largest.Cluster}`;

    $("largestSegmentCount").textContent =
        `${number(largest.customer_count)} customers`;

    const largestShare = segmentTotalOverall
        ? Number(largest.customer_count) /
            segmentTotalOverall * 100
        : 0;

    $("largestSegmentShare").textContent =
        `${largestShare.toFixed(1)}%`;

    $("segmentTable").innerHTML =
        visibleSegments.map(item => {
            const count = Number(item.customer_count) || 0;

            const share = segmentTotalOverall
                ? count / segmentTotalOverall * 100
                : 0;

            return `
                <tr>
                    <td><strong>Cluster ${safeText(item.Cluster)}</strong></td>
                    <td>${number(count)}</td>
                    <td>${share.toFixed(1)}%</td>
                    <td>${money(item.avg_monetary)}</td>
                    <td>${Number(item.avg_frequency || 0).toFixed(2)}</td>
                    <td>${Number(item.avg_recency || 0).toFixed(2)} days</td>
                    <td>${money(item.avg_order_value)}</td>
                </tr>
            `;
        }).join("");

    renderSegmentChart(visibleSegments);
}

function renderSegmentChart(visibleSegments = segments) {
    const canvas = $("segmentChart");

    if (!canvas) return;

    if (typeof Chart === "undefined") {
        $("segmentChartMessage").textContent =
            "Chart.js load nahi hua. Internet connection check karo.";

        return;
    }

    $("segmentChartMessage").textContent = "";

    if (segmentChart) {
        segmentChart.destroy();
        segmentChart = null;
    }

    const palette = [
        "#7052e8",
        "#149b87",
        "#f2a93b",
        "#3980df"
    ];

    segmentChart = new Chart(canvas, {
        type: "bar",

        data: {
            labels: visibleSegments.map(
                item => `Cluster ${item.Cluster}`
            ),

            datasets: [{
                label: "Customers",

                data: visibleSegments.map(
                    item => Number(item.customer_count) || 0
                ),

                backgroundColor: visibleSegments.map(item => {
                    const index = Number(item.Cluster);

                    return palette[index % palette.length];
                }),

                borderRadius: 7,
                maxBarThickness: 75
            }]
        },

        options: {
            responsive: true,
            maintainAspectRatio: false,

            plugins: {
                legend: {
                    display: false
                },

                tooltip: {
                    callbacks: {
                        label: context =>
                            `${number(context.parsed.y)} customers`
                    }
                }
            },

            scales: {
                y: {
                    beginAtZero: true,

                    ticks: {
                        precision: 0
                    },

                    grid: {
                        color: "#edf0f6"
                    }
                },

                x: {
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

// ---------- BUSINESS INSIGHTS ----------

function renderInsights() {
    const container = document.getElementById("insightCards");

    if (!container) {
        console.warn("AI Insights container not found.");
        return;
    }

    if (!Array.isArray(segments) || segments.length === 0) {
        container.innerHTML = `
            <div class="insight-card">
                <h3>Customer insights unavailable</h3>
                <p>Customer segment data load hone ka wait karein.</p>
            </div>
        `;

        return;
    }

    const totalCustomers = segments.reduce(
        (sum, s) =>
            sum + Number(s.customer_count || 0),
        0
    );

    const highValue = [...segments].sort(
        (a, b) =>
            Number(b.avg_monetary || 0) -
            Number(a.avg_monetary || 0)
    )[0];

    const mostFrequent = [...segments].sort(
        (a, b) =>
            Number(b.avg_frequency || 0) -
            Number(a.avg_frequency || 0)
    )[0];

    const leastRecent = [...segments].sort(
        (a, b) =>
            Number(b.avg_recency || 0) -
            Number(a.avg_recency || 0)
    )[0];

    const highestAOV = [...segments].sort(
        (a, b) =>
            Number(b.avg_order_value || 0) -
            Number(a.avg_order_value || 0)
    )[0];

    const share = totalCustomers > 0
        ? (
            Number(highValue.customer_count || 0) /
            totalCustomers * 100
        ).toFixed(1)
        : "0.0";

    const insights = [
        {
            icon: "💎",
            title: "Highest-Spending Segment",

            finding:
                `Cluster ${highValue.Cluster} has the highest ` +
                `average customer spending: ${money(highValue.avg_monetary)}.`,

            action:
                "Consider loyalty rewards and personalized offers.",

            metric:
                `${number(highValue.customer_count)} customers`
        },

        {
            icon: "🛍️",
            title: "Most Frequent Shoppers",

            finding:
                `Cluster ${mostFrequent.Cluster} has the highest ` +
                `average shopping frequency: ` +
                `${Number(mostFrequent.avg_frequency || 0).toFixed(2)}.`,

            action:
                "Consider repeat-purchase rewards and cross-selling.",

            metric:
                "Highest average frequency"
        },

        {
            icon: "⏳",
            title: "Longest Time Since Purchase",

            finding:
                `Cluster ${leastRecent.Cluster} has the highest ` +
                `average recency: ` +
                `${Number(leastRecent.avg_recency || 0).toFixed(1)} days.`,

            action:
                "Consider a re-engagement campaign for this group.",

            metric:
                "Review for possible inactivity"
        },

        {
            icon: "🧾",
            title: "Highest Average Order Value",

            finding:
                `Cluster ${highestAOV.Cluster} has an average order ` +
                `value of ${money(highestAOV.avg_order_value)}.`,

            action:
                "Explore premium products and relevant product bundles.",

            metric:
                `${share}% of customers are in the highest-spending segment`
        }
    ];

    container.innerHTML = insights.map(item => `
        <article class="insight-card">
            <div class="insight-icon">${item.icon}</div>

            <h3>${item.title}</h3>

            <p>${item.finding}</p>

            <p class="insight-action">
                <strong>Suggested action:</strong> ${item.action}
            </p>

            <span class="insight-metric">${item.metric}</span>
        </article>
    `).join("");
}

// ---------- CLUSTER-WISE BUSINESS RECOMMENDATIONS ----------

function renderClusterRecommendations() {
    const container =
        document.getElementById("clusterRecommendations");

    if (!container) return;

    if (!Array.isArray(segments) || segments.length === 0) {
        container.innerHTML =
            "<p>Customer data is loading...</p>";

        return;
    }

    const recommendations = segments.map(segment => {
        const frequency =
            Number(segment.avg_frequency || 0);

        const monetary =
            Number(segment.avg_monetary || 0);

        const recency =
            Number(segment.avg_recency || 0);

        const aov =
            Number(segment.avg_order_value || 0);

        let title = "";
        let action = "";

        if (frequency >= 10 && monetary >= 5000) {
            title = "High-value, frequent customers";

            action =
                "Consider loyalty rewards, VIP benefits and relevant cross-selling.";

        } else if (recency >= 180 && frequency < 3) {
            title = "Potentially inactive customers";

            action =
                "Test a win-back campaign and measure whether customers return.";

        } else if (aov >= 100) {
            title = "High average order value";

            action =
                "Consider premium recommendations and complementary products.";

        } else {
            title = "Opportunity to increase engagement";

            action =
                "Test relevant product recommendations and repeat-purchase offers.";
        }

        return `
            <article class="insight-card">
                <div class="insight-icon">💡</div>

                <h3>Cluster ${Number(segment.Cluster)}: ${title}</h3>

                <p>
                    Customers: ${number(segment.customer_count)}<br>
                    Average spending: ${money(monetary)}<br>
                    Average frequency: ${frequency.toFixed(2)}<br>
                    Average recency: ${recency.toFixed(1)} days<br>
                    Average order value: ${money(aov)}
                </p>

                <p class="insight-action">
                    <strong>Suggested action:</strong> ${action}
                </p>
            </article>
        `;
    });

    container.innerHTML = recommendations.join("");
}

// ---------- PAGE INITIALIZATION ----------

document.addEventListener("DOMContentLoaded", () => {
    $("refreshBtn")?.addEventListener(
        "click",
        loadDashboard
    );

    $("monthFilter")?.addEventListener(
        "change",
        renderForecast
    );

    $("customerSearch")?.addEventListener(
        "input",
        renderCustomers
    );

    $("segmentFilter")?.addEventListener(
        "change",
        updateSegmentView
    );

    $("resetSegmentFilter")?.addEventListener("click", () => {
        $("segmentFilter").value = "all";
        updateSegmentView();
    });

    loadDashboard();
});