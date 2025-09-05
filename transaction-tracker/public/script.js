document.addEventListener('DOMContentLoaded', () => {
    const goalInput = document.getElementById('goal');
    const dailyAmountInput = document.getElementById('dailyAmount');
    const updateButton = document.getElementById('updateButton');
    const currentGoalSpan = document.getElementById('currentGoal');
    const currentProgressSpan = document.getElementById('currentProgress');
    const remainingSpan = document.getElementById('remaining');
    const resetButton = document.getElementById('resetButton');

    let totalProgress = 0;
    let transactionGoal = 0;

    const ctx = document.getElementById('progressChart').getContext('2d');
    const progressChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Progress'],
            datasets: [{
                label: 'Total Progress',
                data: [0],
                backgroundColor: 'rgba(0, 123, 255, 0.7)',
                borderColor: 'rgba(0, 123, 255, 1)',
                borderWidth: 1
            }, {
                label: 'Remaining',
                data: [0],
                backgroundColor: 'rgba(220, 220, 220, 0.7)',
                borderColor: 'rgba(220, 220, 220, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    stacked: true,
                    max: 1000000,
                    title: {
                        display: true,
                        text: 'Amount (₦)'
                    }
                },
                y: {
                    stacked: true,
                    beginAtZero: true
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });

    // --- New: Reset Function ---
    const resetProgress = () => {
        totalProgress = 0;
        transactionGoal = 0;

        // Save the reset values to the database
        saveProgress();

        // Update the UI
        updateChartAndUI();

        // Optionally, clear the input fields
        goalInput.value = '';
        dailyAmountInput.value = '';
    };

    // --- NEW: Function to load saved data ---
    const loadProgress = async () => {
        try {
            const response = await fetch('/api/progress');
            const data = await response.json();
            if (data) {
                totalProgress = data.currentProgress;
                transactionGoal = data.goal;
            }
            updateChartAndUI();
        } catch (error) {
            console.error('Failed to load progress:', error);
        }
    };

    // --- NEW: Function to save data ---
    const saveProgress = async () => {
        try {
            await fetch('/api/progress', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ goal: transactionGoal, currentProgress: totalProgress })
            });
        } catch (error) {
            console.error('Failed to save progress:', error);
        }
    };

    const updateProgress = () => {
        const dailyAmount = parseFloat(dailyAmountInput.value) || 0;
        const newGoal = parseFloat(goalInput.value) || transactionGoal;

        if (newGoal !== transactionGoal) {
            transactionGoal = newGoal;
            progressChart.options.scales.x.max = transactionGoal;
        }

        totalProgress += dailyAmount;

        // --- NEW: Save the updated data ---
        saveProgress();

        updateChartAndUI();
        dailyAmountInput.value = '';
    };

    const updateChartAndUI = () => {
        const remaining = Math.max(0, transactionGoal - totalProgress);
        progressChart.data.datasets[0].data[0] = totalProgress;
        progressChart.data.datasets[1].data[0] = remaining;
        progressChart.update();

        currentGoalSpan.textContent = transactionGoal.toLocaleString();
        currentProgressSpan.textContent = totalProgress.toLocaleString();
        remainingSpan.textContent = remaining.toLocaleString();
    };

    updateButton.addEventListener('click', updateProgress);
    resetButton.addEventListener('click', resetProgress);

    // Call loadProgress when the page first loads
    loadProgress();
});