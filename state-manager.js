// state-manager.js

// State object initialization
const state = {
    employees: [],
    selectedEmployee: null,
    // Add more state properties as needed
};

// State updates
function updateState(newState) {
    Object.assign(state, newState);
}

// State persistence
function saveState() {
    localStorage.setItem('appState', JSON.stringify(state));
}

function loadState() {
    const savedState = localStorage.getItem('appState');
    if (savedState) {
        Object.assign(state, JSON.parse(savedState));
    }
}

// Employee data management extracted from app.js
function addEmployee(employee) {
    state.employees.push(employee);
    saveState();
}

function removeEmployee(employeeId) {
    state.employees = state.employees.filter(emp => emp.id !== employeeId);
    saveState();
}

function selectEmployee(employeeId) {
    state.selectedEmployee = state.employees.find(emp => emp.id === employeeId);
}

// Load the state on initialization
loadState();

export {state, updateState, addEmployee, removeEmployee, selectEmployee};
