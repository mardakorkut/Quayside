/**
 * Authentication Logic
 * Login, Register, Session Management
 */

let authToken = null;
let currentUser = null;

// ==================== INITIALIZATION ====================

function initAuth() {
    // Check for existing token
    authToken = localStorage.getItem('auth_token');
    
    if (authToken) {
        // Verify token and load user
        fetchCurrentUser();
    } else {
        showLoginButton();
    }
}

// ==================== API CALLS ====================

async function register(email, username, password) {
    try {
        const response = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, username, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Registration failed');
        }
        
        const data = await response.json();
        authToken = data.access_token;
        localStorage.setItem('auth_token', authToken);
        
        await fetchCurrentUser();
        closeAuthModal();
        showToast('Welcome to Quayside! 🚢', 'success');
        
        // Load user's vessels from database (will be empty for new users)
        if (typeof loadMyVesselsFromDatabase === 'function') {
            await loadMyVesselsFromDatabase();
        }
        
    } catch (error) {
        showAuthError(error.message);
    }
}

async function login(email, password) {
    try {
        const response = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Login failed');
        }
        
        const data = await response.json();
        authToken = data.access_token;
        localStorage.setItem('auth_token', authToken);
        
        await fetchCurrentUser();
        closeAuthModal();
        showToast('Welcome back! 🎉', 'success');
        
        // Load user's vessels from database
        if (typeof loadMyVesselsFromDatabase === 'function') {
            await loadMyVesselsFromDatabase();
        }
        
    } catch (error) {
        showAuthError(error.message);
    }
}

async function fetchCurrentUser() {
    try {
        const response = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        if (!response.ok) {
            throw new Error('Failed to fetch user');
        }
        
        currentUser = await response.json();
        showUserMenu();
        
        // Load user's vessels from database when page loads
        if (typeof loadMyVesselsFromDatabase === 'function') {
            await loadMyVesselsFromDatabase();
        }
        
    } catch (error) {
        console.error('Auth error:', error);
        logout();
    }
}

function logout() {
    authToken = null;
    currentUser = null;
    localStorage.removeItem('auth_token');
    showLoginButton();
    showToast('Logged out successfully', 'success');
}

// ==================== UI FUNCTIONS ====================

function showAuthModal() {
    document.getElementById('auth-modal').style.display = 'flex';
    switchToLogin();
}

function closeAuthModal() {
    document.getElementById('auth-modal').style.display = 'none';
    hideAuthError();
}

function switchToLogin() {
    document.getElementById('auth-modal-title').innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    hideAuthError();
}

function switchToRegister() {
    document.getElementById('auth-modal-title').innerHTML = '<i class="fas fa-user-plus"></i> Create Account';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
    hideAuthError();
}

function showAuthError(message) {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function hideAuthError() {
    const errorDiv = document.getElementById('auth-error');
    errorDiv.style.display = 'none';
}

function showLoginButton() {
    const authSection = document.getElementById('auth-section');
    console.log('showLoginButton called, authSection:', authSection);
    if (!authSection) {
        console.error('auth-section not found!');
        return;
    }
    
    authSection.innerHTML = `
        <button class="btn-login" onclick="showAuthModal()">
            <i class="fas fa-sign-in-alt"></i> Login
        </button>
    `;
    console.log('Login button added!');
}

function showUserMenu() {
    const authSection = document.getElementById('auth-section');
    if (!authSection || !currentUser) return;

    const rawName = currentUser.username || currentUser.email || 'User';
    const displayName = rawName.includes('@') ? rawName.split('@')[0] : rawName;
    const avatarInitial = displayName.charAt(0).toUpperCase();
    
    authSection.innerHTML = `
        <div class="user-menu">
            <div class="user-info">
                <div class="user-avatar">${avatarInitial}</div>
                <span class="user-name">${displayName}</span>
            </div>
            <button class="btn-logout" onclick="handleLogout()">
                <i class="fas fa-sign-out-alt"></i>
            </button>
        </div>
    `;
}

// ==================== FORM HANDLERS ====================

function handleLogin() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    
    if (!email || !password) {
        showAuthError('Please fill in all fields');
        return;
    }
    
    login(email, password);
}

function handleRegister() {
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    
    if (!username || !email || !password) {
        showAuthError('Please fill in all fields');
        return;
    }
    
    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters');
        return;
    }
    
    register(email, username, password);
}

function handleLogout() {
    if (confirm('Are you sure you want to logout?')) {
        logout();
    }
}

// Initialize auth on page load
document.addEventListener('DOMContentLoaded', initAuth);

// Make functions globally available
window.showAuthModal = showAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchToLogin = switchToLogin;
window.switchToRegister = switchToRegister;
window.handleLogin = handleLogin;
window.handleRegister = handleRegister;
window.handleLogout = handleLogout;
