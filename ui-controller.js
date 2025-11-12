// ui-controller.js

// Event listener for button clicks
const buttonListener = () => {
    const buttons = document.querySelectorAll('button');
    buttons.forEach(button => {
        button.addEventListener('click', (event) => {
            // Handle button click
            console.log(`Button clicked: ${event.target.textContent}`);
        });
    });
};

// Mode management
let currentMode = 'default';
const setMode = (mode) => {
    currentMode = mode;
    // Update UI based on mode
    console.log(`Current mode set to: ${currentMode}`);
};

// Dialog control logic
const openDialog = (dialogId) => {
    const dialog = document.getElementById(dialogId);
    if (dialog) {
        dialog.showModal();
    }
};

const closeDialog = (dialogId) => {
    const dialog = document.getElementById(dialogId);
    if (dialog) {
        dialog.close();
    }
};

// Toast notifications
const showToast = (message) => {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.className = 'toast';
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 3000);
};

// Drag navigation setup
const setupDragNavigation = () => {
    const container = document.getElementById('draggable-container');
    let isDragging = false;
    let startX, startY;

    container.addEventListener('mousedown', (event) => {
        isDragging = true;
        startX = event.clientX - container.offsetLeft;
        startY = event.clientY - container.offsetTop;
        document.addEventListener('mousemove', drag);
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        document.removeEventListener('mousemove', drag);
    });

    const drag = (event) => {
        if (isDragging) {
            container.style.left = `${event.clientX - startX}px`;
            container.style.top = `${event.clientY - startY}px`;
        }
    };
};

// Initialize all event listeners and setups
const init = () => {
    buttonListener();
    setupDragNavigation();
};

// Call initialize function on page load
window.onload = init;