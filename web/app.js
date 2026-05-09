/**
 * Dashboard Linkage for LLM Benchmark Results
 * Loads results.json and dynamically populates the results table and charts
 */

/**
 * Load benchmark results from the JSON file and populate the dashboard
 */
async function loadBenchmarkResults() {
    try {
        // Fetch the results JSON file
        const response = await fetch('../data/results.json');
        
        if (!response.ok) {
            throw new Error(`Failed to load results: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✓ Benchmark results loaded:', data);
        
        // Populate the results table
        populateResultsTable(data);
        
        // Update dashboard charts if available
        if (window.updateChart) {
            updateChart(data);
        }
        
        // Update tier badges
        updateTierBadges(data);
        
    } catch (error) {
        console.error("✗ Error loading benchmark data:", error);
        displayErrorMessage(error.message);
    }
}

/**
 * Populate the results table with benchmark data
 * @param {Array} results - Array of benchmark results
 */
function populateResultsTable(results) {
    const tableBody = document.querySelector('#results-table-body');
    
    if (!tableBody) {
        console.warn("⚠ Results table body not found. Creating table structure...");
        createResultsTable(results);
        return;
    }
    
    // Clear any existing data
    tableBody.innerHTML = '';
    
    // Create rows for each model
    results.forEach((result, index) => {
        const row = document.createElement('tr');
        row.className = `result-row result-row--${index + 1}`;
        row.dataset.model = result.model;
        row.dataset.score = result.final_score;
        row.dataset.tier = result.determination;
        
        const tierClass = `tier-${result.determination.toLowerCase()}`;
        const scoreClass = result.final_score > 85 ? 'score-badge--high' : 
                          result.final_score > 70 ? 'score-badge--mid' : 'score-badge--low';
        
        row.innerHTML = `
            <td class="result-col result-col--rank">#${index + 1}</td>
            <td class="result-col result-col--model">${result.model}</td>
            <td class="result-col result-col--score">
                <span class="score-badge ${scoreClass}">${result.final_score.toFixed(2)}</span>
                <span style="color: var(--text-muted); margin-left: 4px;">/100</span>
            </td>
            <td class="result-col result-col--accuracy">
                <span class="metric-value">${(result.accuracy * 100).toFixed(1)}%</span>
                <span class="metric-label">Accuracy</span>
            </td>
            <td class="result-col result-col--latency">
                <span class="metric-value">${result.latency.toFixed(2)}s</span>
                <span class="metric-label">Latency</span>
            </td>
            <td class="result-col result-col--cost">
                <span class="metric-value">$${result.cost.toFixed(4)}</span>
                <span class="metric-label">Cost</span>
            </td>
            <td class="result-col result-col--tier">
                <span class="tier-badge ${tierClass}">
                    ${result.determination}
                </span>
            </td>
        `;
        
        tableBody.appendChild(row);
    });
    
    console.log(`✓ Populated results table with ${results.length} models`);
}

/**
 * Create the results table structure if it doesn't exist
 * @param {Array} results - Array of benchmark results
 */
function createResultsTable(results) {
    let tableContainer = document.querySelector('#results-table-container');
    
    if (!tableContainer) {
        // Find a good place to insert the table (after dashboard section or at the end)
        const benchmarkSection = document.querySelector('#benchmark-section');
        const insertPoint = benchmarkSection || document.querySelector('.app-container');
        
        tableContainer = document.createElement('div');
        tableContainer.id = 'results-table-container';
        tableContainer.innerHTML = `
            <h2 class="section__title" style="margin-bottom: 20px;">📊 Benchmark Results</h2>
            <table id="results-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Model</th>
                        <th>Final Score</th>
                        <th>Accuracy</th>
                        <th>Latency</th>
                        <th>Cost</th>
                        <th>Deployment Tier</th>
                    </tr>
                </thead>
                <tbody id="results-table-body"></tbody>
            </table>
        `;
        
        insertPoint.parentNode.insertBefore(tableContainer, insertPoint.nextSibling);
    }
    
    // Now populate the newly created table
    populateResultsTable(results);
}

/**
 * Get color for tier badge
 * @param {string} tier - Deployment tier name
 * @returns {string} CSS class name for tier
 */
function getTierClass(tier) {
    const tierMap = {
        'Production': 'tier-production',
        'Analysis': 'tier-analysis',
        'Research': 'tier-research',
    };
    
    return tierMap[tier] || 'tier-research';
}

/**
 * Update tier badges with appropriate styling
 * @param {Array} results - Array of benchmark results
 */
function updateTierBadges(results) {
    const tierStats = {
        'Production': 0,
        'Analysis': 0,
        'Research': 0,
    };
    
    results.forEach(result => {
        tierStats[result.determination]++;
    });
    
    // Update tier stat cards if they exist
    Object.entries(tierStats).forEach(([tier, count]) => {
        const tierElement = document.querySelector(`[data-tier="${tier}"]`);
        if (tierElement) {
            tierElement.textContent = count;
        }
    });
    
    console.log('✓ Tier statistics:', tierStats);
}

/**
 * Display error message on the dashboard
 * @param {string} message - Error message to display
 */
function displayErrorMessage(message) {
    const errorContainer = document.querySelector('#error-message');
    
    if (errorContainer) {
        errorContainer.innerHTML = `
            <div class="error-alert">
                <span class="error-icon">⚠️</span>
                <span class="error-text">${message}</span>
            </div>
        `;
        errorContainer.style.display = 'block';
    }
}

/**
 * Refresh benchmark results (reload from file)
 */
async function refreshResults() {
    console.log('🔄 Refreshing benchmark results...');
    const refreshBtn = document.querySelector('#refresh-btn');
    
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Refreshing...';
    }
    
    try {
        await loadBenchmarkResults();
        
        if (refreshBtn) {
            refreshBtn.textContent = '✓ Refreshed';
            setTimeout(() => {
                refreshBtn.textContent = 'Refresh';
                refreshBtn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        console.error('✗ Refresh failed:', error);
        if (refreshBtn) {
            refreshBtn.textContent = 'Refresh Failed';
            refreshBtn.disabled = false;
        }
    }
}

/**
 * Generate performance summary from results
 * @param {Array} results - Array of benchmark results
 * @returns {Object} Summary object with statistics
 */
function generateSummary(results) {
    if (!results || results.length === 0) {
        return null;
    }
    
    const scores = results.map(r => r.final_score);
    const accuracies = results.map(r => r.accuracy);
    const latencies = results.map(r => r.latency);
    const costs = results.map(r => r.cost);
    
    return {
        topModel: results[0].model,
        topScore: results[0].final_score,
        avgScore: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2),
        avgAccuracy: ((accuracies.reduce((a, b) => a + b, 0) / accuracies.length) * 100).toFixed(1),
        avgLatency: (latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2),
        avgCost: (costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4),
    };
}

/**
 * Initialize dashboard on page load
 */
document.addEventListener('DOMContentLoaded', async function() {
    console.log('🚀 Initializing LLM Benchmark Dashboard...');
    
    // Load benchmark results
    await loadBenchmarkResults();
    
    // Set up auto-refresh interval (optional: every 60 seconds)
    // setInterval(loadBenchmarkResults, 60000);
    
    // Attach refresh button listener if it exists
    const refreshBtn = document.querySelector('#refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshResults);
    }
    
    console.log('✓ Dashboard initialized successfully');
});

/**
 * Export functions for use in other scripts
 */
window.BenchmarkDashboard = {
    loadResults: loadBenchmarkResults,
    refresh: refreshResults,
    generateSummary: generateSummary,
};
